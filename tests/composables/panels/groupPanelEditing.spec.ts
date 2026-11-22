import { useEditorRemoval } from '@/composables/editor/useEditorRemoval'
import { useClipboard } from '@/composables/editor/useClipboard'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useGroupPanel } from '@/composables/panels/useGroupPanel'
import { useGroupPanelSelection } from '@/composables/panels/useGroupPanelSelection'
import { useCollectionPanel } from '@/composables/panels/useCollectionPanel'
import { applyEditorTransactionToScheme } from '@/lib/scheme/editorTransactions'
import { setSchemeItems } from '@/lib/scheme/groupState'
import { collectionTreesEqual } from '@/lib/scheme/collectionTree'
import type { GroupEditTarget } from '@/types/editor'
import { makeAppItem } from '../../fixtures/item'

vi.mock('@/composables/app/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let scope: EffectScope
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

function setup() {
  return scope.run(() => {
    const store = useEditorStore()
    useUIStore().groupPanelOpen = true
    store.createScheme('panel editing')
    const scheme = store.activeScheme!
    scheme.items.value = [
      makeAppItem({ internalId: 'a', groupId: 7 }),
      makeAppItem({ internalId: 'b', groupId: 7 }),
      makeAppItem({ internalId: 'c', groupId: 8 }),
      makeAppItem({ internalId: 'e', groupId: 9 }),
      makeAppItem({ internalId: 'd', groupId: 0 }),
    ]
    scheme.maxGroupId.value = 9
    scheme.collectionTree.value = {
      nodes: [
        { id: 'house', name: 'House', parentId: null, order: 0 },
        { id: 'floor', name: 'Floor', parentId: 'house', order: 0 },
        { id: 'empty', name: 'Empty', parentId: null, order: 1 },
      ],
      groups: [
        { groupId: 7, name: 'Walls', collectionId: 'floor', order: 0 },
        { groupId: 8, name: 'Roof', collectionId: 'house', order: 1 },
        { groupId: 9, name: 'Other', collectionId: null, order: 9 },
      ],
    }
    scheme.groupOrigins.value = new Map([
      [7, 'a'],
      [8, 'c'],
    ])
    store.triggerSceneUpdate()
    const panel = useGroupPanel()
    const query = ref('')
    const directory = useCollectionPanel(query, panel)
    const selection = useGroupPanelSelection(directory, panel.groups, query)
    const target = (groupIds: number[]): GroupEditTarget => ({
      kind: 'groups',
      schemeId: scheme.id,
      groupIds,
    })
    return {
      store,
      scheme,
      query,
      directory,
      removal: useEditorRemoval(),
      selection,
      target,
      groups: useEditorGroups(),
      history: useEditorHistory(),
    }
  })!
}

it('resolves nested, overlapping panel nodes in full despite search, folding and protection', () => {
  const { store, scheme, directory, selection, query, groups, target } = setup()
  store.setGroupHidden(7, true)
  store.setCollectionRestriction('house', 'locked', true)
  useEditorSelection().updateSelection(['d'], false)
  const modifiers = { ctrlKey: true, metaKey: false, shiftKey: false }
  selection.select({ kind: 'collection', id: 'house' }, modifiers)
  selection.select({ kind: 'collection', id: 'floor' }, modifiers)
  selection.select({ kind: 'group', id: 7 }, modifiers)
  expect(scheme.selectedItemIds.value).toEqual(new Set(['d']))
  directory.collapseAll()
  query.value = 'Walls'
  const editTarget = target([...new Set(selection.entries.value.flatMap(directory.groupsForEntry))])
  expect(editTarget).toMatchObject({ groupIds: [7, 8] })
  expect(groups.resolveGroupRequest(editTarget)).toEqual({ kind: 'choose', candidates: [7, 8] })
  expect(groups.groupInto(8, editTarget)).toBe(true)
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([8, 8, 8, 9, 0])
  expect(scheme.selectedItemIds.value).toEqual(new Set(['d']))
})

it.each([7, 8])(
  'keeps only target %s identity and own/inherited restrictions through undo/redo',
  (targetId) => {
    const { store, scheme, groups, target, history } = setup()
    store.setGroupHidden(7, true)
    store.setGroupLocked(7, true)
    store.setCollectionRestriction('house', 'hidden', true)
    store.setCollectionRestriction('house', 'locked', true)
    const before = scheme.items.value
    const tree = scheme.collectionTree.value
    const hidden = scheme.hiddenGroupIds.value
    const locked = scheme.lockedGroupIds.value
    const version = store.sceneVersion
    const selected = scheme.selectedItemIds.value
    expect(groups.groupInto(targetId, target([7, 8]))).toBe(true)
    expect(scheme.items.value.slice(0, 3).every((item) => item.groupId === targetId)).toBe(true)
    expect(scheme.items.value[3]).toBe(before[3])
    expect(scheme.items.value[4]).toBe(before[4])
    expect(scheme.selectedItemIds.value).toBe(selected)
    expect(scheme.hiddenGroupIds.value).toBe(hidden)
    expect(scheme.lockedGroupIds.value).toBe(locked)
    expect(scheme.collectionTree.value.nodes).toBe(tree.nodes)
    expect(scheme.collectionTree.value.groups).toEqual(
      tree.groups.filter((entry) => entry.groupId !== (targetId === 7 ? 8 : 7))
    )
    expect(scheme.groupOrigins.value).toEqual(new Map([[targetId, targetId === 7 ? 'a' : 'c']]))
    expect(store.isItemVisible('a')).toBe(false)
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
    expect(store.getRenderChanges(scheme.id, version)?.size).toBe(targetId === 7 ? 1 : 2)
    history.undo()
    expect(scheme.items.value).toEqual(before)
    expect(scheme.collectionTree.value).toEqual(tree)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    history.redo()
    expect(scheme.hiddenGroupIds.value).toBe(hidden)
    expect(scheme.lockedGroupIds.value).toBe(locked)
    expect(scheme.items.value.slice(0, 3).every((item) => item.groupId === targetId)).toBe(true)
  }
)

it('does not hide or lock a visible target when merging a protected source into it', () => {
  const { store, scheme, groups, target, history } = setup()
  store.setGroupHidden(7, true)
  store.setGroupLocked(7, true)
  expect(groups.groupInto(8, target([7, 8]))).toBe(true)
  expect(store.isItemEditable('a')).toBe(true)
  expect(scheme.hiddenGroupIds.value).toEqual(new Set([7]))
  history.undo()
  expect(store.isItemEditable('a')).toBe(false)
  history.redo()
  expect(store.isItemEditable('a')).toBe(true)
  expect(scheme.lockedGroupIds.value).toEqual(new Set([7]))
})

it('silently creates a group in the common collection in one undoable transaction', () => {
  const { store, scheme, groups, target, history } = setup()
  const ui = useUIStore()
  ui.groupPanelOpen = false
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    groups: scheme.collectionTree.value.groups.map((group) =>
      group.groupId === 9 ? { ...group, collectionId: 'house', order: 42 } : group
    ),
  }
  const before = scheme.items.value
  const tree = scheme.collectionTree.value
  const origins = scheme.groupOrigins.value
  store.setCollectionRestriction('house', 'hidden', true)
  store.setGroupLocked(8, true)
  store.setGroupHidden(7, true)
  expect(groups.requestGroup(target([7, 8]))).toBe(true)
  expect(ui.groupMergeOpen).toBe(false)
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([10, 10, 10, 9, 0])
  expect(scheme.items.value[3]).toBe(before[3])
  expect(scheme.collectionTree.value.groups).toEqual([
    tree.groups[2],
    { groupId: 10, collectionId: 'house', order: 43 },
  ])
  expect(scheme.groupOrigins.value.size).toBe(0)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  // 不继承源组个人状态，但仍遵守目标集合的继承限制。
  expect(store.isItemVisible('a')).toBe(false)
  history.undo()
  expect(scheme.items.value).toEqual(before)
  expect(scheme.collectionTree.value).toEqual(tree)
  expect(scheme.groupOrigins.value).toEqual(origins)
  expect(scheme.maxGroupId.value).toBe(10)
  history.redo()
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 10)).toEqual({
    groupId: 10,
    collectionId: 'house',
    order: 43,
  })
  expect(store.isItemVisible('a')).toBe(false)
  expect(scheme.hiddenGroupIds.value.has(10)).toBe(false)
  expect(scheme.lockedGroupIds.value.has(10)).toBe(false)
})

it('ungroups protected groups in one transaction, retains folders and obeys ungrouped restrictions', () => {
  const { store, scheme, groups, target, history } = setup()
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  store.setGroupHidden(0, true)
  const tree = scheme.collectionTree.value
  const before = scheme.items.value
  expect(groups.canGroupSelection(target([7]))).toBe(false)
  expect(groups.canUngroupSelection(target([7]))).toBe(true)
  groups.ungroupSelected(target([7, 8]))
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([0, 0, 0, 9, 0])
  expect(scheme.collectionTree.value.nodes).toBe(tree.nodes)
  expect(store.isItemVisible('a')).toBe(false)
  expect(scheme.groupOrigins.value.size).toBe(0)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  history.undo()
  expect(scheme.items.value).toEqual(before)
  expect(scheme.collectionTree.value).toEqual(tree)
  expect(scheme.hiddenGroupIds.value).toEqual(new Set([7, 0]))
  expect(scheme.lockedGroupIds.value).toEqual(new Set([8]))
  history.redo()
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([0, 0, 0, 9, 0])
})

it('keeps empty collections inert and captures panel scope independently of later selection', () => {
  const { scheme, groups, target } = setup()
  const ui = useUIStore()
  expect(groups.canGroupSelection(target([]))).toBe(false)
  expect(groups.canUngroupSelection(target([]))).toBe(false)
  groups.requestGroup(target([7, 8]))
  expect(ui.groupMergeCandidates).toEqual([7, 8])
  expect(ui.groupMergeTarget).toEqual(target([7, 8]))
  useEditorSelection().updateSelection(['e'], false)
  expect(groups.groupInto(8, ui.groupMergeTarget!)).toBe(true)
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([8, 8, 8, 9, 0])
  expect(scheme.selectedItemIds.value).toEqual(new Set(['e']))
})

it('captures canvas members but still respects protection changes before confirmation', () => {
  const { store, scheme, groups } = setup()
  const ui = useUIStore()
  useEditorSelection().updateSelection(['a', 'c'], false, { skipGroupExpansion: true })
  groups.requestGroup()
  useEditorSelection().updateSelection(['d'], false)
  expect(ui.groupMergeTarget).toMatchObject({ kind: 'selection', itemIds: ['a', 'c'] })
  expect(groups.groupInto(8, ui.groupMergeTarget!)).toBe(true)
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([8, 7, 8, 9, 0])
  store.setGroupLocked(7, true)
  store.setGroupHidden(8, true)
  scheme.selectedItemIds.value = new Set(['a', 'b', 'c'])
  const before = scheme.items.value
  expect(groups.canGroupSelection()).toBe(false)
  groups.ungroupSelected()
  expect(groups.groupInto(null)).toBe(false)
  expect(scheme.items.value).toBe(before)
})

it('rejects stale panel groups and a dialog scope belonging to a different scheme', () => {
  const { store, scheme, groups, target } = setup()
  const stale = target([7, 8])
  setSchemeItems(
    scheme,
    scheme.items.value.filter((item) => item.groupId !== 8)
  )
  expect(groups.canGroupSelection(stale)).toBe(false)
  expect(groups.groupInto(null, stale)).toBe(false)
  groups.ungroupSelected(stale)
  expect(store.groupsMap.has(7)).toBe(true)
  store.createScheme('another')
  const current = store.activeScheme!
  current.items.value = [
    makeAppItem({ internalId: 'a', groupId: 7 }),
    makeAppItem({ internalId: 'b', groupId: 8 }),
  ]
  const before = current.items.value
  expect(groups.groupInto(8, stale)).toBe(false)
  groups.ungroupSelected(stale)
  expect(current.items.value).toBe(before)
})

it('queues new-group membership and collection together without sharing personal flags', () => {
  const { store, scheme, groups, target } = setup()
  const before = scheme.items.value
  const tree = scheme.collectionTree.value
  scheme.source.value = 'cloud'
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  expect(groups.groupInto(null, target([7, 8]))).toBe(true)
  expect(store.pendingTransactions).toHaveLength(1)
  const transaction = store.pendingTransactions[0]!
  const patch = transaction.ops.find((op) => op.type === 'patch_items')!
  expect(patch.changes.map((change) => change.itemId)).toEqual(['a', 'b', 'c'])
  expect(
    transaction.ops.every((op) =>
      ['patch_items', 'set_group_names', 'set_group_origins', 'set_collection_tree'].includes(
        op.type
      )
    )
  ).toBe(true)
  store.createScheme('remote peer')
  const peer = store.activeScheme!
  peer.items.value = before
  peer.collectionTree.value = tree
  peer.hiddenGroupIds.value = new Set([7])
  applyEditorTransactionToScheme(peer, { ...transaction, schemeId: peer.id })
  expect(peer.items.value.map((item) => item.groupId)).toEqual([10, 10, 10, 9, 0])
  expect(collectionTreesEqual(peer.collectionTree.value, scheme.collectionTree.value)).toBe(true)
  expect(peer.hiddenGroupIds.value).toEqual(new Set([7]))
  expect(peer.lockedGroupIds.value.size).toBe(0)
})

it('deletes a complete protected subtree in one transaction without deleting carried canvas items', () => {
  const { store, scheme, directory, removal, selection, history, query } = setup()
  scheme.items.value = [...scheme.items.value, makeAppItem({ internalId: 'e2', groupId: 9 })]
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    nodes: [
      ...scheme.collectionTree.value.nodes,
      { id: 'nested-empty', name: 'Nested empty', parentId: 'floor', order: 0 },
    ],
  }
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  store.setCollectionRestriction('house', 'hidden', true)
  store.setCollectionRestriction('floor', 'locked', true)
  useEditorSelection().updateSelection(['e'], false, { skipGroupExpansion: true })
  selection.select(
    { kind: 'collection', id: 'house' },
    { ctrlKey: true, metaKey: false, shiftKey: false }
  )
  expect(selection.entries.value).toEqual([{ kind: 'collection', id: 'house' }])
  const before = scheme.items.value,
    tree = scheme.collectionTree.value,
    origins = scheme.groupOrigins.value
  const count = scheme.history.value!.selectionUndoStack.length
  scheme.activeCollectionId.value = 'house'
  directory.collapseAll()
  query.value = 'Walls'
  expect(removal.remove(selection.entries.value)).toBe(true)
  expect(scheme.items.value).toEqual([before[3], before[4], before[5]])
  expect(scheme.items.value[0]).toBe(before[3])
  expect(scheme.collectionTree.value.nodes.map((node) => node.id)).toEqual(['empty'])
  expect(scheme.collectionTree.value.groups).toEqual([tree.groups[2]])
  expect(scheme.groupOrigins.value.size).toBe(0)
  expect(scheme.selectedItemIds.value).toEqual(new Set(['e']))
  expect(scheme.activeCollectionId.value).toBeNull()
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(count)
  history.undo()
  expect(new Map(scheme.items.value.map((item) => [item.internalId, item]))).toEqual(
    new Map(before.map((item) => [item.internalId, item]))
  )
  expect(scheme.collectionTree.value).toEqual(tree)
  expect(scheme.groupOrigins.value).toEqual(origins)
  expect(store.isItemVisible('a')).toBe(false)
  expect(store.isItemEditable('c')).toBe(false)
  expect(scheme.maxGroupId.value).toBe(9)
  history.redo()
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['e', 'd', 'e2'])
  expect(scheme.collectionTree.value.nodes.map((node) => node.id)).toEqual(['empty'])
})

it('deletes an entire group but keeps its containing collection and unrelated metadata', () => {
  const { scheme, removal } = setup()
  scheme.activeGroupId.value = 7
  const tree = scheme.collectionTree.value
  expect(removal.remove([{ kind: 'group', id: 7 }])).toBe(true)
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['c', 'e', 'd'])
  expect(scheme.collectionTree.value.nodes).toBe(tree.nodes)
  expect(scheme.collectionTree.value.groups.map((group) => group.groupId)).toEqual([8, 9])
  expect(scheme.groupOrigins.value).toEqual(new Map([[8, 'c']]))
  expect(scheme.activeGroupId.value).toBeNull()
})

it('deletes empty collections without updating furniture, origins or the scene', () => {
  const { store, scheme, removal } = setup()
  const items = scheme.items.value,
    origins = scheme.groupOrigins.value,
    sceneVersion = store.sceneVersion
  expect(removal.remove([{ kind: 'collection', id: 'empty' }])).toBe(true)
  expect(scheme.items.value).toBe(items)
  expect(scheme.groupOrigins.value).toBe(origins)
  expect(store.sceneVersion).toBe(sceneVersion)
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === 'empty')).toBe(false)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
})

it('cleans all empty subtrees in one step while keeping protected furniture, unrelated selections and scene references', () => {
  const { store, scheme, directory, removal, history, query } = setup()
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    nodes: [
      ...scheme.collectionTree.value.nodes,
      { id: 'empty-child', name: 'Child', parentId: 'empty', order: 0 },
      { id: 'empty-leaf', name: 'Leaf', parentId: 'empty-child', order: 0 },
      { id: 'empty-room', name: 'Room', parentId: 'house', order: 1 },
    ],
  }
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  store.setCollectionRestriction('empty', 'hidden', true)
  store.setCollectionRestriction('empty-child', 'locked', true)
  scheme.selectedEntries.value = [
    { kind: 'collection', id: 'empty-leaf' },
    { kind: 'collection', id: 'house' },
  ]
  scheme.selectedItemIds.value = new Set(['d'])
  scheme.activeCollectionId.value = 'empty-leaf'
  directory.collapseAll()
  query.value = 'Walls'
  const items = scheme.items.value,
    tree = scheme.collectionTree.value,
    origins = scheme.groupOrigins.value,
    hidden = scheme.hiddenCollectionIds.value,
    locked = scheme.lockedCollectionIds.value,
    entries = scheme.selectedEntries.value,
    sceneVersion = store.sceneVersion
  const clipboard = useClipboard().clipboard.value

  expect(removal.emptyCollectionCount.value).toBe(4)
  expect(removal.cleanEmptyCollections()).toBe(4)
  expect(scheme.collectionTree.value.nodes).toEqual(tree.nodes.slice(0, 2))
  expect(scheme.collectionTree.value.groups).toEqual(tree.groups)
  expect(scheme.items.value).toBe(items)
  expect(scheme.groupOrigins.value).toBe(origins)
  expect(store.sceneVersion).toBe(sceneVersion)
  expect(scheme.selectedEntries.value).toEqual([{ kind: 'collection', id: 'house' }])
  expect(scheme.selectedItemIds.value).toEqual(new Set(['d']))
  expect(scheme.activeCollectionId.value).toBeNull()
  expect(scheme.hiddenCollectionIds.value).toBe(hidden)
  expect(scheme.lockedCollectionIds.value).toBe(locked)
  expect(useClipboard().clipboard.value).toBe(clipboard)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  expect(
    scheme.history.value!.transactionUndoStack[0]!.transaction.ops.map((op) => op.type)
  ).toEqual(['set_collection_tree'])
  expect(removal.emptyCollectionCount.value).toBe(0)
  expect(removal.cleanEmptyCollections()).toBe(0)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)

  history.undo()
  expect(scheme.collectionTree.value).toEqual(tree)
  expect(scheme.selectedEntries.value).toEqual(entries)
  expect(removal.emptyCollectionCount.value).toBe(4)
  expect(store.isItemVisible('a')).toBe(false)
  expect(store.isItemEditable('c')).toBe(false)
  history.redo()
  expect(scheme.collectionTree.value.nodes).toEqual(tree.nodes.slice(0, 2))
  expect(scheme.selectedEntries.value).toEqual([{ kind: 'collection', id: 'house' }])
})

it('rechecks live furniture and the active scheme when cleaning empty collections', () => {
  const { store, scheme, removal } = setup()
  expect(removal.emptyCollectionCount.value).toBe(1)
  scheme.items.value = [...scheme.items.value, makeAppItem({ internalId: 'new', groupId: 10 })]
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    groups: [
      ...scheme.collectionTree.value.groups,
      { groupId: 10, collectionId: 'empty', order: 0 },
    ],
  }
  const sourceTree = scheme.collectionTree.value
  expect(removal.cleanEmptyCollections()).toBe(0)
  expect(removal.emptyCollectionCount.value).toBe(0)
  expect(scheme.collectionTree.value).toBe(sourceTree)
  expect(scheme.history.value).toBeUndefined()

  store.createScheme('another scheme')
  const target = store.activeScheme!
  target.collectionTree.value = {
    nodes: [
      { id: 'parent', name: 'Parent', parentId: null, order: 0 },
      { id: 'child', name: 'Child', parentId: 'parent', order: 0 },
    ],
    groups: [],
  }
  expect(removal.emptyCollectionCount.value).toBe(2)
  expect(removal.cleanEmptyCollections()).toBe(2)
  expect(target.collectionTree.value.nodes).toEqual([])
  expect(scheme.collectionTree.value).toBe(sourceTree)
  expect(scheme.items.value.some((item) => item.internalId === 'new')).toBe(true)
})

it('guards cloud cleanup and replays cleanup, undo and redo as collection-only transactions', () => {
  const { store, scheme, removal, history } = setup()
  const before = scheme.collectionTree.value,
    items = scheme.items.value
  scheme.source.value = 'cloud'
  expect(removal.cleanEmptyCollections()).toBe(0)
  const cloud = useCloudSchemeStore()
  cloud.schemeId = scheme.id
  cloud.status = 'connected'
  scheme.collectionsSupported.value = false
  expect(removal.cleanEmptyCollections()).toBe(0)
  expect(scheme.collectionTree.value).toBe(before)
  expect(store.pendingTransactions).toHaveLength(0)
  expect(scheme.history.value).toBeUndefined()

  scheme.collectionsSupported.value = true
  expect(removal.cleanEmptyCollections()).toBe(1)
  const after = scheme.collectionTree.value
  expect(scheme.items.value).toBe(items)
  expect(store.pendingTransactions).toHaveLength(1)
  const cleanup = store.pendingTransactions[0]!
  store.acknowledgePendingTransaction(cleanup.id)
  history.markTransactionCommitted(scheme.id, cleanup.id)
  history.undo()
  expect(scheme.collectionTree.value).toEqual(before)
  const undo = store.pendingTransactions[0]!
  store.acknowledgePendingTransaction(undo.id)
  history.redo()
  expect(scheme.collectionTree.value).toEqual(after)
  const transactions = [cleanup, undo, store.pendingTransactions[0]!]
  expect(
    transactions.every((tx) => tx.ops.length === 1 && tx.ops[0]!.type === 'set_collection_tree')
  ).toBe(true)

  store.createScheme('peer')
  const peer = store.activeScheme!
  peer.items.value = items
  peer.collectionTree.value = before
  applyEditorTransactionToScheme(peer, transactions[0]!)
  expect(peer.collectionTree.value).toEqual(after)
  applyEditorTransactionToScheme(peer, transactions[1]!)
  expect(peer.collectionTree.value).toEqual(before)
  applyEditorTransactionToScheme(peer, transactions[2]!)
  expect(peer.collectionTree.value).toEqual(after)
  expect(peer.items.value).toBe(items)
})

it('deduplicates mixed parent, child, group and ungrouped deletion targets', () => {
  const { scheme, removal } = setup()
  scheme.selectedItemIds.value = new Set(['e'])
  expect(
    removal.remove([
      { kind: 'collection', id: 'house' },
      { kind: 'collection', id: 'floor' },
      { kind: 'group', id: 7 },
      { kind: 'group', id: 7 },
      { kind: 'ungrouped', id: 0 },
    ])
  ).toBe(true)
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['e'])
  expect(scheme.selectedItemIds.value).toEqual(new Set(['e']))
  const remove = scheme.history.value!.transactionUndoStack[0]!.transaction.ops.find(
    (op) => op.type === 'remove_items'
  )!
  expect(remove.items.map((item) => item.internalId)).toEqual(['a', 'b', 'c', 'd'])
})

it('deletes virtual unclassified contents, including groups without explicit metadata, without touching classified or ungrouped items', () => {
  const { scheme, removal } = setup()
  scheme.items.value = [
    ...scheme.items.value,
    makeAppItem({ internalId: 'no-metadata', groupId: 10 }),
  ]
  scheme.maxGroupId.value = 10
  scheme.activeCollectionId.value = '@unclassified'
  expect(removal.remove([{ kind: 'collection', id: '@unclassified' }])).toBe(true)
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['a', 'b', 'c', 'd'])
  expect(scheme.activeCollectionId.value).toBeNull()
  expect(scheme.collectionTree.value.nodes).toHaveLength(3)
})

it('rejects empty, stale and unavailable cloud delete targets without partial deletion', () => {
  const { scheme, removal } = setup()
  const items = scheme.items.value,
    tree = scheme.collectionTree.value
  for (const entries of [
    [],
    [
      { kind: 'group' as const, id: 7 },
      { kind: 'collection' as const, id: 'missing' },
    ],
  ]) {
    expect(removal.canRemove(entries)).toBe(false)
    expect(removal.remove(entries)).toBe(false)
  }
  scheme.source.value = 'cloud'
  const entries = [{ kind: 'collection' as const, id: 'house' }]
  expect(removal.remove(entries)).toBe(false)
  expect(scheme.items.value).toBe(items)
  expect(scheme.collectionTree.value).toBe(tree)
})

it.each(['delete', 'cut'] as const)(
  'replays cloud subtree %s without sharing or clearing personal restrictions',
  (operation) => {
    const { store, scheme, removal } = setup()
    const before = scheme.items.value,
      tree = scheme.collectionTree.value,
      origins = scheme.groupOrigins.value
    store.setGroupHidden(7, true)
    scheme.source.value = 'cloud'
    useCloudSchemeStore().schemeId = scheme.id
    useCloudSchemeStore().status = 'connected'
    const entries = [{ kind: 'collection', id: 'house' }] as const
    expect(operation === 'cut' ? useClipboard().cut(entries) : removal.remove(entries)).toBe(true)
    const transaction = store.pendingTransactions[0]!
    expect(transaction.ops.map((op) => op.type)).toEqual(
      expect.arrayContaining([
        'remove_items',
        'set_collection_tree',
        'set_group_names',
        'set_group_origins',
      ])
    )
    store.createScheme('remote deletion')
    const peer = store.activeScheme!
    peer.items.value = before
    peer.collectionTree.value = tree
    peer.groupOrigins.value = origins
    applyEditorTransactionToScheme(peer, transaction)
    expect(peer.items.value).toEqual(scheme.items.value)
    expect(peer.collectionTree.value).toEqual(scheme.collectionTree.value)
    expect(peer.groupOrigins.value.size).toBe(0)
    expect(peer.hiddenGroupIds.value.size).toBe(0)
    expect(scheme.hiddenGroupIds.value).toEqual(new Set([7]))
  }
)

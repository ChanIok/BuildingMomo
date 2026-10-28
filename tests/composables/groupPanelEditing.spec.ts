import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useGroupPanel } from '@/composables/editor/useGroupPanel'
import { useGroupPanelSelection } from '@/composables/editor/useGroupPanelSelection'
import { useCollectionPanel } from '@/composables/editor/useCollectionPanel'
import { applyEditorTransactionToScheme } from '@/lib/editorTransactions'
import { setSchemeItems } from '@/lib/groupState'
import type { GroupEditTarget } from '@/types/editor'
import { makeAppItem } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

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

it('creates an unclassified group without inheriting source names or personal flags', () => {
  const { store, scheme, groups, target, history } = setup()
  store.setCollectionRestriction('house', 'hidden', true)
  store.setGroupLocked(8, true)
  store.setGroupHidden(7, true)
  expect(groups.groupInto(null, target([7, 8]))).toBe(true)
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([10, 10, 10, 9, 0])
  expect(scheme.collectionTree.value.groups.map((entry) => entry.groupId)).toEqual([9])
  expect(scheme.collectionTree.value.nodes).toHaveLength(3)
  expect(store.isItemEditable('a')).toBe(true)
  history.undo()
  expect(scheme.maxGroupId.value).toBe(10)
  history.redo()
  expect(store.isItemEditable('a')).toBe(true)
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

it('queues complete cloud patches and replays them without sharing personal flags', () => {
  const { store, scheme, groups, target } = setup()
  const before = scheme.items.value
  const tree = scheme.collectionTree.value
  scheme.source.value = 'cloud'
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  expect(groups.groupInto(8, target([7, 8]))).toBe(true)
  expect(store.pendingTransactions).toHaveLength(1)
  const transaction = store.pendingTransactions[0]!
  const patch = transaction.ops.find((op) => op.type === 'patch_items')!
  expect(patch.changes.map((change) => change.itemId)).toEqual(['a', 'b'])
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
  expect(peer.items.value.map((item) => item.groupId)).toEqual([8, 8, 8, 9, 0])
  expect(peer.collectionTree.value).toEqual(scheme.collectionTree.value)
  expect(peer.hiddenGroupIds.value).toEqual(new Set([7]))
  expect(peer.lockedGroupIds.value.size).toBe(0)
})

it('deletes a complete protected subtree in one transaction without deleting carried canvas items', () => {
  const { store, scheme, directory, selection, history, query } = setup()
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
  expect(directory.deleteEntries(selection.entries.value)).toBe(true)
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
  const { scheme, directory } = setup()
  scheme.activeGroupId.value = 7
  const tree = scheme.collectionTree.value
  expect(directory.deleteEntries([{ kind: 'group', id: 7 }])).toBe(true)
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['c', 'e', 'd'])
  expect(scheme.collectionTree.value.nodes).toBe(tree.nodes)
  expect(scheme.collectionTree.value.groups.map((group) => group.groupId)).toEqual([8, 9])
  expect(scheme.groupOrigins.value).toEqual(new Map([[8, 'c']]))
  expect(scheme.activeGroupId.value).toBeNull()
})

it('deletes empty collections without updating furniture, origins or the scene', () => {
  const { store, scheme, directory } = setup()
  const items = scheme.items.value,
    origins = scheme.groupOrigins.value,
    sceneVersion = store.sceneVersion
  expect(directory.deleteEntries([{ kind: 'collection', id: 'empty' }])).toBe(true)
  expect(scheme.items.value).toBe(items)
  expect(scheme.groupOrigins.value).toBe(origins)
  expect(store.sceneVersion).toBe(sceneVersion)
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === 'empty')).toBe(false)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
})

it('deduplicates mixed parent, child, group and ungrouped deletion targets', () => {
  const { scheme, directory } = setup()
  scheme.selectedItemIds.value = new Set(['e'])
  expect(
    directory.deleteEntries([
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
  const { scheme, directory } = setup()
  scheme.items.value = [
    ...scheme.items.value,
    makeAppItem({ internalId: 'no-metadata', groupId: 10 }),
  ]
  scheme.maxGroupId.value = 10
  scheme.activeCollectionId.value = '@unclassified'
  expect(directory.deleteEntries([{ kind: 'collection', id: '@unclassified' }])).toBe(true)
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['a', 'b', 'c', 'd'])
  expect(scheme.activeCollectionId.value).toBeNull()
  expect(scheme.collectionTree.value.nodes).toHaveLength(3)
})

it('rejects empty, stale and unavailable cloud delete targets without partial deletion', () => {
  const { scheme, directory } = setup()
  const items = scheme.items.value,
    tree = scheme.collectionTree.value
  for (const entries of [
    [],
    [
      { kind: 'group' as const, id: 7 },
      { kind: 'collection' as const, id: 'missing' },
    ],
  ]) {
    expect(directory.canDeleteEntries(entries)).toBe(false)
    expect(directory.deleteEntries(entries)).toBe(false)
  }
  scheme.source.value = 'cloud'
  const entries = [{ kind: 'collection' as const, id: 'house' }]
  expect(directory.deleteEntries(entries)).toBe(false)
  expect(scheme.items.value).toBe(items)
  expect(scheme.collectionTree.value).toBe(tree)
})

it('replays cloud subtree deletion without sharing or clearing personal restrictions', () => {
  const { store, scheme, directory } = setup()
  const before = scheme.items.value,
    tree = scheme.collectionTree.value,
    origins = scheme.groupOrigins.value
  store.setGroupHidden(7, true)
  scheme.source.value = 'cloud'
  useCloudSchemeStore().schemeId = scheme.id
  useCloudSchemeStore().status = 'connected'
  expect(directory.deleteEntries([{ kind: 'collection', id: 'house' }])).toBe(true)
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
})

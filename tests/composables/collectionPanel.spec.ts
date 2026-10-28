import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { useCollectionPanel } from '@/composables/editor/useCollectionPanel'
import { UNCLASSIFIED } from '@/lib/collectionTree'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import { buildSchemeHistoryFile, parseSchemeHistoryFile } from '@/lib/schemeHistory'
import {
  collectionTreesEqual,
  getGroupChanges,
  isCollectionTree,
  emptyCollectionTree,
  reconcileCollectionGroups,
} from '@/lib/collectionTree'
import { applyEditorTransactionToScheme, invertEditorTransaction } from '@/lib/editorTransactions'
import { setSchemeItems } from '@/lib/groupState'
import { makeAppItem, setGroupNames } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const store = useEditorStore()
  store.createScheme('collections')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({ internalId: 'a', groupId: 7 }),
    makeAppItem({ internalId: 'b', groupId: 8 }),
  ]
  setGroupNames(scheme, [
    [7, 'Walls'],
    [8, 'Garden'],
  ])
  store.triggerSceneUpdate()
  const query = ref('')
  const panel = useCollectionPanel(query)
  const root = panel.createCollection()!
  panel.renameCollection(root, 'House')
  const child = panel.createCollection(root)!
  panel.renameCollection(child, 'Floor')
  panel.move({ kind: 'group', id: 7 }, child)
  return { store, scheme, panel, root, child, query, history: useEditorHistory() }
}

it('classifies groups uniquely without changing furniture, selection or render versions', () => {
  const { store, scheme, panel, root, child } = setup()
  const items = scheme.items.value
  const version = store.sceneVersion
  expect(panel.rows.value.map((row) => row.kind)).toEqual([
    'collection',
    'collection',
    'group',
    'collection',
    'group',
  ])
  expect(panel.move({ kind: 'group', id: 7 }, root)).toBe(true)
  expect(scheme.collectionTree.value.groups.filter((entry) => entry.groupId === 7)).toEqual([
    { groupId: 7, name: 'Walls', collectionId: root, order: 0 },
  ])
  expect(panel.move({ kind: 'collection', id: root }, child)).toBe(false)
  expect(panel.move({ kind: 'collection', id: root }, root)).toBe(false)
  expect(scheme.items.value).toBe(items)
  expect(store.sceneVersion).toBe(version)
  expect(scheme.selectedItemIds.value.size).toBe(0)
})

it('keeps ungrouped furniture in a dynamic root aggregate, outside directory operations', () => {
  const { store, scheme, panel, root, query, history } = setup()
  scheme.items.value = [
    ...scheme.items.value,
    makeAppItem({ internalId: 'loose-a', groupId: 0 }),
    makeAppItem({ internalId: 'loose-b', groupId: 0 }),
  ]
  const loose = { kind: 'ungrouped', id: 0 } as const
  expect(panel.rows.value.at(-1)).toMatchObject({
    ...loose,
    parentId: null,
    depth: 0,
    group: { count: 2 },
  })
  panel.collapseAll()
  expect(panel.rows.value.at(-1)?.kind).toBe('ungrouped')
  expect(panel.visibleEntryForGroup(0)).toEqual(loose)
  query.value = 'Walls'
  expect(panel.rows.value.some((row) => row.kind === 'ungrouped')).toBe(false)
  query.value = 'groups.ungrouped'
  expect(panel.rows.value.map((row) => row.kind)).toEqual(['ungrouped'])
  const tree = scheme.collectionTree.value
  expect(panel.canMove(loose, root)).toBe(false)
  expect(panel.moveMany([loose, { kind: 'group', id: 8 }], root)).toBe(false)
  expect(scheme.collectionTree.value).toBe(tree)
  useEditorSelection().updateSelection(['loose-a', 'loose-b'], false)
  useEditorGroups().groupSelected()
  expect(panel.rows.value).toHaveLength(0)
  expect(store.ungroupedItemIds.size).toBe(0)
  history.undo()
  expect(panel.rows.value.at(-1)).toMatchObject({ kind: 'ungrouped', group: { count: 2 } })
  history.redo()
  useEditorGroups().ungroupSelected()
  expect(panel.rows.value.at(-1)).toMatchObject({ kind: 'ungrouped', group: { count: 2 } })
  expect(store.groupsMap.has(0)).toBe(false)
})

it('orders sibling groups and collections and lifts contents when removing a folder, with undo/redo', () => {
  const { scheme, panel, root, child, history } = setup()
  panel.move({ kind: 'group', id: 8 }, child, 7)
  expect(panel.rows.value.filter((row) => row.kind === 'group').map((row) => row.id)).toEqual([
    8, 7,
  ])
  panel.deleteCollection(child)
  expect(scheme.collectionTree.value.groups.every((entry) => entry.collectionId === root)).toBe(
    true
  )
  expect(scheme.items.value).toHaveLength(2)
  history.undo()
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === child)).toBe(true)
  history.redo()
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === child)).toBe(false)
  const sibling = panel.createCollection()!
  panel.move({ kind: 'collection', id: sibling }, null, root)
  expect(
    panel.rows.value.filter((row) => row.kind === 'collection' && !row.virtual).map((row) => row.id)
  ).toEqual([sibling, root])
})

it('moves mixed nodes once in tree order, deduplicates descendants, and undoes the entire batch', () => {
  const { store, scheme, panel, child, history } = setup()
  const empty = panel.createCollection()!,
    target = panel.createCollection()!
  useEditorSelection().updateSelection(['a', 'b'], false)
  const before = scheme.collectionTree.value,
    items = scheme.items.value,
    version = store.sceneVersion
  const txCount = scheme.history.value!.transactionUndoStack.length
  expect(
    panel.moveMany(
      [
        { kind: 'group', id: 8 },
        { kind: 'collection', id: empty },
        { kind: 'group', id: 7 },
        { kind: 'collection', id: child },
        { kind: 'collection', id: child },
      ],
      target
    )
  ).toBe(true)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(txCount + 1)
  const moved = scheme.collectionTree.value
  expect(
    moved.nodes
      .filter((node) => node.parentId === target)
      .sort((a, b) => a.order - b.order)
      .map((node) => node.id)
  ).toEqual([child, empty])
  expect(moved.groups.find((group) => group.groupId === 7)).toMatchObject({
    name: 'Walls',
    collectionId: child,
  })
  expect(moved.groups.find((group) => group.groupId === 8)).toMatchObject({
    name: 'Garden',
    collectionId: target,
  })
  expect(scheme.items.value).toBe(items)
  expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  expect(store.sceneVersion).toBe(version)
  history.undo()
  expect(collectionTreesEqual(scheme.collectionTree.value, before)).toBe(true)
  history.redo()
  expect(collectionTreesEqual(scheme.collectionTree.value, moved)).toBe(true)
})

it('rejects invalid batch destinations atomically and keeps group order independent of click order', () => {
  const { scheme, panel, root, child } = setup()
  const before = scheme.collectionTree.value,
    count = scheme.history.value!.transactionUndoStack.length
  const entries = [
    { kind: 'collection', id: root },
    { kind: 'group', id: 8 },
  ] as const
  expect(panel.canMoveMany(entries, child)).toBe(false)
  expect(panel.moveMany(entries, child)).toBe(false)
  expect(
    panel.moveMany(
      [
        { kind: 'group', id: 8 },
        { kind: 'group', id: 999 },
      ],
      child
    )
  ).toBe(false)
  expect(scheme.collectionTree.value).toBe(before)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(count)
  expect(
    panel.moveMany(
      [
        { kind: 'group', id: 8 },
        { kind: 'group', id: 7 },
      ],
      child
    )
  ).toBe(true)
  expect(panel.rows.value.filter((row) => row.kind === 'group').map((row) => row.id)).toEqual([
    7, 8,
  ])
})

it('activates a newly created collection exclusively without clearing canvas selection', () => {
  const { scheme, panel } = setup()
  scheme.activeGroupId.value = 7
  scheme.activeCollectionId.value = null
  scheme.selectedItemIds.value = new Set(['a'])
  const selected = scheme.selectedItemIds.value
  const id = panel.createCollection()
  expect(scheme.activeCollectionId.value).toBe(id)
  expect(scheme.activeGroupId.value).toBeNull()
  expect(scheme.selectedItemIds.value).toBe(selected)
  expect([...selected]).toEqual(['a'])
})

it('temporarily expands search paths, restores collapse state, and supports explicit folder toggles', () => {
  const { panel, root, child, query, scheme } = setup()
  panel.collapseAll()
  expect(panel.rows.value.map((row) => row.id)).toEqual([root, UNCLASSIFIED])
  const collapsed = scheme.collapsedCollectionIds.value
  expect(panel.visibleEntryForGroup(7)).toEqual({ kind: 'collection', id: root })
  expect(panel.visibleEntryForGroup(8)).toEqual({ kind: 'collection', id: UNCLASSIFIED })
  query.value = 'Walls'
  expect(panel.rows.value.map((row) => row.id)).toEqual([root, child, 7])
  expect(panel.visibleEntryForGroup(7)).toEqual({ kind: 'group', id: 7 })
  expect(panel.visibleEntryForGroup(8)).toBeUndefined()
  panel.toggleCollection(root)
  expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
  query.value = ''
  expect(panel.rows.value.map((row) => row.id)).toEqual([root, UNCLASSIFIED])
  panel.toggleCollection(root)
  expect(panel.visibleEntryForGroup(7)).toEqual({ kind: 'collection', id: child })
  panel.toggleCollection(child)
  expect(panel.rows.value.map((row) => row.id)).toContain(7)
  expect(panel.visibleEntryForGroup(7)).toEqual({ kind: 'group', id: 7 })
  panel.collapseAll()
  panel.toggleCollection(UNCLASSIFIED)
  expect(panel.rows.value.map((row) => row.id)).toEqual([root, UNCLASSIFIED, 8])
  const empty = panel.createCollection(child)!
  query.value = 'House'
  expect(panel.rows.value.map((row) => row.id)).toContain(empty)
})

it('inherits restrictions without overwriting child flags and filters selection/edits consistently', () => {
  const { store, scheme, root, child } = setup()
  useEditorSelection().updateSelection(['a'], false)
  store.setCollectionRestriction(root, 'locked', true)
  expect(store.effectiveLockedGroupIds.has(7)).toBe(true)
  expect(store.isItemEditable('a')).toBe(false)
  expect(scheme.selectedItemIds.value.size).toBe(0)
  store.setGroupLocked(7, true)
  store.setCollectionRestriction(root, 'locked', false)
  expect(store.isItemEditable('a')).toBe(false)
  store.setGroupHidden(7, true)
  store.setCollectionRestriction(root, 'hidden', true)
  store.setCollectionRestriction(child, 'hidden', true)
  expect(store.hiddenGroupCount).toBe(1)
  store.setCollectionRestriction(root, 'hidden', false)
  expect(store.isItemVisible('a')).toBe(false)
  store.showAllGroups()
  expect(store.isItemVisible('a')).toBe(true)
  expect(store.isItemEditable('a')).toBe(false)
  expect(store.hiddenGroupCount).toBe(0)
})

it('shows a hidden collection through its ancestors while retaining child hiding', () => {
  const { store, scheme, panel, root, child, query } = setup()
  const sibling = panel.createCollection(root)!,
    hiddenChild = panel.createCollection(child)!
  panel.move({ kind: 'group', id: 8 }, sibling)
  scheme.items.value = [
    ...scheme.items.value,
    makeAppItem({ internalId: 'hidden-child', groupId: 9 }),
    makeAppItem({ internalId: 'hidden-group', groupId: 10 }),
    makeAppItem({ internalId: 'loose', groupId: 0 }),
  ]
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    groups: [
      ...scheme.collectionTree.value.groups,
      { groupId: 9, collectionId: hiddenChild, order: 0 },
      { groupId: 10, collectionId: child, order: 1 },
    ],
  }
  store.setCollectionRestriction(root, 'hidden', true)
  store.setCollectionRestriction(hiddenChild, 'hidden', true)
  store.setGroupHidden(10, true)
  store.setGroupLocked(8, true)
  panel.collapseAll()
  query.value = 'House'
  const tree = scheme.collectionTree.value,
    items = scheme.items.value
  store.showOnly({ kind: 'collection', id: child })
  expect(store.renderItemIds).toEqual(new Set(['a']))
  expect(scheme.hiddenCollectionIds.value).toEqual(new Set([hiddenChild, sibling]))
  expect(scheme.hiddenGroupIds.value.has(10)).toBe(true)
  store.showOnly({ kind: 'collection', id: sibling })
  expect(store.renderItemIds).toEqual(new Set(['b']))
  expect(store.isItemEditable('b')).toBe(false)
  store.showOnly({ kind: 'collection', id: child })
  expect(store.renderItemIds).toEqual(new Set(['a']))
  // 按住 Alt 点击组，即使上级分支被隐藏也应能显示该组。
  store.showOnly({ kind: 'group', id: 9 })
  expect(store.renderItemIds).toEqual(new Set(['hidden-child']))
  store.showOnly({ kind: 'collection', id: sibling })
  expect(store.renderItemIds).toEqual(new Set(['b']))
  store.showAllGroups()
  expect(store.renderItemIds).toBeNull()
  expect(store.isItemVisible('b')).toBe(true)
  expect(scheme.items.value).toBe(items)
  expect(scheme.collectionTree.value).toBe(tree)
})

it('removes membership with group deletion and restores it on undo, retaining empty folders', () => {
  const { store, scheme, child, history } = setup()
  useEditorSelection().updateSelection(['a'], false)
  useEditorManipulation().deleteSelected()
  expect(scheme.collectionTree.value.groups).toEqual([
    { groupId: 8, name: 'Garden', collectionId: null, order: 8 },
  ])
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === child)).toBe(true)
  history.undo()
  expect(scheme.collectionTree.value.groups[0]?.collectionId).toBe(child)
  expect(store.groupsMap.has(7)).toBe(true)
})

it('follows whole-group renumbering through replay and inverse without losing classification', () => {
  const { scheme, child } = setup()
  const before = scheme.items.value[0]!
  const tx = {
    id: 'renumber',
    schemeId: scheme.id,
    createdAt: 0,
    intent: 'test',
    ops: [
      {
        type: 'patch_items' as const,
        changes: [{ itemId: 'a', before, after: { ...before, groupId: 20 } }],
      },
    ],
  }
  applyEditorTransactionToScheme(scheme, tx)
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 20)).toMatchObject({
    groupId: 20,
    collectionId: child,
  })
  applyEditorTransactionToScheme(scheme, invertEditorTransaction(tx))
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)).toMatchObject({
    groupId: 7,
    collectionId: child,
  })
  expect(
    reconcileCollectionGroups(
      scheme.collectionTree.value,
      getGroupChanges(scheme.items.value, scheme.items.value)
    )
  ).toBe(scheme.collectionTree.value)
})

it('round-trips named classifications and keeps personal flags out of shared data and game export', async () => {
  const { store, scheme, root, child } = setup()
  store.setCollectionRestriction(root, 'hidden', true)
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  scheme.collapsedCollectionIds.value = new Set([root])
  const shared = buildSharedSchemeSnapshot(scheme)
  expect(shared.collectionTree).toEqual(scheme.collectionTree.value)
  for (const field of [
    'groupNames',
    'hiddenGroupIds',
    'lockedGroupIds',
    'hiddenCollectionIds',
    'lockedCollectionIds',
    'collapsedCollectionIds',
  ]) {
    expect(shared).not.toHaveProperty(field)
  }
  const archiveId = store.openArchivedSchemeSnapshot(shared)
  expect(store.getSchemeById(archiveId)!.collectionTree.value).toEqual(shared.collectionTree)
  const file = buildSchemeHistoryFile({
    schemeId: scheme.id,
    source: 'local',
    name: 'test',
    items: scheme.items.value,
    groupOrigins: scheme.groupOrigins.value,
    collectionTree: scheme.collectionTree.value,
  })
  expect(parseSchemeHistoryFile(JSON.parse(JSON.stringify(file)))!.collectionTree).toEqual(
    shared.collectionTree
  )
  store.closeScheme(scheme.id)
  expect(JSON.stringify(store.closedSchemesHistory[0]!.gameData)).not.toContain('collection')
  expect((await store.reopenClosedScheme(0)).success).toBe(true)
  expect(
    store.activeScheme!.collectionTree.value.groups.find((group) => group.groupId === 7)
  ).toMatchObject({ name: 'Walls', collectionId: child })
  expect(store.activeScheme!.hiddenGroupIds.value).toEqual(new Set([7]))
  expect(store.activeScheme!.lockedGroupIds.value).toEqual(new Set([8]))
  expect(store.activeScheme!.hiddenCollectionIds.value).toEqual(new Set([root]))
  expect(store.activeScheme!.collapsedCollectionIds.value).toEqual(new Set([root]))
})

it('invalidates old directory undo entries after remote directory changes, including empty folders', () => {
  const { scheme, history } = setup()
  scheme.source.value = 'cloud'
  history.markTransactionsStale(scheme.id, new Set(), new Set(), true)
  expect(scheme.history.value!.transactionUndoStack.every((entry) => entry.stale)).toBe(true)
})

it('gates cloud directory editing on server capability and connection, allowing sequential queued edits', () => {
  const { store, scheme, panel } = setup()
  scheme.source.value = 'cloud'
  scheme.collectionsSupported.value = false
  const before = scheme.collectionTree.value
  expect(panel.createCollection()).toBeNull()
  expect(scheme.collectionTree.value).toBe(before)
  scheme.collectionsSupported.value = true
  expect(panel.canEdit.value).toBe(false)
  const cloud = useCloudSchemeStore()
  cloud.schemeId = scheme.id
  cloud.status = 'connected'
  expect(panel.canEdit.value).toBe(true)
  panel.createCollection()
  expect(store.peekPendingTransaction(scheme.id)).not.toBeNull()
  expect(panel.canEdit.value).toBe(true)
  expect(panel.createCollection()).not.toBeNull()
})

it('rejects cycles, duplicate assignments, invalid parents and reserved IDs', () => {
  expect(isCollectionTree(emptyCollectionTree())).toBe(true)
  const nodes = [{ id: 'a', name: 'A', parentId: null, order: 0 }]
  expect(
    isCollectionTree({ nodes, groups: [{ groupId: 7, collectionId: 'missing', order: 0 }] })
  ).toBe(false)
  expect(isCollectionTree({ nodes: [{ ...nodes[0], parentId: 'a' }], groups: [] })).toBe(false)
  expect(isCollectionTree({ nodes: [{ ...nodes[0], id: UNCLASSIFIED }], groups: [] })).toBe(false)
  const group = { groupId: 7, collectionId: 'a', order: 0 }
  expect(isCollectionTree({ nodes, groups: [group, group] })).toBe(false)
})

it('keeps hundreds of grouped items out of collapsed branches without altering scheme data', () => {
  const { scheme, panel, query } = setup()
  scheme.items.value = Array.from({ length: 500 }, (_, i) =>
    makeAppItem({ internalId: `item-${i}`, groupId: i + 1 })
  )
  scheme.collectionTree.value = {
    nodes: Array.from({ length: 10 }, (_, i) => ({
      id: `folder-${i}`,
      name: `Section ${i}`,
      parentId: null,
      order: i,
    })),
    groups: Array.from({ length: 500 }, (_, i) => ({
      groupId: i + 1,
      collectionId: `folder-${Math.floor(i / 50)}`,
      order: i % 50,
    })),
  }
  const items = scheme.items.value
  panel.collapseAll()
  expect(panel.rows.value).toHaveLength(10)
  query.value = 'Section 0'
  expect(panel.rows.value).toHaveLength(51)
  query.value = ''
  expect(panel.rows.value).toHaveLength(10)
  expect(scheme.items.value).toBe(items)
})

it('preserves unaffected row references when folding and reopening a large branch', () => {
  const { scheme, panel, root, child } = setup()
  scheme.items.value = Array.from({ length: 500 }, (_, i) =>
    makeAppItem({ internalId: `item-${i}`, groupId: i + 1 })
  )
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    groups: Array.from({ length: 499 }, (_, i) => ({
      groupId: i + 1,
      collectionId: child,
      order: i,
    })),
  }
  const before = panel.rows.value
  const unaffected = before.find((row) => row.kind === 'group' && row.id === 500)!
  panel.toggleCollection(root)
  const collapsed = panel.rows.value
  expect(collapsed).toHaveLength(3)
  expect(collapsed.find((row) => row.kind === 'group')).toBe(unaffected)
  panel.toggleCollection(root)
  expect(panel.rows.value).toHaveLength(before.length)
  expect(panel.rows.value.find((row) => row.id === 500)).toBe(unaffected)
})

it('applies unclassified restrictions dynamically without overwriting group flags', () => {
  const { store, scheme, panel, root, history } = setup()
  const before = scheme.items.value
  const historySize = scheme.history.value!.transactionUndoStack.length
  store.setCollectionRestriction(UNCLASSIFIED, 'hidden', true)
  store.setCollectionRestriction(UNCLASSIFIED, 'locked', true)
  expect(store.isItemVisible('a')).toBe(true)
  expect(store.isItemVisible('b')).toBe(false)
  expect(scheme.hiddenGroupIds.value.size).toBe(0)
  expect(scheme.lockedGroupIds.value.size).toBe(0)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(historySize)
  expect(scheme.items.value).toBe(before)
  expect(panel.rows.value.find((row) => row.id === UNCLASSIFIED)).toMatchObject({
    hidden: true,
    locked: true,
  })
  expect(panel.restriction(null, 'locked')).toBe('groups.unclassified')

  panel.move({ kind: 'group', id: 8 }, root)
  expect(store.isItemEditable('b')).toBe(true)
  history.undo()
  expect(store.isItemVisible('b')).toBe(false)
  history.redo()
  expect(store.isItemEditable('b')).toBe(true)
  store.setGroupHidden(8, true)
  store.setGroupLocked(8, true)
  panel.move({ kind: 'group', id: 8 }, null)
  store.setCollectionRestriction(UNCLASSIFIED, 'hidden', false)
  store.setCollectionRestriction(UNCLASSIFIED, 'locked', false)
  expect(store.isItemVisible('b')).toBe(false)
  expect(store.isItemEditable('b')).toBe(false)

  store.setCollectionRestriction(UNCLASSIFIED, 'hidden', true)
  store.setCollectionRestriction(UNCLASSIFIED, 'locked', true)
  setSchemeItems(scheme, [
    ...scheme.items.value,
    makeAppItem({ internalId: 'new-group', groupId: 9 }),
    makeAppItem({ internalId: 'loose', groupId: 0 }),
  ])
  expect(store.isItemVisible('new-group')).toBe(false)
  expect(store.effectiveLockedGroupIds.has(9)).toBe(true)
  expect(store.isItemEditable('loose')).toBe(true)
  store.showAllGroups()
  expect(store.isItemVisible('new-group')).toBe(true)
  expect(store.isItemEditable('new-group')).toBe(false)
  expect(scheme.hiddenCollectionIds.value.size).toBe(0)
})

it('shows only unclassified groups while retaining their own hiding', () => {
  const { store, scheme, panel } = setup()
  setSchemeItems(scheme, [
    ...scheme.items.value,
    makeAppItem({ internalId: 'hidden-own', groupId: 9 }),
    makeAppItem({ internalId: 'loose', groupId: 0 }),
  ])
  store.setGroupHidden(9, true)
  store.setCollectionRestriction(UNCLASSIFIED, 'hidden', true)
  const tree = scheme.collectionTree.value
  store.showOnly({ kind: 'collection', id: UNCLASSIFIED })
  expect(store.renderItemIds).toEqual(new Set(['b']))
  expect(scheme.hiddenCollectionIds.value.has(UNCLASSIFIED)).toBe(false)
  expect(scheme.hiddenGroupIds.value.has(9)).toBe(true)
  store.setCollectionRestriction(UNCLASSIFIED, 'hidden', true)
  store.showOnly({ kind: 'group', id: 8 })
  expect(store.renderItemIds).toEqual(new Set(['b']))
  store.showOnly({ kind: 'collection', id: UNCLASSIFIED })
  expect(store.renderItemIds).toEqual(new Set(['b']))
  expect(scheme.collectionTree.value).toBe(tree)
  expect(panel.restriction(null, 'hidden')).toBeUndefined()
})

it('keeps the unclassified restriction controls reachable after deleting the last collection', () => {
  const { store, scheme, panel, child, root } = setup()
  store.setCollectionRestriction(UNCLASSIFIED, 'locked', true)
  panel.deleteCollection(child)
  panel.deleteCollection(root)
  expect(scheme.collectionTree.value.nodes).toHaveLength(0)
  expect(panel.rows.value[0]).toMatchObject({ id: UNCLASSIFIED, locked: true })
  store.setCollectionRestriction(UNCLASSIFIED, 'locked', false)
  expect(panel.rows.value.every((row) => row.kind === 'group')).toBe(true)
})

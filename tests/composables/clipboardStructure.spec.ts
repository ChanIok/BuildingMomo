import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useTabStore } from '@/stores/tabStore'
import { useClipboard } from '@/composables/editor/useClipboard'
import { useEditorRemoval } from '@/composables/editor/useEditorRemoval'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { applyEditorTransactionToScheme } from '@/lib/scheme/editorTransactions'
import { isCollectionTree } from '@/lib/scheme/collectionTree'
import { makeAppItem, makeScheme } from '../fixtures/item'

vi.mock('@/composables/app/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, args?: { name: string }) => (args ? `${args.name} copy` : key),
  }),
}))

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const store = useEditorStore()
  store.createScheme('source')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({
      internalId: 'roof',
      instanceId: 10,
      groupId: 7,
      x: 42,
      extra: { AttachID: 0, Scale: { X: 1, Y: 2, Z: 3 }, TempInfo: { points: [[1, 2, 3]] } },
    }),
    makeAppItem({ internalId: 'wall', instanceId: 11, groupId: 8 }),
    makeAppItem({ internalId: 'tree', instanceId: 12, groupId: 9 }),
    makeAppItem({ internalId: 'other', instanceId: 13, groupId: 10 }),
    makeAppItem({ internalId: 'loose', instanceId: 14 }),
  ]
  scheme.maxGroupId.value = 10
  scheme.maxInstanceId.value = 14
  scheme.collectionTree.value = {
    nodes: [
      { id: 'tea', name: 'Tea', parentId: null, order: 0 },
      { id: 'outdoor', name: 'Outdoor', parentId: 'tea', order: 0 },
      { id: 'building', name: 'Building', parentId: 'outdoor', order: 2 },
      { id: 'empty', name: 'Empty', parentId: 'outdoor', order: 1 },
      { id: 'indoor', name: 'Indoor', parentId: 'tea', order: 1 },
    ],
    groups: [
      { groupId: 7, name: 'Roof', collectionId: 'building', order: 2 },
      { groupId: 8, name: 'Wall', collectionId: 'building', order: 1 },
      { groupId: 9, name: 'Tree', collectionId: 'outdoor', order: 0 },
      { groupId: 10, name: 'Other', collectionId: 'indoor', order: 0 },
    ],
  }
  scheme.groupOrigins.value = new Map([
    [7, 'roof'],
    [8, 'wall'],
    [9, 'tree'],
  ])
  scheme.collapsedCollectionIds.value = new Set(['tea', 'outdoor'])
  store.triggerSceneUpdate()
  return { store, scheme, clipboard: useClipboard(), history: useEditorHistory() }
}
const outdoor = [{ kind: 'collection', id: 'outdoor' }] as const

it.each(['delete', 'cut'] as const)(
  '%s removes explicit protected subtrees and editable carried items in one reversible transaction',
  (operation) => {
    const { store, scheme, clipboard, history } = setup()
    store.setGroupHidden(7, true)
    store.setGroupLocked(8, true)
    store.setCollectionRestriction('outdoor', 'hidden', true)
    store.setGroupLocked(10, true)
    scheme.selectedEntries.value = [
      ...outdoor,
      { kind: 'collection', id: 'building' },
      { kind: 'group', id: 7 },
    ]
    // 全部集合成员都受保护，画布额外选区仍只处理可编辑项。
    scheme.selectedItemIds.value = new Set(['roof', 'loose', 'other'])
    scheme.activeCollectionId.value = 'building'
    scheme.maxInstanceId.value = 1200
    const entries = scheme.selectedEntries.value
    const beforeItems = scheme.items.value
    const beforeTree = scheme.collectionTree.value
    const origins = scheme.groupOrigins.value
    const hidden = scheme.hiddenCollectionIds.value
    const locked = scheme.lockedGroupIds.value
    const expectedIds = ['roof', 'wall', 'tree', 'loose']
    const copy = clipboard.buildClipboardDataFromSelection()
    expect(copy.items.map((item) => item.internalId)).toEqual(expectedIds)

    const removal = useEditorRemoval()
    expect(removal.canRemove()).toBe(true)
    expect(clipboard.canCut()).toBe(true)
    expect(operation === 'cut' ? clipboard.cut() : removal.remove()).toBe(true)
    expect(scheme.items.value).toEqual([beforeItems[3]])
    expect(scheme.items.value[0]).toBe(beforeItems[3])
    expect(scheme.collectionTree.value.nodes.map((node) => node.id)).toEqual(['tea', 'indoor'])
    expect(scheme.collectionTree.value.groups).toEqual([beforeTree.groups[3]])
    expect(scheme.groupOrigins.value.size).toBe(0)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(scheme.selectedEntries.value).toEqual([])
    expect(scheme.activeCollectionId.value).toBeNull()
    expect(scheme.hiddenCollectionIds.value).toBe(hidden)
    expect(scheme.lockedGroupIds.value).toBe(locked)
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
    const transaction = scheme.history.value!.transactionUndoStack[0]!
    expect(transaction.entriesBefore).toEqual(entries)
    expect(transaction.entriesAfter).toEqual([])
    const removed = transaction.transaction.ops.find((op) => op.type === 'remove_items')!
    expect(removed.items.map((item) => item.internalId)).toEqual(expectedIds)
    if (operation === 'cut') expect(clipboard.clipboard.value).toEqual(copy)

    history.undo()
    expect(new Map(scheme.items.value.map((item) => [item.internalId, item]))).toEqual(
      new Map(beforeItems.map((item) => [item.internalId, item]))
    )
    expect(scheme.collectionTree.value).toEqual(beforeTree)
    expect(scheme.groupOrigins.value).toEqual(origins)
    expect(scheme.selectedEntries.value).toEqual(entries)
    expect(store.isItemVisible('roof')).toBe(false)
    expect(store.isItemEditable('wall')).toBe(false)
    expect(scheme.maxGroupId.value).toBe(10)
    expect(scheme.maxInstanceId.value).toBe(1200)
    history.redo()
    expect(scheme.items.value.map((item) => item.internalId)).toEqual(['other'])
    expect(scheme.collectionTree.value.nodes.map((node) => node.id)).toEqual(['tea', 'indoor'])
    expect(scheme.selectedEntries.value).toEqual([])
    if (operation === 'cut') {
      clipboard.paste()
      expect(scheme.items.value).toHaveLength(5)
      expect(scheme.collectionTree.value.nodes).toHaveLength(5)
      expect(isCollectionTree(scheme.collectionTree.value)).toBe(true)
    }
  }
)

it('cuts a specified protected collection without carrying or clearing unrelated selections', () => {
  const { store, scheme, clipboard } = setup()
  store.setCollectionRestriction('outdoor', 'locked', true)
  scheme.selectedEntries.value = [
    ...outdoor,
    { kind: 'collection', id: 'indoor' },
    { kind: 'ungrouped', id: 0 },
  ]
  scheme.selectedItemIds.value = new Set(['other', 'loose'])
  expect(clipboard.cut(outdoor)).toBe(true)
  expect(clipboard.clipboard.value.items.map((item) => item.internalId)).toEqual([
    'roof',
    'wall',
    'tree',
  ])
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['other', 'loose'])
  expect(scheme.selectedItemIds.value).toEqual(new Set(['other', 'loose']))
  expect(scheme.selectedEntries.value).toEqual([
    { kind: 'collection', id: 'indoor' },
    { kind: 'ungrouped', id: 0 },
  ])
})

it('cuts empty collections without touching furniture and pastes them across schemes', () => {
  const { store, scheme, clipboard, history } = setup()
  scheme.selectedEntries.value = [{ kind: 'collection', id: 'empty' }]
  const items = scheme.items.value
  const origins = scheme.groupOrigins.value
  const sceneVersion = store.sceneVersion
  expect(clipboard.canCopy()).toBe(true)
  expect(clipboard.canCut()).toBe(true)
  expect(clipboard.cut()).toBe(true)
  expect(scheme.items.value).toBe(items)
  expect(scheme.groupOrigins.value).toBe(origins)
  expect(store.sceneVersion).toBe(sceneVersion)
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === 'empty')).toBe(false)
  expect(clipboard.clipboard.value.structure.tree.nodes.map((node) => node.id)).toEqual(['empty'])
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  history.undo()
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === 'empty')).toBe(true)
  expect(scheme.selectedEntries.value).toEqual([{ kind: 'collection', id: 'empty' }])
  history.redo()
  expect(scheme.collectionTree.value.nodes.some((node) => node.id === 'empty')).toBe(false)
  store.createScheme('empty destination')
  clipboard.paste()
  expect(store.activeScheme!.collectionTree.value.nodes).toHaveLength(1)
  expect(store.activeScheme!.collectionTree.value.nodes[0]!.name).toBe('Empty')
  expect(store.activeScheme!.items.value).toEqual([])
})

it('cuts canvas furniture without deleting its now-empty containing collection or ancestors', () => {
  const { scheme, clipboard } = setup()
  scheme.selectedItemIds.value = new Set(['roof', 'wall'])
  const nodes = scheme.collectionTree.value.nodes
  expect(clipboard.cut()).toBe(true)
  expect(scheme.collectionTree.value.nodes).toBe(nodes)
  expect(clipboard.clipboard.value.structure.tree.nodes).toEqual([])
  expect(scheme.selectedEntries.value).toBeNull()
})

it('rejects stale and unavailable cloud cuts without overwriting the clipboard or deleting partial targets', () => {
  const { scheme, clipboard } = setup()
  clipboard.copy(outdoor)
  const previous = clipboard.clipboard.value
  const items = scheme.items.value
  const tree = scheme.collectionTree.value
  scheme.selectedEntries.value = [...outdoor, { kind: 'collection', id: 'missing' }]
  expect(clipboard.canCut()).toBe(false)
  expect(clipboard.cut()).toBe(false)
  scheme.selectedEntries.value = outdoor
  scheme.source.value = 'cloud'
  expect(clipboard.canCut()).toBe(false)
  expect(clipboard.cut()).toBe(false)
  useCloudSchemeStore().schemeId = scheme.id
  useCloudSchemeStore().status = 'connected'
  scheme.collectionsSupported.value = false
  expect(clipboard.canCut()).toBe(false)
  expect(clipboard.cut()).toBe(false)
  expect(clipboard.clipboard.value).toBe(previous)
  expect(scheme.items.value).toBe(items)
  expect(scheme.collectionTree.value).toBe(tree)
  expect(scheme.history.value).toBeUndefined()
})

it.each(['delete', 'cut'] as const)(
  'keeps offline canvas %s available without collection capabilities',
  (operation) => {
    const { store, scheme, clipboard } = setup()
    scheme.source.value = 'cloud'
    scheme.collectionsSupported.value = false
    scheme.selectedItemIds.value = new Set(['roof'])
    expect(operation === 'cut' ? clipboard.cut() : useEditorRemoval().remove()).toBe(true)
    expect(scheme.items.value.some((item) => item.internalId === 'roof')).toBe(false)
    expect(scheme.collectionTree.value.nodes).toHaveLength(5)
    expect(store.pendingTransactions).toHaveLength(1)
  }
)

it('captures complete panel subtrees, empty folders and own restrictions without carried canvas items', () => {
  const { store, scheme, clipboard } = setup()
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  store.setCollectionRestriction('tea', 'hidden', true)
  store.setCollectionRestriction('empty', 'locked', true)
  scheme.selectedItemIds.value = new Set(['loose'])
  const before = scheme.items.value
  clipboard.copy([...outdoor, { kind: 'collection', id: 'building' }, { kind: 'group', id: 7 }])
  const data = clipboard.clipboard.value
  expect(data.items.map((item) => item.internalId)).toEqual(['roof', 'wall', 'tree'])
  expect(data.structure.tree.nodes.map((node) => node.id).sort()).toEqual([
    'building',
    'empty',
    'outdoor',
  ])
  expect(data.structure.hiddenGroups).toEqual([7])
  expect(data.structure.lockedGroups).toEqual([8])
  expect(data.structure.hiddenCollections).toEqual([])
  expect(data.structure.lockedCollections).toEqual(['empty'])
  expect(data.structure.sourceParents.collections).toEqual(new Map([['outdoor', 'tea']]))
  expect(data.structure.sourceParents.groups.size).toBe(0)
  expect(data.structure.tree.nodes.find((node) => node.id === 'outdoor')!.parentId).toBeNull()
  expect(isCollectionTree(data.structure.tree)).toBe(true)
  expect(scheme.items.value).toBe(before)
  expect(scheme.history.value).toBeUndefined()
  // 不共享可编辑嵌套数据，也不随后续源方案改名而改变。
  expect(data.items[0]!.extra.TempInfo!.points).not.toBe(before[0]!.extra.TempInfo!.points)
  scheme.collectionTree.value.nodes[1]!.name = 'Changed after copy'
  expect(data.structure.tree.nodes.find((node) => node.id === 'outdoor')!.name).toBe('Outdoor')
})

it('pastes a collection alongside its source with independent IDs and one undoable transaction', () => {
  const { store, scheme, clipboard, history } = setup()
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  store.setCollectionRestriction('empty', 'hidden', true)
  const beforeItems = scheme.items.value
  const beforeTree = scheme.collectionTree.value
  clipboard.copy(outdoor)
  const result = clipboard.pasteItems(clipboard.clipboard.value, 0, 0)
  const nodes = scheme.collectionTree.value.nodes.filter(
    (node) => !beforeTree.nodes.some((old) => old.id === node.id)
  )
  const root = nodes.find((node) => node.name === 'Outdoor copy')!
  expect(root.parentId).toBe('tea')
  expect(nodes).toHaveLength(3)
  expect(
    nodes
      .filter((node) => node.parentId === root.id)
      .map((node) => node.order)
      .sort()
  ).toEqual([1, 2])
  const items = scheme.items.value.slice(beforeItems.length)
  expect(items).toHaveLength(3)
  expect(
    scheme.items.value
      .slice(0, beforeItems.length)
      .every((item, index) => item === beforeItems[index])
  ).toBe(true)
  expect(new Set(items.map((item) => item.groupId)).size).toBe(3)
  expect(items.every((item) => item.groupId > 10)).toBe(true)
  expect(items[0]!.x).toBe(42)
  expect(scheme.hiddenGroupIds.value.has(items[0]!.groupId)).toBe(true)
  expect(scheme.lockedGroupIds.value.has(items[1]!.groupId)).toBe(true)
  expect(
    scheme.hiddenCollectionIds.value.has(nodes.find((node) => node.name === 'Empty')!.id)
  ).toBe(true)
  expect(scheme.groupOrigins.value.get(items[0]!.groupId)).toBe(items[0]!.internalId)
  expect(scheme.selectedItemIds.value).toEqual(new Set([items[2]!.internalId]))
  expect(result.roots).toEqual([{ kind: 'collection', id: root.id }])
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  const max = scheme.maxGroupId.value
  history.undo()
  expect(scheme.items.value).toEqual(beforeItems)
  expect(scheme.collectionTree.value).toEqual(beforeTree)
  expect(scheme.maxGroupId.value).toBe(max)
  history.redo()
  expect(scheme.collectionTree.value.nodes).toContainEqual(root)
  expect(store.isItemVisible(items[0]!.internalId)).toBe(false)
  expect(store.isItemEditable(items[1]!.internalId)).toBe(false)
})

it('repeats collection paste into a specified parent and into the root without nesting in the source', () => {
  const { scheme, clipboard } = setup()
  clipboard.copy(outdoor)
  const first = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, 'indoor').roots[0]!
  expect(scheme.collectionTree.value.nodes.find((node) => node.id === first.id)!.parentId).toBe(
    'indoor'
  )
  const second = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, null).roots[0]!
  expect(second.id).not.toBe(first.id)
  expect(
    scheme.collectionTree.value.nodes.find((node) => node.id === second.id)!.parentId
  ).toBeNull()
})

it('copies an explicit collection across schemes without its external ancestors or name-based merging', () => {
  const { store, clipboard } = setup()
  clipboard.copy(outdoor)
  store.createScheme('destination')
  const dest = store.activeScheme!
  dest.collectionTree.value = {
    nodes: [{ id: 'existing', name: 'Outdoor', parentId: null, order: 0 }],
    groups: [],
  }
  clipboard.paste()
  const root = dest.collectionTree.value.nodes.find(
    (node) => node.id !== 'existing' && node.parentId === null
  )!
  expect(root.name).toBe('Outdoor')
  expect(dest.collectionTree.value.nodes).toHaveLength(4)
  expect(dest.collectionTree.value.nodes.some((node) => node.name === 'Tea')).toBe(false)
  expect(dest.collectionTree.value.groups.every((group) => group.collectionId !== 'existing')).toBe(
    true
  )
  expect(dest.items.value).toHaveLength(3)
})

it('retains individual group classifications locally but carries no ancestor collections across schemes', () => {
  const { store, scheme, clipboard } = setup()
  clipboard.copy([
    { kind: 'group', id: 7 },
    { kind: 'group', id: 9 },
  ])
  expect(clipboard.clipboard.value.items).toHaveLength(2)
  const { structure } = clipboard.clipboard.value
  expect(structure.tree.nodes).toEqual([])
  expect(structure.tree.groups.every((group) => group.collectionId === null)).toBe(true)
  expect(structure.sourceParents.groups).toEqual(
    new Map([
      [7, 'building'],
      [9, 'outdoor'],
    ])
  )
  expect(isCollectionTree(structure.tree)).toBe(true)
  // 复制后来源组改变归属，不应改变剪贴板里保存的位置。
  scheme.collectionTree.value = {
    ...scheme.collectionTree.value,
    groups: scheme.collectionTree.value.groups.map((group) =>
      group.groupId === 7 ? { ...group, collectionId: 'indoor' } : group
    ),
  }
  clipboard.paste()
  expect(scheme.collectionTree.value.nodes).toHaveLength(5)
  expect(
    scheme.collectionTree.value.groups
      .slice(-2)
      .map((group) => group.collectionId)
      .sort()
  ).toEqual(['building', 'outdoor'])
  store.createScheme('destination')
  const dest = store.activeScheme!
  // 即使目标有同 ID 的集合，跨方案默认粘贴也不复用来源归属。
  const nodes = [{ id: 'building', name: 'Building', parentId: null, order: 0 }]
  dest.collectionTree.value = { nodes, groups: [] }
  const result = clipboard.pasteItems(clipboard.clipboard.value, 0, 0)
  expect(dest.collectionTree.value.nodes).toEqual(nodes)
  expect(dest.collectionTree.value.groups.every((group) => group.collectionId === null)).toBe(true)
  expect(result.roots).toEqual(
    dest.collectionTree.value.groups.map((group) => ({ kind: 'group', id: group.groupId }))
  )
  expect(dest.selectedEntries.value).toEqual(result.roots)
  expect(dest.collectionTree.value.groups.map((group) => group.name).sort()).toEqual([
    'Roof',
    'Tree',
  ])
  expect(isCollectionTree(dest.collectionTree.value)).toBe(true)
})

it.each(['group', 'collection'] as const)(
  'pastes a %s at the root when its source parent was deleted without rebuilding ancestors',
  (kind) => {
    const { scheme, clipboard } = setup()
    if (kind === 'group') clipboard.copy([{ kind, id: 7 }])
    else clipboard.copy(outdoor)
    const parent = kind === 'group' ? 'building' : 'tea'
    expect(useEditorRemoval().remove([{ kind: 'collection', id: parent }])).toBe(true)
    const nodes = scheme.collectionTree.value.nodes
    const result = clipboard.pasteItems(clipboard.clipboard.value, 0, 0)
    if (kind === 'group') {
      expect(scheme.collectionTree.value.nodes).toEqual(nodes)
      expect(scheme.collectionTree.value.groups.at(-1)!.collectionId).toBeNull()
    } else {
      const root = scheme.collectionTree.value.nodes.find(
        (node) => node.id === result.roots[0]!.id
      )!
      expect(root.name).toBe('Outdoor copy')
      expect(root.parentId).toBeNull()
      expect(scheme.collectionTree.value.nodes).toHaveLength(3)
    }
    expect(result.roots).toHaveLength(1)
    expect(isCollectionTree(scheme.collectionTree.value)).toBe(true)
  }
)

it.each(['destination', null])(
  'pastes mixed roots across schemes into %s while preserving their internal hierarchy',
  (parentId) => {
    const { store, clipboard } = setup()
    clipboard.copy([...outdoor, { kind: 'group', id: 10 }])
    store.createScheme('destination')
    const scheme = store.activeScheme!
    scheme.collectionTree.value = {
      nodes: [{ id: 'destination', name: 'Destination', parentId: null, order: 0 }],
      groups: [],
    }
    const result = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, parentId)
    const tree = scheme.collectionTree.value
    const root = tree.nodes.find((node) => node.name === 'Outdoor')!
    const building = tree.nodes.find((node) => node.name === 'Building')!
    const group = tree.groups.find((group) => group.name === 'Other')!
    expect(root.parentId).toBe(parentId)
    expect(group.collectionId).toBe(parentId)
    expect(building.parentId).toBe(root.id)
    expect(tree.nodes.find((node) => node.name === 'Empty')!.parentId).toBe(root.id)
    expect(tree.groups.find((group) => group.name === 'Roof')!.collectionId).toBe(building.id)
    expect(tree.groups.find((group) => group.name === 'Tree')!.collectionId).toBe(root.id)
    expect(
      tree.groups.filter((group) => group.collectionId === building.id).map((g) => g.order)
    ).toEqual([1, 2])
    expect(tree.nodes).toHaveLength(4)
    expect(result.roots).toEqual([
      { kind: 'collection', id: root.id },
      { kind: 'group', id: group.groupId },
    ])
    expect(isCollectionTree(tree)).toBe(true)
  }
)

it('cuts a group out for editing and back into its original collection without duplicating parents', () => {
  const { store, scheme: source, clipboard, history } = setup()
  const sourceNodes = source.collectionTree.value.nodes
  expect(clipboard.cut([{ kind: 'group', id: 7 }])).toBe(true)
  store.createScheme('workbench')
  const workbench = store.activeScheme!
  workbench.collectionTree.value = {
    nodes: [{ id: 'bench', name: 'Bench', parentId: null, order: 0 }],
    groups: [],
  }
  const first = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, 'bench')
  const groupId = workbench.items.value[0]!.groupId
  expect(workbench.collectionTree.value.nodes).toHaveLength(1)
  history.recordTransaction('test.edit', () => {
    workbench.items.value = workbench.items.value.map((item) => ({ ...item, x: item.x + 10 }))
    store.triggerSceneUpdate()
  })
  expect(clipboard.cut(first.roots)).toBe(true)
  expect(clipboard.clipboard.value.structure.tree.nodes).toEqual([])
  expect(clipboard.clipboard.value.structure.sourceParents.groups).toEqual(
    new Map([[groupId, 'bench']])
  )
  expect(workbench.items.value).toEqual([])
  useTabStore().openSchemeTab(source.id, source.name.value)
  const result = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, 'building')
  const returned = source.items.value.find((item) => item.internalId === result.newIds[0])!
  const returnedGroup = source.collectionTree.value.groups.find(
    (group) => group.groupId === returned.groupId
  )!
  expect(returned.x).toBe(52)
  expect(returnedGroup.name).toBe('Roof')
  expect(returnedGroup.collectionId).toBe('building')
  expect(source.groupOrigins.value.get(returned.groupId)).toBe(returned.internalId)
  expect(source.collectionTree.value.nodes).toEqual(sourceNodes)
  expect(source.items.value).toHaveLength(5)
  const maxGroupId = source.maxGroupId.value
  history.undo()
  expect(source.items.value).toHaveLength(4)
  expect(source.collectionTree.value.nodes).toEqual(sourceNodes)
  expect(source.maxGroupId.value).toBe(maxGroupId)
  history.redo()
  expect(source.items.value).toContainEqual(returned)
  expect(source.collectionTree.value.groups).toContainEqual(returnedGroup)
  expect(source.collectionTree.value.nodes).toEqual(sourceNodes)
})

it('takes a canvas item selection without expanding to its unselected group or collection siblings', () => {
  const { scheme, clipboard } = setup()
  scheme.items.value = [
    ...scheme.items.value,
    makeAppItem({ internalId: 'roof2', groupId: 7, instanceId: 15 }),
  ]
  scheme.selectedItemIds.value = new Set(['roof', 'tree'])
  const data = clipboard.buildClipboardDataFromSelection()
  expect(data.items.map((item) => item.internalId)).toEqual(['roof', 'tree'])
  expect(data.structure.tree.nodes).toEqual([])
  scheme.selectedItemIds.value = new Set(['roof'])
  expect(clipboard.buildClipboardDataFromSelection().items[0]!.groupId).toBe(0)
  const panelSingle = clipboard.buildClipboardDataFromSelection([{ kind: 'group', id: 9 }])
  expect(panelSingle.items[0]!.groupId).toBe(9)
})

it.each(['group', 'collection'] as const)(
  'keeps a mixed %s and loose-item selection complete across repeated duplicates',
  (kind) => {
    const { scheme, clipboard, history } = setup()
    scheme.selectedEntries.value = kind === 'group' ? [{ kind, id: 7 }] : outdoor
    const ids = kind === 'group' ? ['roof', 'loose'] : ['roof', 'wall', 'tree', 'loose']
    scheme.selectedItemIds.value = new Set(ids)
    let selected = new Set(ids)

    for (let round = 1; round <= 3; round++) {
      const data = clipboard.buildClipboardDataFromSelection()
      expect(new Set(data.items.map((item) => item.internalId))).toEqual(selected)
      expect(data.structure.tree.nodes).toHaveLength(kind === 'group' ? 0 : 3)
      const result = clipboard.pasteItems(data, 0, 0)
      expect(result.newIds).toHaveLength(ids.length)
      expect(scheme.items.value).toHaveLength(5 + round * ids.length)
      selected = new Set(result.newIds)
      expect(scheme.selectedItemIds.value).toEqual(selected)
      expect(scheme.selectedEntries.value).toEqual(result.roots)
      expect(
        scheme.items.value.filter((item) => selected.has(item.internalId) && item.groupId === 0)
      ).toHaveLength(1)
    }

    history.undo()
    history.redo()
    const data = clipboard.buildClipboardDataFromSelection()
    expect(new Set(data.items.map((item) => item.internalId))).toEqual(selected)
  }
)

it('copies complete implicit nodes plus editable carried items without widening explicit node requests', () => {
  const { store, scheme, clipboard } = setup()
  store.setGroupHidden(7, true)
  store.setGroupLocked(10, true)
  scheme.selectedEntries.value = outdoor
  scheme.selectedItemIds.value = new Set(['tree', 'loose', 'other'])
  expect(clipboard.buildClipboardDataFromSelection().items.map((item) => item.internalId)).toEqual([
    'roof',
    'wall',
    'tree',
    'loose',
  ])
  expect(
    clipboard.buildClipboardDataFromSelection(outdoor).items.map((item) => item.internalId)
  ).toEqual(['roof', 'wall', 'tree'])
  expect(clipboard.buildClipboardDataFromSelection([]).items).toEqual([])
})

it('keeps step-repeated loose items as a canvas selection ready for another duplicate', () => {
  const { scheme, clipboard, history } = setup()
  scheme.selectedItemIds.value = new Set(['loose'])
  clipboard.copy()
  const result = clipboard.advancedPaste({
    mode: 'stepRepeat',
    stepRepeat: {
      repeatCount: 2,
      positionDelta: { x: 10, y: 0, z: 0 },
      rotationDelta: { x: 0, y: 0, z: 0 },
      scaleMultiplier: { x: 1, y: 1, z: 1 },
    },
  })
  expect(scheme.selectedEntries.value).toBeNull()
  expect(scheme.selectedItemIds.value).toEqual(new Set(result.newIds))
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  history.undo()
  expect(scheme.selectedItemIds.value).toEqual(new Set(['loose']))
  history.redo()
  const data = clipboard.buildClipboardDataFromSelection()
  expect(data.items.map((item) => item.internalId)).toEqual(result.newIds)
  expect(clipboard.pasteItems(data, 0, 0).newIds).toHaveLength(2)
})

it('pastes empty collections as one undoable step without updating furniture or the scene', () => {
  const { store, scheme, clipboard, history } = setup()
  const items = scheme.items.value
  const sceneVersion = store.sceneVersion
  clipboard.copy([{ kind: 'collection', id: 'empty' }])
  expect(clipboard.hasClipboardData.value).toBe(true)
  expect(clipboard.clipboard.value.items).toHaveLength(0)
  const result = clipboard.advancedPaste({
    mode: 'stepRepeat',
    stepRepeat: {
      repeatCount: 2,
      positionDelta: { x: 2, y: 0, z: 0 },
      rotationDelta: { x: 0, y: 0, z: 0 },
      scaleMultiplier: { x: 1, y: 1, z: 1 },
    },
  })
  expect(scheme.collectionTree.value.nodes).toHaveLength(7)
  expect(scheme.items.value).toBe(items)
  expect(store.sceneVersion).toBe(sceneVersion)
  expect(result.newIds).toEqual([])
  expect(result.roots).toHaveLength(2)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  history.undo()
  expect(scheme.collectionTree.value.nodes).toHaveLength(5)
})

it('copies virtual unclassified groups without requiring pre-existing group metadata', () => {
  const { scheme, clipboard } = setup()
  scheme.items.value = [
    ...scheme.items.value,
    makeAppItem({ internalId: 'unclassified', groupId: 11 }),
  ]
  scheme.maxGroupId.value = 11
  clipboard.copy([{ kind: 'collection', id: '@unclassified' }])
  expect(clipboard.clipboard.value.items.map((item) => item.internalId)).toEqual(['unclassified'])
  expect(clipboard.clipboard.value.structure.tree.nodes).toEqual([])
  clipboard.paste()
  expect(
    scheme.collectionTree.value.groups.find((group) => group.groupId === 12)!.collectionId
  ).toBeNull()
})

it('step copies independent full subtrees with transformed furniture in a single transaction', () => {
  const { scheme, clipboard, history } = setup()
  clipboard.copy(outdoor)
  const snapshot = clipboard.clipboard.value
  const before = structuredClone(snapshot)
  clipboard.advancedPaste({
    mode: 'stepRepeat',
    stepRepeat: {
      repeatCount: 2,
      positionDelta: { x: 10, y: 0, z: 0 },
      rotationDelta: { x: 0, y: 0, z: 0 },
      scaleMultiplier: { x: 2, y: 1, z: 1 },
    },
  })
  expect(scheme.collectionTree.value.nodes).toHaveLength(11)
  const items = scheme.items.value.slice(5)
  // 固定 Pivot.x = 21，每轮先缩放两倍，再平移 10。
  expect(items.map((item) => item.x)).toEqual([73, -11, -11, 135, -33, -33])
  expect(items[0]!.extra.Scale).toEqual({ X: 1, Y: 4, Z: 3 })
  expect(items[3]!.extra.Scale).toEqual({ X: 1, Y: 8, Z: 3 })
  expect(new Set(items.map((item) => item.groupId)).size).toBe(6)
  expect(clipboard.clipboard.value).toBe(snapshot)
  expect(snapshot).toEqual(before)
  // 插入场景时仍隔离可编辑嵌套数据，各轮副本不能共享飞花道点位。
  items[0]!.extra.TempInfo!.points[0][0] = 99
  expect(items[3]!.extra.TempInfo!.points[0][0]).toBe(1)
  expect(snapshot.items[0]!.extra.TempInfo!.points[0][0]).toBe(1)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(1)
  history.undo()
  expect(scheme.items.value).toHaveLength(5)
  expect(scheme.collectionTree.value.nodes).toHaveLength(5)
})

it('preserve-ID paste remaps existing groups without mixing their collection or restrictions with imported groups', () => {
  const { store, scheme: source, clipboard } = setup()
  clipboard.copy(outdoor)
  store.createScheme('target')
  const scheme = store.activeScheme!
  scheme.items.value = [makeAppItem({ internalId: 'old', instanceId: 10, groupId: 7 })]
  scheme.maxGroupId.value = 10
  scheme.maxInstanceId.value = 14
  scheme.collectionTree.value = {
    nodes: [{ id: 'old-folder', name: 'Existing', parentId: null, order: 0 }],
    groups: [{ groupId: 7, name: 'Old', collectionId: 'old-folder', order: 0 }],
  }
  expect(clipboard.advancedPaste({ mode: 'preserveIds' }).newIds).toHaveLength(3)
  const old = scheme.items.value.find((item) => item.internalId === 'old')!
  expect(old.groupId).not.toBe(7)
  expect(
    scheme.collectionTree.value.groups.find((g) => g.groupId === old.groupId)!.collectionId
  ).toBe('old-folder')
  expect(scheme.collectionTree.value.groups.find((g) => g.groupId === 7)!.name).toBe('Roof')
  expect(scheme.items.value.slice(1).map((item) => item.instanceId)).toEqual(
    source.items.value.slice(0, 3).map((item) => item.instanceId)
  )
})

it('refuses invalid destinations and protected preserve-ID collisions without creating partial trees', () => {
  const { store, clipboard } = setup()
  clipboard.copy(outdoor)
  store.createScheme('target')
  const scheme = store.activeScheme!
  scheme.items.value = [makeAppItem({ internalId: 'old', groupId: 7, instanceId: 10 })]
  scheme.maxGroupId.value = 10
  scheme.maxInstanceId.value = 14
  store.setGroupLocked(7, true)
  const tree = scheme.collectionTree.value
  expect(clipboard.advancedPaste({ mode: 'preserveIds' })).toEqual({ newIds: [], roots: [] })
  expect(clipboard.pasteItems(clipboard.clipboard.value, 0, 0, 'missing')).toEqual({
    newIds: [],
    roots: [],
  })
  expect(scheme.collectionTree.value).toBe(tree)
  expect(scheme.items.value).toHaveLength(1)
  expect(scheme.maxGroupId.value).toBe(10)
})

it.each(['group', 'collection'] as const)(
  'keeps inherited source restrictions external to a %s and inherits destination restrictions instead',
  (kind) => {
    const { store, scheme, clipboard } = setup()
    store.setCollectionRestriction('tea', 'hidden', true)
    store.setCollectionRestriction('indoor', 'locked', true)
    if (kind === 'group') clipboard.copy([{ kind, id: 7 }])
    else clipboard.copy(outdoor)
    const first = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, null)
    expect(first.newIds).toHaveLength(kind === 'group' ? 1 : 3)
    expect(first.newIds.every((id) => store.isItemEditable(id))).toBe(true)
    const second = clipboard.pasteItems(clipboard.clipboard.value, 0, 0, 'indoor')
    expect(second.newIds).toHaveLength(first.newIds.length)
    expect(second.newIds.every((id) => !store.isItemEditable(id))).toBe(true)
    expect(scheme.collectionTree.value.nodes.some((node) => node.name === 'Tea copy')).toBe(false)
  }
)

it('queues shared trees, names and furniture together while leaving personal flags local on remote replay', () => {
  const { store, scheme, clipboard } = setup()
  store.setGroupHidden(7, true)
  clipboard.copy(outdoor)
  scheme.source.value = 'cloud'
  scheme.collectionsSupported.value = true
  const cloud = useCloudSchemeStore()
  cloud.schemeId = scheme.id
  cloud.status = 'connected'
  const beforeItems = scheme.items.value,
    beforeTree = scheme.collectionTree.value
  clipboard.paste()
  const transaction = store.peekPendingTransaction(scheme.id)!
  expect(transaction.ops.map((op) => op.type)).toEqual(
    expect.arrayContaining(['add_items', 'set_collection_tree', 'set_group_names'])
  )
  const remote = makeScheme(beforeItems)
  remote.collectionTree.value = beforeTree
  applyEditorTransactionToScheme(remote, transaction)
  expect(remote.collectionTree.value).toEqual(scheme.collectionTree.value)
  expect(remote.hiddenGroupIds.value.size).toBe(0)
  expect(remote.hiddenCollectionIds.value.size).toBe(0)
  cloud.status = 'disconnected'
  const before = scheme.collectionTree.value
  expect(clipboard.canPaste.value).toBe(false)
  clipboard.paste()
  expect(scheme.collectionTree.value).toBe(before)
})

it.each([false, true])(
  'keeps offline canvas paste available without creating collections, across schemes=%s',
  (crossScheme) => {
    const { store, scheme: source, clipboard } = setup()
    source.selectedItemIds.value = new Set(['roof', 'wall'])
    clipboard.copy()
    if (crossScheme) store.createScheme('destination')
    const scheme = store.activeScheme!
    scheme.source.value = 'cloud'
    scheme.collectionsSupported.value = false
    useCloudSchemeStore().status = 'disconnected'
    expect(clipboard.canPaste.value).toBe(true)
    clipboard.paste()
    expect(scheme.items.value).toHaveLength(crossScheme ? 2 : 7)
    expect(scheme.collectionTree.value.nodes).toHaveLength(crossScheme ? 0 : 5)
    expect(isCollectionTree(scheme.collectionTree.value)).toBe(true)
  }
)

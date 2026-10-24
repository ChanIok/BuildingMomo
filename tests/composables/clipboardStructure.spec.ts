import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useClipboard } from '@/composables/useClipboard'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { applyEditorTransactionToScheme } from '@/lib/editorTransactions'
import { isCollectionTree } from '@/lib/collectionTree'
import { makeAppItem, makeScheme } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({
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

it('captures complete panel subtrees, empty folders and own restrictions without carried canvas items', () => {
  const { store, scheme, clipboard } = setup()
  store.setGroupHidden(7, true)
  store.setGroupLocked(8, true)
  store.setCollectionRestriction('tea', 'hidden', true)
  scheme.selectedItemIds.value = new Set(['loose'])
  const before = scheme.items.value
  clipboard.copy([...outdoor, { kind: 'collection', id: 'building' }, { kind: 'group', id: 7 }])
  const data = clipboard.clipboard.value
  expect(data.items.map((item) => item.internalId)).toEqual(['roof', 'wall', 'tree'])
  expect(data.structure.collectionIds.sort()).toEqual(['building', 'empty', 'outdoor'])
  expect(data.structure.hiddenGroups).toEqual([7])
  expect(data.structure.lockedGroups).toEqual([8])
  expect(data.structure.hiddenCollections).toEqual(['tea'])
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

it('retains individual group classifications locally and rebuilds only needed ancestor paths across schemes', () => {
  const { store, scheme, clipboard } = setup()
  clipboard.copy([
    { kind: 'group', id: 7 },
    { kind: 'group', id: 9 },
  ])
  expect(clipboard.clipboard.value.items).toHaveLength(2)
  clipboard.paste()
  expect(scheme.collectionTree.value.nodes).toHaveLength(5)
  expect(
    scheme.collectionTree.value.groups
      .slice(-2)
      .map((group) => group.collectionId)
      .sort()
  ).toEqual(['building', 'outdoor'])
  store.createScheme('destination')
  clipboard.paste()
  const dest = store.activeScheme!
  expect(dest.collectionTree.value.nodes.map((node) => node.name).sort()).toEqual([
    'Building',
    'Outdoor',
    'Tea',
  ])
  expect(dest.collectionTree.value.groups.map((group) => group.name).sort()).toEqual([
    'Roof',
    'Tree',
  ])
  expect(isCollectionTree(dest.collectionTree.value)).toBe(true)
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
  expect(data.structure.collectionIds).toEqual([])
  scheme.selectedItemIds.value = new Set(['roof'])
  expect(clipboard.buildClipboardDataFromSelection().items[0]!.groupId).toBe(0)
  const panelSingle = clipboard.buildClipboardDataFromSelection([{ kind: 'group', id: 9 }])
  expect(panelSingle.items[0]!.groupId).toBe(9)
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
  expect(clipboard.clipboard.value.structure.collectionIds).toEqual([])
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

it('keeps inherited source restrictions external and inherits the explicit destination restrictions instead', () => {
  const { store, scheme, clipboard } = setup()
  store.setCollectionRestriction('tea', 'hidden', true)
  store.setCollectionRestriction('indoor', 'locked', true)
  clipboard.copy(outdoor)
  clipboard.pasteItems(clipboard.clipboard.value, 0, 0, null)
  expect(scheme.items.value.slice(5).every((item) => store.isItemEditable(item.internalId))).toBe(
    true
  )
  clipboard.pasteItems(clipboard.clipboard.value, 0, 0, 'indoor')
  expect(scheme.items.value.slice(8).every((item) => !store.isItemEditable(item.internalId))).toBe(
    true
  )
})

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

it('keeps the existing offline canvas-paste contract when no new collection hierarchy is required', () => {
  const { scheme, clipboard } = setup()
  scheme.selectedItemIds.value = new Set(['roof', 'wall'])
  clipboard.copy()
  scheme.source.value = 'cloud'
  scheme.collectionsSupported.value = true
  useCloudSchemeStore().status = 'disconnected'
  expect(clipboard.canPaste.value).toBe(true)
  clipboard.paste()
  expect(scheme.items.value).toHaveLength(7)
  expect(scheme.collectionTree.value.nodes).toHaveLength(5)
})

import { expect, it } from 'vitest'
import {
  applyCollectionStructure,
  collectionStructure,
  emptyCollectionTree,
  getGroupChanges,
  groupNameEntries,
  patchGroupNames,
  readCollectionTree,
  reconcileCollectionGroups,
} from '@/lib/collectionTree'
import {
  applyEditorTransactionToScheme,
  buildTransactionByRef,
  captureSchemeSnapshot,
  invertEditorTransaction,
} from '@/lib/editorTransactions'
import { parseSchemeHistoryFile } from '@/lib/schemeHistory'
import { makeAppItem, makeScheme } from '../fixtures/item'

const directory = () => ({
  nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
  groups: [{ groupId: 7, collectionId: 'house', order: 0 }],
})

it('stores a name on an unclassified group without introducing directory structure or a default-name record', () => {
  const empty = emptyCollectionTree()
  const named = patchGroupNames(empty, [], [[7, 'Walls']])
  expect(named.groups).toEqual([{ groupId: 7, name: 'Walls', collectionId: null, order: 7 }])
  expect(collectionStructure(named)).toEqual(empty)
  expect(patchGroupNames(named, [[7, 'Walls']], [])).toEqual(empty)
  expect(patchGroupNames(named, [[7, 'Walls']], [[7, 'Walls']])).toBe(named)
})

it('reads published snapshots without collection metadata and validates the current tree', () => {
  expect(readCollectionTree()).toEqual(emptyCollectionTree())
  const tree = patchGroupNames(directory(), [], [[7, 'Walls']])
  expect(readCollectionTree(tree)).toEqual(tree)
  expect(() => readCollectionTree({ ...tree, groups: [{ ...tree.groups[0], name: '' }] })).toThrow()
})

it('emits a name-only transaction even when naming a previously implicit group', () => {
  const scheme = makeScheme([makeAppItem({ groupId: 7 })])
  const before = captureSchemeSnapshot(scheme)
  scheme.collectionTree.value = patchGroupNames(scheme.collectionTree.value, [], [[7, 'Walls']])
  const tx = buildTransactionByRef({
    schemeId: scheme.id,
    intent: 'rename',
    before,
    after: captureSchemeSnapshot(scheme),
  })!
  expect(tx.ops).toEqual([{ type: 'set_group_names', before: [], after: [[7, 'Walls']] }])
  applyEditorTransactionToScheme(scheme, invertEditorTransaction(tx))
  expect(scheme.collectionTree.value).toEqual(emptyCollectionTree())
  applyEditorTransactionToScheme(scheme, tx)
  expect(scheme.collectionTree.value.groups[0]?.name).toBe('Walls')
  expect(scheme).not.toHaveProperty('groupNames')
})

it('directory replay and undo preserve newer group names and unrelated name-only records', () => {
  const scheme = makeScheme([
    makeAppItem({ groupId: 7 }),
    makeAppItem({ internalId: 'b', groupId: 8 }),
  ])
  const before = emptyCollectionTree(),
    after = directory()
  scheme.collectionTree.value = patchGroupNames(
    before,
    [],
    [
      [7, 'New walls'],
      [8, 'Garden'],
    ]
  )
  const tx = {
    id: 'directory',
    schemeId: scheme.id,
    createdAt: 0,
    intent: 'classify',
    ops: [{ type: 'set_collection_tree' as const, before, after }],
  }
  applyEditorTransactionToScheme(scheme, tx)
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)).toEqual({
    groupId: 7,
    name: 'New walls',
    collectionId: 'house',
    order: 0,
  })
  applyEditorTransactionToScheme(scheme, invertEditorTransaction(tx))
  expect(new Map(groupNameEntries(scheme.collectionTree.value))).toEqual(
    new Map([
      [7, 'New walls'],
      [8, 'Garden'],
    ])
  )
  expect(collectionStructure(scheme.collectionTree.value)).toEqual(before)
})

it('renumbering and deletion carry/prune the complete metadata record together', () => {
  const items = [makeAppItem({ groupId: 7 })]
  const tree = patchGroupNames(directory(), [], [[7, 'Walls']])
  const renamed = reconcileCollectionGroups(
    tree,
    getGroupChanges(items, [{ ...items[0]!, groupId: 20 }])
  )
  expect(renamed.groups).toEqual([{ groupId: 20, name: 'Walls', collectionId: 'house', order: 0 }])
  const removed = reconcileCollectionGroups(
    renamed,
    getGroupChanges([{ ...items[0]!, groupId: 20 }], [])
  )
  expect(removed.groups).toEqual([])
  expect(removed.nodes).toEqual(tree.nodes)
})

it('reads published scheme-history files without collection metadata', () => {
  const legacy = {
    version: 1,
    schemeId: 'old',
    name: 'Old',
    items: [makeAppItem({ groupId: 7 })],
    groupOrigins: [],
  }
  const parsed = parseSchemeHistoryFile(JSON.parse(JSON.stringify(legacy)))!
  expect(parsed.version).toBe(1)
  expect(parsed.collectionTree).toEqual(emptyCollectionTree())
  expect(
    parseSchemeHistoryFile({
      ...legacy,
      collectionTree: {
        nodes: [],
        groups: [{ groupId: 7, name: '', collectionId: null, order: 7 }],
      },
    })
  ).toBeNull()
})

it('keeps name edits field-scoped when a classified group is moved concurrently', () => {
  const scheme = makeScheme([makeAppItem({ groupId: 7 })])
  scheme.collectionTree.value = patchGroupNames(directory(), [], [[7, 'Walls']])
  const before = captureSchemeSnapshot(scheme)
  scheme.collectionTree.value = patchGroupNames(
    scheme.collectionTree.value,
    [[7, 'Walls']],
    [[7, 'Roof']]
  )
  const tx = buildTransactionByRef({
    schemeId: scheme.id,
    intent: 'rename',
    before,
    after: captureSchemeSnapshot(scheme),
  })!
  scheme.collectionTree.value = applyCollectionStructure(
    scheme.collectionTree.value,
    emptyCollectionTree()
  )
  applyEditorTransactionToScheme(scheme, invertEditorTransaction(tx))
  expect(scheme.collectionTree.value.groups[0]).toEqual({
    groupId: 7,
    name: 'Walls',
    collectionId: null,
    order: 7,
  })
})

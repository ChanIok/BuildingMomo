import { expect, it } from 'vitest'
import { emptyCollectionTree, isCollectionTree } from '@/lib/collectionTree'
import { groupMetadataInput, inheritGroupMetadata } from '@/lib/groupMetadataInheritance'
import { makeAppItem, makeScheme, setGroupNames } from '../fixtures/item'

function pair() {
  const source = makeScheme([
    makeAppItem({ internalId: 'old-a', groupId: 7 }),
    makeAppItem({ internalId: 'old-b', groupId: 7, instanceId: 1001, gameId: 2 }),
    makeAppItem({ internalId: 'old-c', groupId: 8, instanceId: 1002 }),
  ])
  source.collectionTree.value = {
    nodes: [
      { id: 'house', name: 'House', parentId: null, order: 2 },
      { id: 'floor', name: 'Floor', parentId: 'house', order: 3 },
      { id: 'unused', name: 'Unused', parentId: null, order: 4 },
    ],
    groups: [
      { groupId: 7, name: 'Walls', collectionId: 'floor', order: 0 },
      { groupId: 8, name: 'Garden', collectionId: 'unused', order: 1 },
    ],
  }
  source.groupOrigins.value = new Map([[7, 'old-b']])
  const target = makeScheme(
    source.items.value.map((item) => ({ ...item, internalId: `new-${item.internalId}` }))
  )
  return {
    source,
    target,
    run: () => inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target)),
  }
}

it('matches whole groups independent of order and transforms, remaps origins, and leaves inputs untouched', () => {
  const { source, target, run } = pair()
  target.items.value = target.items.value
    .slice(0, 2)
    .reverse()
    .map((item) => ({
      ...item,
      x: 500,
      rotation: { x: 10, y: 20, z: 30 },
      extra: { ...item.extra, Scale: { X: 2, Y: 2, Z: 2 }, ColorMap: [1] },
    }))
  const items = target.items.value
  const sourceBefore = structuredClone(groupMetadataInput(source))
  const result = run()
  expect(result.matchedGroupCount).toBe(1)
  expect(result.changedGroupCount).toBe(1)
  expect(result.collectionTree.nodes.map((node) => node.id)).toEqual(['house', 'floor'])
  expect(result.collectionTree.groups).toEqual([source.collectionTree.value.groups[0]])
  expect(result.groupOrigins.get(7)).toBe('new-old-b')
  expect(groupMetadataInput(source)).toEqual(sourceBefore)
  expect(target.items.value).toBe(items)
  expect(target.collectionTree.value).toEqual(emptyCollectionTree())
  expect(target.groupOrigins.value.size).toBe(0)
})

it.each(['groupId', 'instanceId', 'gameId', 'added', 'removed'])(
  'rejects changes to %s without touching unmatched metadata or origins',
  (change) => {
    const { target, run } = pair()
    target.items.value = target.items.value.slice(0, 2)
    if (change === 'added')
      target.items.value.push(makeAppItem({ internalId: 'extra', groupId: 7, instanceId: 2000 }))
    else if (change === 'removed') target.items.value.pop()
    else target.items.value[0] = { ...target.items.value[0]!, [change]: 999 }
    setGroupNames(target, [[7, 'Keep']])
    target.groupOrigins.value = new Map([[7, 'new-old-b']])
    const result = run()
    expect(result.matchedGroupCount).toBe(0)
    expect(result.collectionTree).toBe(target.collectionTree.value)
    expect(result.groupOrigins).toBe(target.groupOrigins.value)
  }
)

it('counts duplicate identities instead of treating members as a set, and never guesses an ambiguous origin', () => {
  const { source, target, run } = pair()
  const a = source.items.value[0]!
  source.items.value = [a, { ...a, internalId: 'duplicate' }]
  target.items.value = [{ ...a, internalId: 'new-a' }]
  expect(run().matchedGroupCount).toBe(0)
  target.items.value = [...target.items.value, { ...a, internalId: 'new-duplicate' }]
  source.groupOrigins.value = new Map([[7, a.internalId]])
  const result = run()
  expect(result.matchedGroupCount).toBe(1)
  expect(result.groupOrigins.has(7)).toBe(false)
  expect(result.skippedOriginCount).toBe(1)
})

it('clears absent source fields only for matching groups and preserves all unmatched records', () => {
  const { source, target, run } = pair()
  source.items.value = source.items.value.slice(0, 2)
  source.collectionTree.value = emptyCollectionTree()
  source.groupOrigins.value = new Map()
  setGroupNames(target, [
    [7, 'Clear'],
    [8, 'Keep'],
  ])
  target.groupOrigins.value = new Map([
    [7, 'new-old-a'],
    [8, 'new-old-c'],
  ])
  const result = run()
  expect(result.collectionTree.groups).toEqual([
    { groupId: 8, name: 'Keep', collectionId: null, order: 8 },
  ])
  expect(result.groupOrigins).toEqual(new Map([[8, 'new-old-c']]))
  expect(result.changedGroupCount).toBe(1)
})

it('isolates conflicting directory branches and is idempotent without changing unmatched branches', () => {
  const { source, target, run } = pair()
  source.items.value = source.items.value.slice(0, 2)
  target.collectionTree.value = {
    nodes: [
      { id: 'house', name: 'Existing house', parentId: null, order: 2 },
      { id: 'floor', name: 'Existing floor', parentId: 'house', order: 3 },
    ],
    groups: [{ groupId: 8, name: 'Keep', collectionId: 'floor', order: 9 }],
  }
  const existing = target.collectionTree.value
  const result = run()
  expect(isCollectionTree(result.collectionTree)).toBe(true)
  expect(result.collectionTree.nodes.slice(0, 2)).toEqual(existing.nodes)
  expect(result.collectionTree.groups.find((group) => group.groupId === 8)).toBe(existing.groups[0])
  expect(result.collectionTree.nodes).toHaveLength(4)
  expect(result.collectionTree.groups.find((group) => group.groupId === 7)?.collectionId).not.toBe(
    'floor'
  )
  target.collectionTree.value = result.collectionTree
  target.groupOrigins.value = new Map(result.groupOrigins)
  const again = run()
  expect(again.changedGroupCount).toBe(0)
  expect(again.collectionTree).toBe(result.collectionTree)
  expect(again.groupOrigins).toBe(target.groupOrigins.value)
})

it('keeps separate same-named source collections and ignores ungrouped furniture', () => {
  const { source, target, run } = pair()
  source.collectionTree.value.nodes[2] = { id: 'unused', name: 'House', parentId: null, order: 2 }
  const result = run()
  expect(result.collectionTree.nodes.filter((node) => node.name === 'House')).toHaveLength(2)
  source.items.value = [makeAppItem()]
  target.items.value = [makeAppItem()]
  expect(run().matchedGroupCount).toBe(0)
})

it('remaps collection origins and updates them only on fully matched branches', () => {
  const { source, target, run } = pair()
  source.collectionTree.value.nodes[0]!.originItemId = 'old-b'
  const first = run()
  expect(first.collectionTree.nodes.find((node) => node.id === 'house')?.originItemId).toBe(
    'new-old-b'
  )
  expect(first.changedCollectionOriginCount).toBe(1)
  target.collectionTree.value = first.collectionTree
  target.groupOrigins.value = new Map(first.groupOrigins)
  source.collectionTree.value.nodes[0]!.originItemId = 'old-a'
  const second = run()
  expect(second.changedGroupCount).toBe(0)
  expect(second.changedCollectionOriginCount).toBe(1)
  expect(second.collectionTree.nodes.find((node) => node.id === 'house')?.originItemId).toBe(
    'new-old-a'
  )
  target.items.value = [
    ...target.items.value,
    makeAppItem({ internalId: 'unmatched', groupId: 99 }),
  ]
  target.collectionTree.value = {
    ...first.collectionTree,
    groups: [...first.collectionTree.groups, { groupId: 99, collectionId: 'house', order: 100 }],
  }
  expect(run().collectionTree.nodes.find((node) => node.id === 'house')?.originItemId).toBe(
    'new-old-b'
  )
})

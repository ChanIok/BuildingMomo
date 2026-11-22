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

it('fuzzy matches rewritten IDs by gameId/count/scale/color, skips origins, preserves target origins, and is idempotent', () => {
  const { source, target } = pair()
  source.items.value = [
    makeAppItem({
      internalId: 'old-a',
      groupId: 7,
      instanceId: 1000,
      gameId: 10,
      extra: { Scale: { X: 1.1, Y: 2, Z: 1 }, ColorMap: { '0': 0 } },
    }),
    makeAppItem({
      internalId: 'old-b',
      groupId: 7,
      instanceId: 1001,
      gameId: 20,
      extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: { '1': 12, '3': 34 } },
    }),
  ]
  source.collectionTree.value.nodes[0]!.originItemId = 'old-b'
  source.groupOrigins.value = new Map([[7, 'old-b']])

  target.items.value = [
    makeAppItem({
      internalId: 'new-b',
      groupId: 42,
      instanceId: 9001,
      gameId: 20,
      x: 500,
      rotation: { x: 15, y: 30, z: 45 },
      extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: [34, 12], AttachID: 777 },
    }),
    makeAppItem({
      internalId: 'new-a',
      groupId: 42,
      instanceId: 9000,
      gameId: 10,
      x: -200,
      extra: { Scale: { X: Math.fround(1.1), Y: 2, Z: 1 }, ColorMap: [0] },
    }),
  ]
  target.groupOrigins.value = new Map([[42, 'new-a']])

  // 默认严格模式不匹配
  expect(
    inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target)).matchedGroupCount
  ).toBe(0)

  const first = inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target), {
    exactMatch: false,
  })
  expect(first.matchedGroupCount).toBe(1)
  expect(first.changedGroupCount).toBe(1)
  expect(first.ambiguousMatchCount).toBe(0)
  // 源组原点和源集合原点在模糊模式下均跳过（1 + 1 = 2）
  expect(first.skippedOriginCount).toBe(2)
  expect(first.collectionTree.groups).toEqual([
    { groupId: 42, name: 'Walls', collectionId: 'floor', order: 0 },
  ])
  expect(
    first.collectionTree.nodes.find((node) => node.id === 'house')?.originItemId
  ).toBeUndefined()
  // 保留目标组原有原点，不被清空
  expect(first.groupOrigins).toBe(target.groupOrigins.value)
  expect(first.groupOrigins.get(42)).toBe('new-a')

  target.collectionTree.value = first.collectionTree
  const again = inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target), {
    exactMatch: false,
  })
  expect(again.changedGroupCount).toBe(0)
  expect(again.changedCollectionOriginCount).toBe(0)
  expect(again.collectionTree).toBe(first.collectionTree)
})

it.each(['gameId', 'count', 'scale', 'color'])('rejects fuzzy match when %s differs', (diff) => {
  const source = makeScheme([
    makeAppItem({
      internalId: 's1',
      groupId: 1,
      instanceId: 100,
      gameId: 10,
      extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: [12] },
    }),
  ])
  setGroupNames(source, [[1, 'Lamp']])
  const targetItems = [
    makeAppItem({
      internalId: 't1',
      groupId: 9,
      instanceId: 900,
      gameId: diff === 'gameId' ? 99 : 10,
      extra: {
        Scale: diff === 'scale' ? { X: 1.5, Y: 1, Z: 1 } : { X: 1, Y: 1, Z: 1 },
        ColorMap: diff === 'color' ? [13] : [12],
      },
    }),
  ]
  if (diff === 'count') {
    targetItems.push(
      makeAppItem({
        internalId: 't2',
        groupId: 9,
        instanceId: 901,
        gameId: 10,
        extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: [12] },
      })
    )
  }
  const target = makeScheme(targetItems)
  const result = inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target), {
    exactMatch: false,
  })
  expect(result.matchedGroupCount).toBe(0)
})

it('runs exact matches first, skips blank source groups, supports 1-to-many, and matches many-to-many in order', () => {
  const source = makeScheme([
    // 源组 1（空白，未命名未分类，不应覆盖目标已有名称）
    makeAppItem({ internalId: 'sb1', groupId: 1, instanceId: 101, gameId: 50 }),
    // 源组 2（唯一命名的路灯，用于测试 1 对多）
    makeAppItem({ internalId: 'sl1', groupId: 2, instanceId: 102, gameId: 60 }),
    // 源组 3 和 4（两根相同柱子，用于测试精确优先 + 多对多顺序消耗与回退）
    makeAppItem({ internalId: 'sp1', groupId: 3, instanceId: 103, gameId: 70 }),
    makeAppItem({ internalId: 'sp2', groupId: 4, instanceId: 104, gameId: 70 }),
  ])
  source.collectionTree.value = {
    nodes: [
      { id: 'street', name: 'Street', parentId: null, order: 0 },
      { id: 'f1', name: 'F1', parentId: null, order: 1 },
      { id: 'f2', name: 'F2', parentId: null, order: 2 },
    ],
    groups: [
      { groupId: 2, name: 'Lamp', collectionId: 'street', order: 0 },
      { groupId: 3, name: 'Pillar A', collectionId: 'f1', order: 0 },
      { groupId: 4, name: 'Pillar B', collectionId: 'f2', order: 0 },
    ],
  }
  source.groupOrigins.value = new Map([[3, 'sp1']])

  const target = makeScheme([
    // 目标组 10 与空白源组 1 属性一致，但自己已有名称
    makeAppItem({ internalId: 'tb1', groupId: 10, instanceId: 901, gameId: 50 }),
    // 目标组 11、12 为路灯的 2 份复制品（1 对多，无歧义）
    makeAppItem({ internalId: 'tl1', groupId: 11, instanceId: 902, gameId: 60 }),
    makeAppItem({ internalId: 'tl2', groupId: 12, instanceId: 903, gameId: 60 }),
    // 目标组 3 精确命中源组 3（应优先锁定并迁移原点）
    makeAppItem({ internalId: 'tp-exact', groupId: 3, instanceId: 103, gameId: 70 }),
    // 目标组 13、14 为另外两根柱子：13 消耗未用的源组 4，14 回退复用源组 3
    makeAppItem({ internalId: 'tp1', groupId: 13, instanceId: 904, gameId: 70 }),
    makeAppItem({ internalId: 'tp2', groupId: 14, instanceId: 905, gameId: 70 }),
  ])
  setGroupNames(target, [[10, 'Keep Wall']])

  const result = inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target), {
    exactMatch: false,
  })
  const byId = new Map(result.collectionTree.groups.map((g) => [g.groupId, g]))
  // 空白源组 1 被跳过，目标组 10 保留原有名称
  expect(byId.get(10)?.name).toBe('Keep Wall')
  // 1 对多全部继承
  expect(byId.get(11)).toMatchObject({ name: 'Lamp', collectionId: 'street' })
  expect(byId.get(12)).toMatchObject({ name: 'Lamp', collectionId: 'street' })
  // 精确匹配组 3 锁定源组 3 并迁移原点
  expect(byId.get(3)).toMatchObject({ name: 'Pillar A', collectionId: 'f1' })
  expect(result.groupOrigins.get(3)).toBe('tp-exact')
  // 目标组 13 拿到未消耗的源组 4，目标组 14 回退复用第一个候选源组 3
  expect(byId.get(13)).toMatchObject({ name: 'Pillar B', collectionId: 'f2' })
  expect(byId.get(14)).toMatchObject({ name: 'Pillar A', collectionId: 'f1' })
  // 仅目标组 13、14 属于多候选模糊匹配（11、12 为单源 1 对多不计入）
  expect(result.ambiguousMatchCount).toBe(2)
  expect(result.matchedGroupCount).toBe(5)
  // 目标组 14 复用带原点的源组 3，计入 1 个跳过的原点
  expect(result.skippedOriginCount).toBe(1)
})

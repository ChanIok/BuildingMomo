import { describe, expect, it } from 'vitest'
import {
  applyEditorTransactionToScheme,
  buildTransactionByRef,
  captureSchemeSnapshot,
  cloudHistoryCountsFromItemBuckets,
  collectTransactionItemBuckets,
  collectTransactionTouchedItemIds,
  invertEditorTransaction,
} from '@/lib/editorTransactions'
import type { AppItem, EditorTransaction } from '@/types/editor'
import { makeAppItem, makeScheme } from '../fixtures/item'

/** 走完整的「改场景 → 建事务 → 逆事务 → 应用」链路。 */
function roundTrip(scheme: ReturnType<typeof makeScheme>, mutate: () => void): EditorTransaction {
  const before = captureSchemeSnapshot(scheme)
  mutate()
  const after = captureSchemeSnapshot(scheme)

  const transaction = buildTransactionByRef({ schemeId: scheme.id, intent: 'test', before, after })
  expect(transaction).not.toBeNull()

  applyEditorTransactionToScheme(scheme, invertEditorTransaction(transaction!))
  return transaction!
}

describe('buildTransactionByRef', () => {
  it('只记录引用发生变化的家具', () => {
    const a = makeAppItem({ internalId: 'a', x: 0 })
    const b = makeAppItem({ internalId: 'b' })
    const c = makeAppItem({ internalId: 'c' })
    const scheme = makeScheme([a, b, c])

    const before = captureSchemeSnapshot(scheme)
    // 只替换 a 的引用，b / c 原样保留。
    scheme.items.value = [{ ...a, x: 100 }, b, c]
    const after = captureSchemeSnapshot(scheme)

    const transaction = buildTransactionByRef({ schemeId: 's', intent: 'move', before, after })!

    expect(transaction.ops).toHaveLength(1)
    expect(transaction.ops[0]).toMatchObject({
      type: 'patch_items',
      changes: [{ itemId: 'a' }],
    })
  })

  it('没有任何引用变化时返回 null，不产生空事务', () => {
    const items = [makeAppItem({ internalId: 'a' })]
    const scheme = makeScheme(items)

    const before = captureSchemeSnapshot(scheme)
    const after = captureSchemeSnapshot(scheme)

    expect(buildTransactionByRef({ schemeId: 's', intent: 'noop', before, after })).toBeNull()
  })

  it('原地修改家具不会被记录（不可变更新的前提）', () => {
    const a = makeAppItem({ internalId: 'a', x: 0 })
    const scheme = makeScheme([a])

    const before = captureSchemeSnapshot(scheme)
    a.x = 100 // 违反约定：原地修改
    const after = captureSchemeSnapshot(scheme)

    // 这条断言锁住的是当前设计前提：事务靠引用比较识别差异。
    // 若将来改为深比较，这个测试应当被有意更新，而不是悄悄失效。
    expect(buildTransactionByRef({ schemeId: 's', intent: 'move', before, after })).toBeNull()
  })

  it('新增与删除分别生成 add_items / remove_items', () => {
    const a = makeAppItem({ internalId: 'a' })
    const b = makeAppItem({ internalId: 'b' })
    const added = makeAppItem({ internalId: 'added' })
    const scheme = makeScheme([a, b])

    const before = captureSchemeSnapshot(scheme)
    scheme.items.value = [a, b, added]
    const after = captureSchemeSnapshot(scheme)

    const transaction = buildTransactionByRef({ schemeId: 's', intent: 'add', before, after })!
    expect(transaction.ops.map((op) => op.type)).toEqual(['add_items'])

    const beforeRemove = captureSchemeSnapshot(scheme)
    scheme.items.value = [a]
    const afterRemove = captureSchemeSnapshot(scheme)

    const removeTx = buildTransactionByRef({
      schemeId: 's',
      intent: 'remove',
      before: beforeRemove,
      after: afterRemove,
    })!
    expect(removeTx.ops.map((op) => op.type)).toEqual(['remove_items'])
  })

  it('groupOrigins 变化会进入事务，且条目按 groupId 排序', () => {
    const scheme = makeScheme([makeAppItem()])
    scheme.groupOrigins.value = new Map([
      [3, 'c'],
      [1, 'a'],
      [2, 'b'],
    ])

    const before = captureSchemeSnapshot(scheme)
    scheme.groupOrigins.value = new Map(scheme.groupOrigins.value).set(4, 'd')
    const after = captureSchemeSnapshot(scheme)

    const transaction = buildTransactionByRef({ schemeId: 's', intent: 'group', before, after })!
    const op = transaction.ops.find((item) => item.type === 'set_group_origins')

    expect(op).toBeDefined()
    if (op?.type === 'set_group_origins') {
      // 排序稳定，否则云端同步的 diff 会因为 Map 插入顺序而抖动。
      expect(op.after).toEqual([
        [1, 'a'],
        [2, 'b'],
        [3, 'c'],
        [4, 'd'],
      ])
      expect(op.before).toEqual([
        [1, 'a'],
        [2, 'b'],
        [3, 'c'],
      ])
    }
  })
})

describe('invertEditorTransaction + applyEditorTransactionToScheme', () => {
  it('撤销后方案数据回到原样', () => {
    const a = makeAppItem({ internalId: 'a', x: 0 })
    const b = makeAppItem({ internalId: 'b' })
    const scheme = makeScheme([a, b])
    const original = structuredClone(scheme.items.value)

    roundTrip(scheme, () => {
      scheme.items.value = [{ ...a, x: 100, y: 50 }, b]
    })

    expect(scheme.items.value).toEqual(original)
  })

  it('未参与变更的家具在撤销后仍是同一个对象引用', () => {
    const a = makeAppItem({ internalId: 'a' })
    const b = makeAppItem({ internalId: 'b' })
    const scheme = makeScheme([a, b])

    roundTrip(scheme, () => {
      scheme.items.value = [{ ...a, x: 100 }, b]
    })

    // apply 只替换命中项，其余必须保持引用，否则大场景会全表失效。
    expect(scheme.items.value[1]).toBe(b)
  })

  it('删除后撤销，家具回到数组且数据完整', () => {
    const a = makeAppItem({ internalId: 'a' })
    const b = makeAppItem({ internalId: 'b', x: 42 })
    const scheme = makeScheme([a, b])

    roundTrip(scheme, () => {
      scheme.items.value = [a]
    })

    expect(scheme.items.value).toHaveLength(2)
    expect(scheme.items.value[1]).toEqual(b)
  })

  it('新增后撤销，家具被移除', () => {
    const a = makeAppItem({ internalId: 'a' })
    const added = makeAppItem({ internalId: 'added' })
    const scheme = makeScheme([a])

    roundTrip(scheme, () => {
      scheme.items.value = [a, added]
    })

    expect(scheme.items.value.map((item) => item.internalId)).toEqual(['a'])
  })

  it('多步操作的逆事务按相反顺序应用', () => {
    const a = makeAppItem({ internalId: 'a' })
    const added = makeAppItem({ internalId: 'added' })
    const removed = makeAppItem({ internalId: 'removed' })
    const scheme = makeScheme([a, removed])

    const before = captureSchemeSnapshot(scheme)
    scheme.items.value = [{ ...a, x: 10 }, added]
    const after = captureSchemeSnapshot(scheme)

    const transaction = buildTransactionByRef({ schemeId: 's', intent: 'mixed', before, after })!
    expect(transaction.ops.map((op) => op.type)).toEqual([
      'patch_items',
      'add_items',
      'remove_items',
    ])

    const inverse = invertEditorTransaction(transaction)
    expect(inverse.ops.map((op) => op.type)).toEqual(['add_items', 'remove_items', 'patch_items'])
    expect(inverse.intent).toBe('inverse:mixed')
  })

  it('groupOrigins 撤销后回到原值', () => {
    const scheme = makeScheme([makeAppItem()])
    scheme.groupOrigins.value = new Map([[1, 'a']])

    roundTrip(scheme, () => {
      scheme.groupOrigins.value = new Map([[1, 'b']])
    })

    expect([...scheme.groupOrigins.value]).toEqual([[1, 'a']])
  })

  it('ID 分配器只增不减', () => {
    const scheme = makeScheme([makeAppItem({ internalId: 'a', instanceId: 1000 })])
    expect(scheme.maxInstanceId.value).toBe(999)

    const before = captureSchemeSnapshot(scheme)
    scheme.items.value = [makeAppItem({ internalId: 'big', instanceId: 5000, groupId: 9 })]
    const after = captureSchemeSnapshot(scheme)

    const transaction = buildTransactionByRef({ schemeId: 's', intent: 'add', before, after })!
    applyEditorTransactionToScheme(scheme, transaction)

    expect(scheme.maxInstanceId.value).toBe(5000)
    expect(scheme.maxGroupId.value).toBe(9)

    applyEditorTransactionToScheme(scheme, invertEditorTransaction(transaction))
    // 撤销后不再回退，避免复用已用过的 ID。
    expect(scheme.maxInstanceId.value).toBe(5000)
  })

  it('事务中的家具数据与方案隔离，事后修改方案不会污染历史', () => {
    const a = makeAppItem({ internalId: 'a', x: 0 })
    const scheme = makeScheme([a])

    const before = captureSchemeSnapshot(scheme)
    scheme.items.value = [{ ...a, x: 100 }]
    const after = captureSchemeSnapshot(scheme)
    const transaction = buildTransactionByRef({ schemeId: 's', intent: 'move', before, after })!

    scheme.items.value = [{ ...a, x: 999 }]
    expect(transaction.ops[0]).toMatchObject({ changes: [{ itemId: 'a' }] })
    if (transaction.ops[0]?.type === 'patch_items') {
      expect(transaction.ops[0].changes[0]!.after.x).toBe(100)
    }
  })
})

describe('事务摘要', () => {
  it('收集被触碰的家具 ID', () => {
    const transaction: EditorTransaction = {
      id: 't1',
      schemeId: 's',
      createdAt: 0,
      intent: 'test',
      ops: [
        {
          type: 'patch_items',
          changes: [{ itemId: 'a', before: makeAppItem(), after: makeAppItem() }],
        },
        { type: 'add_items', items: [makeAppItem({ internalId: 'new' })] },
        { type: 'remove_items', items: [makeAppItem({ internalId: 'gone' })] },
      ],
    }

    expect([...collectTransactionTouchedItemIds(transaction)].sort()).toEqual(['a', 'gone', 'new'])
  })

  it('连续修改同一家具时，buckets 里只出现一次', () => {
    const transaction: EditorTransaction = {
      id: 't1',
      schemeId: 's',
      createdAt: 0,
      intent: 'test',
      ops: [
        {
          type: 'patch_items',
          changes: [
            { itemId: 'a', before: makeAppItem(), after: makeAppItem() },
            { itemId: 'a', before: makeAppItem(), after: makeAppItem() },
          ],
        },
        { type: 'add_items', items: [makeAppItem({ internalId: 'b' })] },
      ],
    }

    const buckets = collectTransactionItemBuckets(transaction)
    expect(buckets).toEqual({ added: ['b'], removed: [], patched: ['a'] })
    expect(cloudHistoryCountsFromItemBuckets(buckets)).toEqual({
      addedCount: 1,
      removedCount: 0,
      updatedCount: 1,
      itemCount: 2,
    })
  })
})

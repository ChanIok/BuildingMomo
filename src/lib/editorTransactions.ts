import type {
  AppItem,
  EditorOperation,
  EditorTransaction,
  HomeScheme,
  PatchItemChange,
} from '@/types/editor'
import type { CloudHistoryItemBuckets } from '@/types/cloudScheme'

// ========== 零拷贝快照：只存引用 ==========

/**
 * 操作前/后的方案状态快照。
 * 核心优化点：不做任何深拷贝，只保存数组 / Map 的真实引用指针。
 *
 * 使用前提：业务侧（如 useEditorManipulation 等处）在修改家具信息时，
 * 绝不会也不能去“原地覆盖（如 item.x = 100）”，而必须“产出该家具的新对象实体（使用 Map 遍历或者展开语法 {...item}）”
 * 这样做的结果是：但凡 `beforeItems[i] === afterItems[i]` (它们由于是同一个对象内存地址)，
 * 系统就可以 100% 确定这个家具连一根毫毛都没有改过，进而完全跳过漫长的查找对比！
 */
export interface SchemeTransactionSnapshot {
  items: AppItem[] // 数组引用，不拷贝
  groupOrigins: Map<number, string> // Map 引用，不拷贝
}

/**
 * 【快照捕获器】
 * 零开销抓取当前的画面家具情况。用于撤回动作记录前的垫底。
 */
export function captureSchemeSnapshot(scheme: HomeScheme): SchemeTransactionSnapshot {
  return {
    items: scheme.items.value,
    groupOrigins: scheme.groupOrigins.value,
  }
}

// ========== 克隆工具 ==========

export function cloneAppItem(item: AppItem): AppItem {
  return structuredClone(item)
}

export function cloneAppItems(items: AppItem[]): AppItem[] {
  return structuredClone(items)
}

function cloneGroupOriginsToEntries(
  groupOrigins: Map<number, string> | Array<[number, string]>
): Array<[number, string]> {
  const entries = groupOrigins instanceof Map ? Array.from(groupOrigins.entries()) : groupOrigins
  return entries
    .map(([groupId, itemId]) => [groupId, itemId] as [number, string])
    .sort((left, right) => left[0] - right[0] || left[1].localeCompare(right[1]))
}

// 保留对外导出（cloudScheme 等仍使用）
export { cloneGroupOriginsToEntries as cloneGroupOriginsEntries }

// ========== 事务构建 ==========

/**
 * 【核心算法】通过引用比较（===）来极速抓取哪些内容被用户改了，并生成事务账单 (EditorTransaction)。
 *
 * 举例：
 * 场景里有 10000 个家具。
 * 用户通过 Gizmo 手柄拖动了其中的 3 个。
 *
 * 步骤如下：
 * 1. 程序发现 9997 个家具在前后快照中 内存地址一致 (===成立)，一瞬间跳过。
 * 2. 程序发现 3 个家具在经过更新后地址变了。把他们存下来，装进 patch_items 账单。
 *
 * @returns 差异交易账单。如果一模一样什么都没改，则返回 null 代表"空记录不用存"
 */
export function buildTransactionByRef(params: {
  schemeId: string
  intent: string
  before: SchemeTransactionSnapshot
  after: SchemeTransactionSnapshot
}): EditorTransaction | null {
  const { schemeId, intent, before, after } = params
  const ops: EditorOperation[] = []

  // 1. 检查家具变更（最耗时的重头戏）
  // 建立前后字典以便通过家具有没有增减 ID 来判定情况
  const beforeMap = new Map(before.items.map((item) => [item.internalId, item]))
  const afterMap = new Map(after.items.map((item) => [item.internalId, item]))

  const changes: PatchItemChange[] = []
  const removedItems: AppItem[] = []

  // 2.1 遍历操作前的东西
  for (const [id, beforeItem] of beforeMap) {
    const afterItem = afterMap.get(id)
    if (!afterItem) {
      // 在“后”里找不到这ID了，代表用户刚才操作是把它给删了！
      removedItems.push(structuredClone(beforeItem))
      continue
    }
    // 💡 重点：如果引用不同，说明它被修改了（它移动了位置、被倒了颜色什么的）
    // 才真正意义上地执行深层拷贝（以便在历史里冰封它被修改前和修改后的详细参数）
    if (beforeItem !== afterItem) {
      changes.push({
        itemId: id,
        before: structuredClone(beforeItem),
        after: structuredClone(afterItem),
      })
    }
  }

  // 2.2 找新增了什么东西：遍历“后”的东西查它是否原本并不存在
  const addedItems: AppItem[] = []
  for (const afterItem of after.items) {
    if (!beforeMap.has(afterItem.internalId)) {
      addedItems.push(structuredClone(afterItem))
    }
  }

  // 开列操作清单
  if (changes.length > 0) {
    ops.push({ type: 'patch_items', changes })
  }
  if (addedItems.length > 0) {
    ops.push({ type: 'add_items', items: addedItems })
  }
  if (removedItems.length > 0) {
    ops.push({ type: 'remove_items', items: removedItems })
  }

  // 2. 检查是否有编组的原点关系变更。
  // 组合原点虽然不属于游戏原始存档字段，但它会直接影响后续移动/旋转的编辑行为，
  // 因此仍然应该进入可撤销/可同步的事务系统。
  if (before.groupOrigins !== after.groupOrigins) {
    ops.push({
      type: 'set_group_origins',
      before: cloneGroupOriginsToEntries(before.groupOrigins),
      after: cloneGroupOriginsToEntries(after.groupOrigins),
    })
  }

  // 3. 一张空头支票不需记录到脑海里，直接返回废弃
  if (ops.length === 0) {
    return null
  }

  // 装成一套连贯的“交易”(Transaction)，供服务器或系统分发
  return {
    id: crypto.randomUUID(),
    schemeId,
    createdAt: Date.now(),
    intent,
    ops,
  }
}

// ========== 事务重放与数据流转 ==========

export function createReplayTransaction(transaction: EditorTransaction, intentPrefix?: string) {
  return {
    id: crypto.randomUUID(),
    schemeId: transaction.schemeId,
    createdAt: Date.now(),
    intent: intentPrefix ? `${intentPrefix}:${transaction.intent}` : transaction.intent,
    ops: structuredClone(transaction.ops),
  } satisfies EditorTransaction
}

/**
 * 读取一个现有的事务，制造该事务的“时光倒流版本”。
 * 譬如：里面记录了“把家具加了 5 个缩放”，那么逆事务就会对应写着“把这 5 个缩放给减小回去”。
 */
export function invertEditorTransaction(transaction: EditorTransaction): EditorTransaction {
  // 注意，动作逆推就像穿衣服：
  // 正常步骤：穿短裤(1) -> 穿长裤(2)
  // 脱衣服(逆推)：脱长裤(2) -> 脱短裤(1)
  // 所以需要把整个动作记录 .reverse() 一下。
  const reversedOps = [...transaction.ops].reverse().map<EditorOperation>((operation) => {
    switch (operation.type) {
      case 'patch_items':
        // 参数调换对侧
        return {
          type: 'patch_items',
          changes: operation.changes.map((change) => ({
            itemId: change.itemId,
            before: cloneAppItem(change.after),
            after: cloneAppItem(change.before),
          })),
        }
      case 'add_items':
        // 加变删
        return {
          type: 'remove_items',
          items: cloneAppItems(operation.items),
        }
      case 'remove_items':
        // 删变加
        return {
          type: 'add_items',
          items: cloneAppItems(operation.items),
        }
      case 'set_group_origins':
        return {
          type: 'set_group_origins',
          before: cloneGroupOriginsToEntries(operation.after),
          after: cloneGroupOriginsToEntries(operation.before),
        }
    }
  })

  return {
    id: crypto.randomUUID(),
    schemeId: transaction.schemeId,
    createdAt: Date.now(),
    intent: `inverse:${transaction.intent}`, // 被调度的标识标记上“逆境”特征
    ops: reversedOps,
  }
}

/**
 * 分析这笔操作都碰了哪些家具的ID？
 * 这是专门为了能够让系统分析“别人动的家具和自己动的有冲突不”的功能入口
 */
export function collectTransactionTouchedItemIds(transaction: EditorTransaction) {
  const touchedIds = new Set<string>()

  for (const operation of transaction.ops) {
    if (operation.type === 'patch_items') {
      operation.changes.forEach((change) => touchedIds.add(change.itemId))
    }

    if (operation.type === 'add_items' || operation.type === 'remove_items') {
      operation.items.forEach((item) => touchedIds.add(item.internalId))
    }
  }

  return touchedIds
}

/**
 * 从一笔 EditorTransaction 拆出三类物品 id，供云方案 Popover「同步历史」使用。
 * 与 collectTransactionTouchedItemIds 不同：这里分新增/删除/修补，且同类里同一 id 只出现一次
 * （例如连续移动同一物 8 次 → patched 里仍只有 1 个 id）。
 */
export function collectTransactionItemBuckets(
  transaction: EditorTransaction
): CloudHistoryItemBuckets {
  const added = new Set<string>()
  const removed = new Set<string>()
  const patched = new Set<string>()

  for (const operation of transaction.ops) {
    if (operation.type === 'add_items') {
      for (const item of operation.items) {
        added.add(item.internalId)
      }
    } else if (operation.type === 'remove_items') {
      for (const item of operation.items) {
        removed.add(item.internalId)
      }
    } else if (operation.type === 'patch_items') {
      for (const change of operation.changes) {
        patched.add(change.itemId)
      }
    }
  }

  return {
    added: [...added],
    removed: [...removed],
    patched: [...patched],
  }
}

/**
 * 由 buckets 生成界面用的四个数：
 * 前三个是各集合大小；itemCount 是 added∪removed∪patched 的大小（同一物只跨类算一次「涉及物品」）。
 */
export function cloudHistoryCountsFromItemBuckets(buckets: CloudHistoryItemBuckets) {
  const a = new Set(buckets.added)
  const r = new Set(buckets.removed)
  const p = new Set(buckets.patched)
  const union = new Set([...a, ...r, ...p])
  return {
    addedCount: a.size,
    removedCount: r.size,
    updatedCount: p.size,
    itemCount: union.size,
  }
}

/** 合并两条历史记录的 buckets：三类分别做集合并集，用于 Popover 相邻 remote_tx 折叠。 */
export function unionCloudHistoryItemBuckets(
  left: CloudHistoryItemBuckets,
  right: CloudHistoryItemBuckets
): CloudHistoryItemBuckets {
  return {
    added: [...new Set([...left.added, ...right.added])],
    removed: [...new Set([...left.removed, ...right.removed])],
    patched: [...new Set([...left.patched, ...right.patched])],
  }
}

// ========== 事务应用解析器：将打包的步骤释放运行施加在实体场景 ==========

/**
 * 我们改变过一些家具有没有带来自增ID的最大值问题？同步清理修复下
 */
function recomputeSchemeAllocators(scheme: HomeScheme) {
  let maxInstanceId = 999
  let maxGroupId = 0

  for (const item of scheme.items.value) {
    if (item.instanceId > maxInstanceId) maxInstanceId = item.instanceId
    if (item.groupId > maxGroupId) maxGroupId = item.groupId
  }

  scheme.maxInstanceId.value = Math.max(scheme.maxInstanceId.value, maxInstanceId)
  scheme.maxGroupId.value = Math.max(scheme.maxGroupId.value, maxGroupId)
}

/**
 * 这是一个执行器函数（类似 Redux 的 reduce 函数），它负责读懂那些“逆向交易”又或者是“云端同步来的交易”，
 * 并把它们真枪实弹地写进 Vue 响应式的界面之中。
 */
export function applyEditorTransactionToScheme(scheme: HomeScheme, transaction: EditorTransaction) {
  // 执行阶段使用“浅拷贝数组 + 命中项替换”策略，避免整表 structuredClone
  let nextItems = scheme.items.value.slice()
  let nextGroupOrigins = new Map<number, string>(scheme.groupOrigins.value)
  let needsAllocatorRecompute = false
  let idToIndex: Map<string, number> | null = null

  function ensureIdToIndex() {
    if (idToIndex) return idToIndex
    idToIndex = new Map<string, number>()
    for (let index = 0; index < nextItems.length; index++) {
      idToIndex.set(nextItems[index]!.internalId, index)
    }
    return idToIndex
  }

  for (const operation of transaction.ops) {
    switch (operation.type) {
      case 'patch_items': {
        const indexMap = ensureIdToIndex()
        for (const change of operation.changes) {
          const index = indexMap.get(change.itemId)
          if (index === undefined) continue
          nextItems[index] = cloneAppItem(change.after)
          if (
            change.before.instanceId !== change.after.instanceId ||
            change.before.groupId !== change.after.groupId
          ) {
            needsAllocatorRecompute = true
          }
        }
        break
      }
      case 'add_items': {
        const indexMap = ensureIdToIndex()
        for (const incoming of operation.items) {
          const existingIndex = indexMap.get(incoming.internalId)
          const clonedIncoming = cloneAppItem(incoming)
          if (existingIndex === undefined) {
            nextItems.push(clonedIncoming)
            indexMap.set(incoming.internalId, nextItems.length - 1)
          } else {
            nextItems[existingIndex] = clonedIncoming
          }
        }
        needsAllocatorRecompute = true
        break
      }
      case 'remove_items': {
        const removedIds = new Set(operation.items.map((item) => item.internalId))
        // 抛去要求删除的条目
        nextItems = nextItems.filter((item) => !removedIds.has(item.internalId))
        idToIndex = null
        needsAllocatorRecompute = true
        break
      }
      case 'set_group_origins': {
        nextGroupOrigins = new Map(operation.after)
        break
      }
    }
  }

  // 这两句是唯一产生重写渲染开销的地方
  scheme.items.value = nextItems
  scheme.groupOrigins.value = nextGroupOrigins
  if (needsAllocatorRecompute) {
    recomputeSchemeAllocators(scheme)
  }
}

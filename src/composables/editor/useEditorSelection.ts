import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import { useSelectionFilter } from './useSelectionFilter'

type SelectionOptions = {
  // 本次操作按单件处理（例如按住单件选择修饰键），不扩展到同组家具。
  skipGroupExpansion?: boolean
  // 列表中的明确移除操作可忽略类别过滤，但仍遵守隐藏和锁定限制。
  ignoreSelectionFilter?: boolean
}

/**
 * 统一处理选择集合与选择历史，不修改家具数据。
 * 点击、框选、套索先解析实际作用的家具，再执行替换、追加、移除等集合操作。
 */
export function useEditorSelection() {
  const store = useEditorStore()
  const { activeScheme, itemsMap, groupsMap } = storeToRefs(store)

  const { recordSelectionChange } = useEditorHistory()
  const { isItemSelectable } = useSelectionFilter()

  function shouldExpandGroups(options?: SelectionOptions): boolean {
    return store.autoExpandGroupSelection && !options?.skipGroupExpansion
  }

  /**
   * 将实际命中的家具解析成操作目标：过滤不可编辑项，必要时补入同组成员。
   * 命中项和补入成员都必须可编辑且满足本次过滤条件，过滤不存在的 ID。
   * 此处只计算目标，不修改当前选择；Set 同时消除重复命中和重复组成员。
   */
  function resolveSelectionTargets(
    itemIds: Iterable<string>,
    options?: SelectionOptions
  ): Set<string> {
    const targets = new Set([...itemIds].filter((id) => isSelectionTarget(id, options)))
    if (!shouldExpandGroups(options)) return targets
    const groups = new Set<number>()
    for (const id of targets) {
      const groupId = itemsMap.value.get(id)!.groupId
      if (groupId > 0) groups.add(groupId)
    }
    for (const groupId of groups) {
      for (const id of groupsMap.value.get(groupId) ?? []) {
        if (isSelectionTarget(id, options)) targets.add(id)
      }
    }
    return targets
  }

  function isSelectionTarget(itemId: string, options?: SelectionOptions): boolean {
    return options?.ignoreSelectionFilter ? store.isItemEditable(itemId) : isItemSelectable(itemId)
  }

  // 单个命中的切换：非追加时替换选择；追加时根据命中家具是否已选中，移除或加入整组目标。
  function toggleSelection(itemId: string, additive: boolean, options?: SelectionOptions) {
    const scheme = activeScheme.value
    if (!scheme || !isSelectionTarget(itemId, options)) return
    const targets = resolveSelectionTargets([itemId], options)
    recordSelectionChange()
    const selected = scheme.selectedItemIds.value
    const remove = additive && selected.has(itemId)
    if (!additive) selected.clear()
    for (const id of targets) {
      if (remove) selected.delete(id)
      else selected.add(id)
    }
    store.triggerSelectionUpdate()
  }

  // additive=false 替换原选择，true 保留原选择并追加；两者都遵循统一的组扩展规则。
  function updateSelection(itemIds: string[], additive: boolean, options?: SelectionOptions) {
    const scheme = activeScheme.value
    if (!scheme) return
    const targets = resolveSelectionTargets(itemIds, options)
    recordSelectionChange()
    if (!additive) scheme.selectedItemIds.value.clear()
    for (const id of targets) scheme.selectedItemIds.value.add(id)
    store.triggerSelectionUpdate()
  }

  // 从当前选择中移除解析后的目标；按组选择开启时，同组可编辑成员也一起移除。
  function deselectItems(itemIds: string[], options?: SelectionOptions) {
    const scheme = activeScheme.value
    if (!scheme) return
    const targets = resolveSelectionTargets(itemIds, options)
    recordSelectionChange()
    for (const id of targets) scheme.selectedItemIds.value.delete(id)
    store.triggerSelectionUpdate()
  }

  /**
   * 批量切换（点击、框选、套索共用）：同组成员作为一个单元，只切换一次。
   * 不能逐个命中调用 toggleSelection，否则区域命中同组多件时会把同一组反复开关。
   */
  function toggleItems(itemIds: string[], options?: SelectionOptions) {
    const scheme = activeScheme.value
    if (!scheme) return
    // hits 是实际命中项；targets 还包含按组扩展出来的成员，两者语义不同。
    const hits = new Set(itemIds.filter((id) => isSelectionTarget(id, options)))
    const targets = resolveSelectionTargets(hits, options)
    if (targets.size === 0) return
    const units = new Map<number | string, Set<string>>()
    const expandGroups = shouldExpandGroups(options)
    for (const id of targets) {
      const groupId = itemsMap.value.get(id)!.groupId
      // 按组时用数字组 ID 归并，否则用字符串家具 ID；不同键类型不会相互冲突。
      const key = expandGroups && groupId > 0 ? groupId : id
      let unit = units.get(key)
      if (!unit) {
        unit = new Set()
        units.set(key, unit)
      }
      unit.add(id)
    }
    // 整次操作只记录一次选择历史，而不是为每个单元分别记录。
    recordSelectionChange()
    const selected = scheme.selectedItemIds.value
    for (const unit of units.values()) {
      // 只用实际命中项判断方向，不用扩展成员判断：
      // 命中项全已选中 → 移除整个单元；任一命中项未选中 → 加入整个单元。
      // 例如组内 A 已选、B 未选：只命中 A 会取消整组，同时命中 A/B 则选中整组。
      const remove = [...unit].every((id) => !hits.has(id) || selected.has(id))
      for (const id of unit) {
        if (remove) selected.delete(id)
        else selected.add(id)
      }
    }
    store.triggerSelectionUpdate()
  }

  function clearSelection() {
    if (!activeScheme.value) return

    // 在修改前保存选择快照，供选择撤销恢复。
    recordSelectionChange()

    activeScheme.value.selectedItemIds.value.clear()

    store.triggerSelectionUpdate()
  }

  // 全选当前可选范围（可编辑家具与类别的交集），无需再做组扩展。
  function selectAll() {
    if (!activeScheme.value) return

    // 在修改前保存选择快照，供选择撤销恢复。
    recordSelectionChange()

    activeScheme.value.selectedItemIds.value.clear()
    activeScheme.value.items.value.forEach((item) => {
      if (isItemSelectable(item.internalId)) {
        activeScheme.value!.selectedItemIds.value.add(item.internalId)
      }
    })

    store.triggerSelectionUpdate()
  }

  // 在当前可选范围内生成反选结果；范围外的旧选中项不进入新结果，不做组扩展。
  function invertSelection() {
    if (!activeScheme.value) return

    // 在修改前保存选择快照，供选择撤销恢复。
    recordSelectionChange()

    const newSelection = new Set<string>()
    activeScheme.value.items.value.forEach((item) => {
      if (
        isItemSelectable(item.internalId) &&
        !activeScheme.value!.selectedItemIds.value.has(item.internalId)
      ) {
        newSelection.add(item.internalId)
      }
    })
    activeScheme.value.selectedItemIds.value = newSelection

    store.triggerSelectionUpdate()
  }

  // 交叉选择：保留当前选择与解析后目标的交集。
  function intersectSelection(itemIds: string[], options?: SelectionOptions) {
    const scheme = activeScheme.value
    if (!scheme) return
    const targets = resolveSelectionTargets(itemIds, options)
    recordSelectionChange()
    scheme.selectedItemIds.value = new Set(
      [...scheme.selectedItemIds.value].filter((id) => targets.has(id))
    )
    store.triggerSelectionUpdate()
  }

  // 选择同类型物品：选择所有与当前选中物品相同 gameId 的物品
  function selectSameType() {
    if (!activeScheme.value) return

    const currentSelection = activeScheme.value.selectedItemIds.value
    if (currentSelection.size === 0) return

    // 在修改前保存选择快照，供选择撤销恢复。
    recordSelectionChange()

    // 收集当前选中物品的所有 gameId
    const gameIds = new Set<number>()
    currentSelection.forEach((id) => {
      const item = itemsMap.value.get(id)
      if (item) {
        gameIds.add(item.gameId)
      }
    })

    // 遍历所有物品，选中匹配的 gameId（不自动扩展到组）
    const newSelection = new Set<string>()
    activeScheme.value.items.value.forEach((item) => {
      if (isItemSelectable(item.internalId) && gameIds.has(item.gameId)) {
        newSelection.add(item.internalId)
      }
    })

    activeScheme.value.selectedItemIds.value = newSelection

    store.triggerSelectionUpdate()
  }

  return {
    resolveSelectionTargets,
    toggleSelection,
    toggleItems,
    updateSelection,
    deselectItems,
    intersectSelection,
    clearSelection,
    selectAll,
    invertSelection,
    selectSameType,
  }
}

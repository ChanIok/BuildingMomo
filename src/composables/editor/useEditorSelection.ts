import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'

export function useEditorSelection() {
  const store = useEditorStore()
  const { activeScheme, itemsMap, groupsMap } = storeToRefs(store)

  const { saveHistory } = useEditorHistory()

  // 内部辅助函数：获取物品组ID
  // 为了避免循环依赖（如果 useEditorGroups 也引用了 selection），我们直接从 map 读取
  function getItemGroupIdLocal(itemId: string): number {
    if (!activeScheme.value) return 0
    const item = itemsMap.value.get(itemId)
    return item?.groupId ?? 0
  }

  // 扩展选择到整组（内部辅助函数）
  function expandSelectionToGroups(itemIds: Set<string>): Set<string> {
    if (!activeScheme.value) return itemIds

    const expandedIds = new Set(itemIds)
    const groupsToExpand = new Set<number>()

    // 收集所有涉及的组ID
    itemIds.forEach((id) => {
      const groupId = getItemGroupIdLocal(id)
      if (groupId > 0) {
        groupsToExpand.add(groupId)
      }
    })

    // 扩展选择到整组（直接使用 groupsMap 获取 itemIds）
    groupsToExpand.forEach((groupId) => {
      const itemIds = groupsMap.value.get(groupId)
      if (itemIds) {
        itemIds.forEach((itemId) => expandedIds.add(itemId))
      }
    })

    return expandedIds
  }

  // 内部辅助函数：获取组内所有物品
  function getGroupItemsLocal(groupId: number) {
    if (!activeScheme.value || groupId <= 0) return []
    const itemIds = groupsMap.value.get(groupId)
    if (!itemIds) return []

    const result: any[] = []
    itemIds.forEach((id) => {
      const item = itemsMap.value.get(id)
      if (item) result.push(item)
    })
    return result
  }

  function toggleSelection(
    itemId: string,
    additive: boolean,
    options?: { skipGroupExpansion?: boolean }
  ) {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    // 强制单选模式：直接操作单个物品，不扩展到组
    if (options?.skipGroupExpansion) {
      if (additive) {
        if (activeScheme.value.selectedItemIds.value.has(itemId)) {
          activeScheme.value.selectedItemIds.value.delete(itemId)
        } else {
          activeScheme.value.selectedItemIds.value.add(itemId)
        }
      } else {
        activeScheme.value.selectedItemIds.value.clear()
        activeScheme.value.selectedItemIds.value.add(itemId)
      }
      store.triggerSelectionUpdate()
      return
    }

    // 组模式：原有逻辑，扩展到整组
    if (additive) {
      if (activeScheme.value.selectedItemIds.value.has(itemId)) {
        // 取消选择：如果是组，取消整组
        const groupId = getItemGroupIdLocal(itemId)
        if (groupId > 0) {
          const groupItems = getGroupItemsLocal(groupId)
          groupItems.forEach((item) =>
            activeScheme.value!.selectedItemIds.value.delete(item.internalId)
          )
        } else {
          activeScheme.value.selectedItemIds.value.delete(itemId)
        }
      } else {
        // 添加选择：如果是组，选中整组
        const groupId = getItemGroupIdLocal(itemId)
        if (groupId > 0) {
          const groupItems = getGroupItemsLocal(groupId)
          groupItems.forEach((item) =>
            activeScheme.value!.selectedItemIds.value.add(item.internalId)
          )
        } else {
          activeScheme.value.selectedItemIds.value.add(itemId)
        }
      }
    } else {
      activeScheme.value.selectedItemIds.value.clear()
      // 如果是组，选中整组
      const groupId = getItemGroupIdLocal(itemId)
      if (groupId > 0) {
        const groupItems = getGroupItemsLocal(groupId)
        groupItems.forEach((item) => activeScheme.value!.selectedItemIds.value.add(item.internalId))
      } else {
        activeScheme.value.selectedItemIds.value.add(itemId)
      }
    }
    store.triggerSelectionUpdate()
  }

  function updateSelection(
    itemIds: string[],
    additive: boolean,
    options?: { skipGroupExpansion?: boolean }
  ) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    if (!additive) {
      activeScheme.value.selectedItemIds.value.clear()
    }

    // 强制单选模式：直接添加，不扩展到组
    if (options?.skipGroupExpansion) {
      itemIds.forEach((id) => activeScheme.value!.selectedItemIds.value.add(id))
    } else {
      // 组模式：扩展选择到整组(框选行为)
      const initialSelection = new Set(itemIds)
      const expandedSelection = expandSelectionToGroups(initialSelection)
      expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.value.add(id))
    }

    store.triggerSelectionUpdate()
  }

  // 减选功能:从当前选择中移除指定物品
  function deselectItems(itemIds: string[], options?: { skipGroupExpansion?: boolean }) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    // 强制单选模式：直接移除，不扩展到组
    if (options?.skipGroupExpansion) {
      itemIds.forEach((id) => activeScheme.value!.selectedItemIds.value.delete(id))
    } else {
      // 组模式：扩展选择到整组(框选行为)
      const initialSelection = new Set(itemIds)
      const expandedSelection = expandSelectionToGroups(initialSelection)
      expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.value.delete(id))
    }

    store.triggerSelectionUpdate()
  }

  function clearSelection() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    activeScheme.value.selectedItemIds.value.clear()

    store.triggerSelectionUpdate()
  }

  // 全选可见物品
  function selectAll() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    activeScheme.value.selectedItemIds.value.clear()
    activeScheme.value.items.value.forEach((item: any) => {
      activeScheme.value!.selectedItemIds.value.add(item.internalId)
    })

    store.triggerSelectionUpdate()
  }

  // 反选
  function invertSelection() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    const newSelection = new Set<string>()
    activeScheme.value.items.value.forEach((item: any) => {
      if (!activeScheme.value!.selectedItemIds.value.has(item.internalId)) {
        newSelection.add(item.internalId)
      }
    })
    activeScheme.value.selectedItemIds.value = newSelection

    store.triggerSelectionUpdate()
  }

  // 交叉选择：只保留当前选择与新选择的重叠部分
  function intersectSelection(itemIds: string[], options?: { skipGroupExpansion?: boolean }) {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    const currentSelection = activeScheme.value.selectedItemIds.value
    const newSelection = new Set<string>()

    // 强制单选模式：直接计算交集，不扩展到组
    if (options?.skipGroupExpansion) {
      const targetSet = new Set(itemIds)
      currentSelection.forEach((id) => {
        if (targetSet.has(id)) {
          newSelection.add(id)
        }
      })
    } else {
      // 组模式：扩展选择到整组后计算交集
      const initialSelection = new Set(itemIds)
      const expandedSelection = expandSelectionToGroups(initialSelection)

      currentSelection.forEach((id) => {
        if (expandedSelection.has(id)) {
          newSelection.add(id)
        }
      })
    }

    activeScheme.value.selectedItemIds.value = newSelection

    store.triggerSelectionUpdate()
  }

  // 选择同类型物品：选择所有与当前选中物品相同 gameId 的物品
  function selectSameType() {
    if (!activeScheme.value) return

    const currentSelection = activeScheme.value.selectedItemIds.value
    if (currentSelection.size === 0) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

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
    activeScheme.value.items.value.forEach((item: any) => {
      if (gameIds.has(item.gameId)) {
        newSelection.add(item.internalId)
      }
    })

    activeScheme.value.selectedItemIds.value = newSelection

    store.triggerSelectionUpdate()
  }

  return {
    toggleSelection,
    updateSelection,
    deselectItems,
    intersectSelection,
    clearSelection,
    selectAll,
    invertSelection,
    selectSameType,
  }
}

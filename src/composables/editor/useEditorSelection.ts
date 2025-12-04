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

  function toggleSelection(itemId: string, additive: boolean) {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

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

  function updateSelection(itemIds: string[], additive: boolean) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    if (!additive) {
      activeScheme.value.selectedItemIds.value.clear()
    }

    // 扩展选择到整组(框选行为)
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)
    expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.value.add(id))

    store.triggerSelectionUpdate()
  }

  // 减选功能:从当前选择中移除指定物品
  function deselectItems(itemIds: string[]) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    // 扩展选择到整组(框选行为)
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)
    expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.value.delete(id))

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
  function intersectSelection(itemIds: string[]) {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    // 扩展选择到整组
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)

    const currentSelection = activeScheme.value.selectedItemIds.value
    const newSelection = new Set<string>()

    // 计算交集
    currentSelection.forEach((id) => {
      if (expandedSelection.has(id)) {
        newSelection.add(id)
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
  }
}

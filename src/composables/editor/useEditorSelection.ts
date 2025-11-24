import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'

export function useEditorSelection() {
  const store = useEditorStore()
  const { activeScheme, itemsMap, groupsMap, items } = storeToRefs(store)

  const { saveHistory } = useEditorHistory()

  // 内部辅助函数：获取物品组ID
  // 为了避免循环依赖（如果 useEditorGroups 也引用了 selection），我们直接从 map 读取
  function getItemGroupIdLocal(itemId: string): number {
    if (!activeScheme.value) return 0
    const item = itemsMap.value.get(itemId)
    return item?.originalData.GroupID ?? 0
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
      if (activeScheme.value.selectedItemIds.has(itemId)) {
        // 取消选择：如果是组，取消整组
        const groupId = getItemGroupIdLocal(itemId)
        if (groupId > 0) {
          const groupItems = getGroupItemsLocal(groupId)
          groupItems.forEach((item) => activeScheme.value!.selectedItemIds.delete(item.internalId))
        } else {
          activeScheme.value.selectedItemIds.delete(itemId)
        }
      } else {
        // 添加选择：如果是组，选中整组
        const groupId = getItemGroupIdLocal(itemId)
        if (groupId > 0) {
          const groupItems = getGroupItemsLocal(groupId)
          groupItems.forEach((item) => activeScheme.value!.selectedItemIds.add(item.internalId))
        } else {
          activeScheme.value.selectedItemIds.add(itemId)
        }
      }
    } else {
      activeScheme.value.selectedItemIds.clear()
      // 如果是组，选中整组
      const groupId = getItemGroupIdLocal(itemId)
      if (groupId > 0) {
        const groupItems = getGroupItemsLocal(groupId)
        groupItems.forEach((item) => activeScheme.value!.selectedItemIds.add(item.internalId))
      } else {
        activeScheme.value.selectedItemIds.add(itemId)
      }
    }
  }

  function updateSelection(itemIds: string[], additive: boolean) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    if (!additive) {
      activeScheme.value.selectedItemIds.clear()
    }

    // 扩展选择到整组(框选行为)
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)
    expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.add(id))
  }

  // 减选功能:从当前选择中移除指定物品
  function deselectItems(itemIds: string[]) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    // 扩展选择到整组(框选行为)
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)
    expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.delete(id))
  }

  function clearSelection() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    activeScheme.value.selectedItemIds.clear()
  }

  // 全选可见物品
  function selectAll() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    activeScheme.value.selectedItemIds.clear()
    items.value.forEach((item) => {
      activeScheme.value!.selectedItemIds.add(item.internalId)
    })
  }

  // 反选
  function invertSelection() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    const newSelection = new Set<string>()
    items.value.forEach((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        newSelection.add(item.internalId)
      }
    })
    activeScheme.value.selectedItemIds = newSelection
  }

  return {
    toggleSelection,
    updateSelection,
    deselectItems,
    clearSelection,
    selectAll,
    invertSelection,
  }
}

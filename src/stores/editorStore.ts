import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppItem, GameItem, GameDataFile, HeightFilter } from '../types/editor'

// 生成简单的UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const useEditorStore = defineStore('editor', () => {
  // 状态
  const items = ref<AppItem[]>([])
  const heightFilter = ref<HeightFilter>({
    min: 0,
    max: 0,
    currentMin: 0,
    currentMax: 0,
  })

  // 初始视图配置（用于重置视图）
  const initialViewConfig = ref<{ scale: number; x: number; y: number } | null>(null)

  // 选中状态
  const selectedItemIds = ref<Set<string>>(new Set())

  // 计算属性：边界框
  const bounds = computed(() => {
    if (items.value.length === 0) return null

    const xs = items.value.map((i) => i.x)
    const ys = items.value.map((i) => i.y)

    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      width: maxX - minX,
      height: maxY - minY,
    }
  })

  // 计算属性：可见物品（经过高度过滤）
  const visibleItems = computed(() => {
    return items.value.filter(
      (item) => item.z >= heightFilter.value.currentMin && item.z <= heightFilter.value.currentMax
    )
  })

  // 计算属性：统计信息
  const stats = computed(() => ({
    totalItems: items.value.length,
    visibleItems: visibleItems.value.length,
    selectedItems: selectedItemIds.value.size,
    zRange: {
      min: heightFilter.value.min,
      max: heightFilter.value.max,
    },
  }))

  // 计算属性：选中的物品列表
  const selectedItems = computed(() => {
    return items.value.filter((item) => selectedItemIds.value.has(item.internalId))
  })

  // 导入JSON数据
  function importJSON(fileContent: string) {
    try {
      const data: GameDataFile = JSON.parse(fileContent)

      if (!data.PlaceInfo || !Array.isArray(data.PlaceInfo)) {
        throw new Error('Invalid JSON format: PlaceInfo array not found')
      }

      // 转换为内部数据格式
      const newItems: AppItem[] = data.PlaceInfo.map((gameItem: GameItem) => ({
        internalId: generateUUID(),
        gameId: gameItem.ItemID,
        instanceId: gameItem.InstanceID,
        x: gameItem.Location.X,
        y: gameItem.Location.Y,
        z: gameItem.Location.Z,
        originalData: gameItem,
      }))

      items.value = newItems

      // 自动计算Z轴范围
      if (newItems.length > 0) {
        const zValues = newItems.map((item) => item.z)
        const minZ = Math.min(...zValues)
        const maxZ = Math.max(...zValues)

        heightFilter.value = {
          min: minZ,
          max: maxZ,
          currentMin: minZ,
          currentMax: maxZ,
        }
      }

      return { success: true, itemCount: newItems.length }
    } catch (error) {
      console.error('Failed to import JSON:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  // 更新高度过滤器
  function updateHeightFilter(newMin: number, newMax: number) {
    heightFilter.value.currentMin = newMin
    heightFilter.value.currentMax = newMax
  }

  // 清空数据
  function clearData() {
    items.value = []
    heightFilter.value = {
      min: 0,
      max: 0,
      currentMin: 0,
      currentMax: 0,
    }
    selectedItemIds.value.clear()
  }

  // 选择功能
  function toggleSelection(itemId: string, additive: boolean) {
    if (additive) {
      if (selectedItemIds.value.has(itemId)) {
        selectedItemIds.value.delete(itemId)
      } else {
        selectedItemIds.value.add(itemId)
      }
    } else {
      selectedItemIds.value.clear()
      selectedItemIds.value.add(itemId)
    }
  }

  function updateSelection(itemIds: string[], additive: boolean) {
    if (!additive) {
      selectedItemIds.value.clear()
    }
    itemIds.forEach((id) => selectedItemIds.value.add(id))
  }

  function clearSelection() {
    selectedItemIds.value.clear()
  }

  // 移动选中物品
  function moveSelectedItems(dx: number, dy: number) {
    items.value = items.value.map((item) => {
      if (selectedItemIds.value.has(item.internalId)) {
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
          originalData: {
            ...item.originalData,
            Location: {
              ...item.originalData.Location,
              X: item.x + dx,
              Y: item.y + dy,
            },
          },
        }
      }
      return item
    })
  }

  // 复制选中物品（带偏移）
  function duplicateSelected(offsetX: number = 50, offsetY: number = 50): string[] {
    const newIds: string[] = []
    const duplicates: AppItem[] = []
    let nextInstanceId = getNextInstanceId()

    items.value.forEach((item) => {
      if (selectedItemIds.value.has(item.internalId)) {
        const newId = generateUUID()
        const newInstanceId = nextInstanceId++
        newIds.push(newId)

        const newX = item.x + offsetX
        const newY = item.y + offsetY

        duplicates.push({
          ...item,
          internalId: newId,
          instanceId: newInstanceId,
          x: newX,
          y: newY,
          originalData: {
            ...item.originalData,
            InstanceID: newInstanceId,
            Location: {
              ...item.originalData.Location,
              X: newX,
              Y: newY,
            },
          },
        })
      }
    })

    items.value.push(...duplicates)

    // 选中新副本
    selectedItemIds.value.clear()
    newIds.forEach((id) => selectedItemIds.value.add(id))

    return newIds
  }

  // 删除选中物品
  function deleteSelected() {
    items.value = items.value.filter((item) => !selectedItemIds.value.has(item.internalId))
    selectedItemIds.value.clear()
  }

  // 全选可见物品
  function selectAll() {
    selectedItemIds.value.clear()
    visibleItems.value.forEach((item) => {
      selectedItemIds.value.add(item.internalId)
    })
  }

  // 反选
  function invertSelection() {
    const newSelection = new Set<string>()
    visibleItems.value.forEach((item) => {
      if (!selectedItemIds.value.has(item.internalId)) {
        newSelection.add(item.internalId)
      }
    })
    selectedItemIds.value = newSelection
  }

  // 获取下一个唯一的 InstanceID（自增策略）
  function getNextInstanceId(): number {
    if (items.value.length === 0) return 1

    const maxId = items.value.reduce((max, item) => Math.max(max, item.instanceId), 0)
    return maxId + 1
  }

  // 粘贴物品（从剪贴板）
  function pasteItems(clipboardItems: AppItem[], offsetX: number, offsetY: number): string[] {
    const newIds: string[] = []
    const newItems: AppItem[] = []
    let nextInstanceId = getNextInstanceId()

    clipboardItems.forEach((item) => {
      const newId = generateUUID()
      const newInstanceId = nextInstanceId++
      newIds.push(newId)

      const newX = item.x + offsetX
      const newY = item.y + offsetY

      newItems.push({
        ...item,
        internalId: newId,
        instanceId: newInstanceId,
        x: newX,
        y: newY,
        originalData: {
          ...item.originalData,
          InstanceID: newInstanceId,
          Location: {
            ...item.originalData.Location,
            X: newX,
            Y: newY,
          },
        },
      })
    })

    items.value.push(...newItems)

    // 选中新粘贴的物品
    selectedItemIds.value.clear()
    newIds.forEach((id) => selectedItemIds.value.add(id))

    return newIds
  }

  return {
    items,
    heightFilter,
    bounds,
    visibleItems,
    stats,
    selectedItemIds,
    selectedItems,
    initialViewConfig,
    importJSON,
    updateHeightFilter,
    clearData,
    toggleSelection,
    updateSelection,
    clearSelection,
    moveSelectedItems,
    duplicateSelected,
    deleteSelected,
    selectAll,
    invertSelection,
    pasteItems,
  }
})

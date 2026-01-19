import { storeToRefs } from 'pinia'
import { triggerRef } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import type { AppItem } from '../../types/editor'

export function useEditorGroups() {
  const store = useEditorStore()
  // 注意：itemsMap 和 groupsMap 必须在 store 中导出
  const { activeScheme, itemsMap, groupsMap } = storeToRefs(store)
  const { saveHistory } = useEditorHistory()

  // 获取指定组的所有物品（使用 groupsMap 和 itemsMap 优化性能）
  function getGroupItems(groupId: number): AppItem[] {
    if (!activeScheme.value || groupId <= 0) return []

    const itemIds = groupsMap.value.get(groupId)
    if (!itemIds) return []

    // 使用 itemsMap 快速获取物品对象
    const items: AppItem[] = []
    itemIds.forEach((id) => {
      const item = itemsMap.value.get(id)
      if (item) items.push(item)
    })
    return items
  }

  // 获取物品的组ID（使用 itemsMap 优化性能）
  function getItemGroupId(itemId: string): number {
    if (!activeScheme.value) return 0
    const item = itemsMap.value.get(itemId)
    return item?.groupId ?? 0
  }

  // 获取所有组ID列表（去重）（使用 groupsMap 优化性能）
  function getAllGroupIds(): number[] {
    return Array.from(groupsMap.value.keys()).sort((a, b) => a - b)
  }

  // 成组：将选中的物品成组
  function groupSelected() {
    if (!activeScheme.value) return
    if (activeScheme.value.selectedItemIds.value.size < 2) {
      console.warn('[Group] 至少需要选中2个物品才能成组')
      return
    }

    // 保存历史（编辑操作）
    saveHistory('edit')

    const newGroupId = activeScheme.value.maxGroupId.value + 1

    // 原地更新所有选中物品的 GroupID
    // 因为是 ShallowRef 且 items 已经是 Plain Object，我们可以直接修改并 triggerRef
    // 避免 map 创建新数组，提高性能
    const items = activeScheme.value.items.value
    const selected = activeScheme.value.selectedItemIds.value

    let changed = false
    for (const item of items) {
      if (selected.has(item.internalId)) {
        item.groupId = newGroupId
        changed = true
      }
    }

    if (changed) {
      // 更新方案级别的最大 GroupID（持久化历史最大值）
      activeScheme.value.maxGroupId.value = newGroupId
      store.triggerSceneUpdate()
    }

    console.log(
      `[Group] 成功创建组 #${newGroupId}，包含 ${activeScheme.value.selectedItemIds.value.size} 个物品`
    )
  }

  // 取消组合：将选中的物品解散组
  function ungroupSelected() {
    if (!activeScheme.value) return
    if (activeScheme.value.selectedItemIds.value.size === 0) return

    // 检查是否有组
    const hasGroup = Array.from(activeScheme.value.selectedItemIds.value).some((id) => {
      const groupId = getItemGroupId(id)
      return groupId > 0
    })

    if (!hasGroup) {
      console.warn('[Group] 选中的物品没有组')
      return
    }

    // 保存历史（编辑操作）
    saveHistory('edit')

    // 收集要解散的组 ID，用于清除原点
    const groupIdsToRemove = new Set<number>()
    const items = activeScheme.value.items.value
    const selected = activeScheme.value.selectedItemIds.value

    // 原地将所有选中物品的 GroupID 设为 0
    let changed = false
    for (const item of items) {
      if (selected.has(item.internalId) && item.groupId > 0) {
        groupIdsToRemove.add(item.groupId)
        item.groupId = 0
        changed = true
      }
    }

    if (changed) {
      // 清除这些组的原点设置
      const scheme = activeScheme.value
      groupIdsToRemove.forEach((groupId) => {
        scheme.groupOrigins.value.delete(groupId)
      })
      if (groupIdsToRemove.size > 0) {
        // 触发 groupOrigins 的响应式更新
        import('vue').then(({ triggerRef }) => {
          triggerRef(scheme.groupOrigins)
        })
      }

      store.triggerSceneUpdate()
    }

    console.log(`[Group] 已取消 ${activeScheme.value.selectedItemIds.value.size} 个物品的组合`)
  }

  // HSL 转 RGBA 的工具函数
  function hslToRgba(h: number, s: number, l: number, a: number = 1): string {
    s /= 100
    l /= 100

    const k = (n: number) => (n + h / 30) % 12
    const f = (n: number) =>
      l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))

    const r = Math.round(255 * f(0))
    const g = Math.round(255 * f(8))
    const b = Math.round(255 * f(4))

    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  // 根据 GroupID 计算组颜色（使用黄金角度分布）
  function getGroupColor(groupId: number): string {
    if (groupId <= 0) return 'rgba(0, 0, 0, 0)' // transparent
    const hue = (groupId * 137.5) % 360 // 黄金角度，分布更均匀
    return hslToRgba(hue, 70, 60, 0.8) // 直接返回带透明度的 RGBA
  }

  // ========== 组合原点管理 ==========

  /**
   * 设置组的原点物品
   */
  function setGroupOrigin(groupId: number, itemId: string) {
    const scheme = activeScheme.value
    if (!scheme) return

    scheme.groupOrigins.value.set(groupId, itemId)
    triggerRef(scheme.groupOrigins)
  }

  /**
   * 清除组的原点设置
   */
  function clearGroupOrigin(groupId: number) {
    const scheme = activeScheme.value
    if (!scheme) return

    scheme.groupOrigins.value.delete(groupId)
    triggerRef(scheme.groupOrigins)
  }

  /**
   * 获取组的原点物品 ID
   */
  function getGroupOrigin(groupId: number): string | undefined {
    const scheme = activeScheme.value
    if (!scheme) return undefined

    return scheme.groupOrigins.value.get(groupId)
  }

  return {
    groupSelected,
    ungroupSelected,
    getGroupItems,
    getItemGroupId,
    getAllGroupIds,
    getGroupColor,
    setGroupOrigin,
    clearGroupOrigin,
    getGroupOrigin,
  }
}

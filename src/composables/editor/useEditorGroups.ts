import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import type { AppItem } from '../../types/editor'

export function useEditorGroups() {
  const store = useEditorStore()
  // 注意：itemsMap 和 groupsMap 必须在 store 中导出
  const { activeScheme, itemsMap, groupsMap } = storeToRefs(store)
  const { recordTransaction } = useEditorHistory()

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

    const newGroupId = activeScheme.value.maxGroupId.value + 1

    recordTransaction('group.create', () => {
      const items = activeScheme.value!.items.value
      const selected = activeScheme.value!.selectedItemIds.value

      const hasSelected = items.some((item) => selected.has(item.internalId))
      if (!hasSelected) return

      // 【核心优化点】必须使用 `.map()` 产出新的家具列表，并且只对改动的家具使用 `{...item}` 解构深拷贝。
      // 如此操作后，没有修改过的家具的内存引用(===)不会变化，
      // 这能让历史系统立刻“跳过”排查上千个没有动过的对象，极大加速系统！
      activeScheme.value!.items.value = items.map((item) =>
        selected.has(item.internalId) ? { ...item, groupId: newGroupId } : item
      )
      activeScheme.value!.maxGroupId.value = newGroupId
      store.triggerSceneUpdate()
    })

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

    recordTransaction('group.remove', () => {
      const items = activeScheme.value!.items.value
      const selected = activeScheme.value!.selectedItemIds.value

      const groupIdsToRemove = new Set<number>()
      for (const item of items) {
        if (selected.has(item.internalId) && item.groupId > 0) {
          groupIdsToRemove.add(item.groupId)
        }
      }
      if (groupIdsToRemove.size === 0) return

      // 同上：严格遵循不直接写 item.groupId = 0 而是用解构产出新对象的方法
      // 维系响应式引用的历史系统的极速快进性能
      activeScheme.value!.items.value = items.map((item) =>
        selected.has(item.internalId) && item.groupId > 0 ? { ...item, groupId: 0 } : item
      )

      const scheme = activeScheme.value!
      const nextOrigins = new Map(scheme.groupOrigins.value)
      groupIdsToRemove.forEach((groupId) => nextOrigins.delete(groupId))
      scheme.groupOrigins.value = nextOrigins

      store.triggerSceneUpdate()
    })

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

    if (scheme.groupOrigins.value.get(groupId) === itemId) {
      return
    }

    recordTransaction('group.origin.set', () => {
      const nextOrigins = new Map(scheme.groupOrigins.value)
      nextOrigins.set(groupId, itemId)
      scheme.groupOrigins.value = nextOrigins
    })
  }

  /**
   * 清除组的原点设置
   */
  function clearGroupOrigin(groupId: number) {
    const scheme = activeScheme.value
    if (!scheme) return

    if (!scheme.groupOrigins.value.has(groupId)) {
      return
    }

    recordTransaction('group.origin.clear', () => {
      const nextOrigins = new Map(scheme.groupOrigins.value)
      nextOrigins.delete(groupId)
      scheme.groupOrigins.value = nextOrigins
    })
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

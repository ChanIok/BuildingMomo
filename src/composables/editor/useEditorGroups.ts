import { patchGroupNames } from '@/lib/collectionTree'
import { reconcileGroupOrigins, setSchemeItems } from '@/lib/groupState'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useEditorHistory } from './useEditorHistory'
import type { AppItem, GroupEditTarget } from '../../types/editor'

/** 成组动作将要作用的目标；多个候选必须由调用方选择。 */
export type GroupRequest =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'merge'; targetId: number }
  | { kind: 'choose'; candidates: number[] }

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

  function canEditGroupOrigin(groupId: number): boolean {
    const items = getGroupItems(groupId)
    return items.length > 0 && items.every((item) => store.isItemEditable(item.internalId))
  }

  function canRenameGroup(groupId: number): boolean {
    const ids = groupsMap.value.get(groupId)
    return !!ids?.size
  }

  function renameGroup(groupId: number, value: string) {
    const scheme = activeScheme.value
    if (!scheme || !canRenameGroup(groupId)) return
    const name = value.trim().slice(0, 200)
    const previous = scheme.collectionTree.value.groups.find(
      (group) => group.groupId === groupId
    )?.name
    if ((previous ?? '') === name) return
    recordTransaction('group.rename', () => {
      scheme.collectionTree.value = patchGroupNames(
        scheme.collectionTree.value,
        previous ? [[groupId, previous]] : [],
        name ? [[groupId, name]] : []
      )
    })
  }

  // ========== 成组与合并 ==========

  function selectionTarget(): GroupEditTarget {
    return {
      kind: 'selection',
      schemeId: activeScheme.value?.id ?? '',
      itemIds: [...(activeScheme.value?.selectedItemIds.value ?? [])],
    }
  }

  function targetItems(target: GroupEditTarget): Set<string> {
    if (!activeScheme.value || activeScheme.value.id !== target.schemeId) return new Set()
    if (target.kind === 'selection') {
      return new Set(target.itemIds.filter((id) => store.isItemEditable(id)))
    }
    // 面板整理按完整组处理；任一组已被删除则放弃，避免悄悄只整理一部分。
    if (target.groupIds.some((id) => !groupsMap.value.has(id))) return new Set()
    return new Set(target.groupIds.flatMap((id) => [...groupsMap.value.get(id)!]))
  }

  /**
   * 选区中出现过的组，按组 ID 升序。
   * 不区分整组选中与部分选中：部分选中的组同样是可以保留身份的目标。
   */
  function getSelectedGroupIds(target: GroupEditTarget = selectionTarget()): number[] {
    const ids = new Set<number>()
    for (const itemId of targetItems(target)) {
      const groupId = itemsMap.value.get(itemId)?.groupId ?? 0
      if (groupId > 0 && groupsMap.value.has(groupId)) ids.add(groupId)
    }
    return [...ids].sort((left, right) => left - right)
  }

  /** 选区中是否存在不属于该组的家具。 */
  function hasMemberOutside(groupId: number, selected: ReadonlySet<string>): boolean {
    for (const itemId of selected) {
      if ((itemsMap.value.get(itemId)?.groupId ?? 0) !== groupId) return true
    }
    return false
  }

  /** 唯一候选组直接合并；选区涉及多个组时交由调用方选择目标。 */
  function resolveGroupRequest(target: GroupEditTarget = selectionTarget()): GroupRequest {
    const selected = targetItems(target)
    if (selected.size < 2) return { kind: 'none' }
    const candidates = getSelectedGroupIds(target)
    if (!candidates.length) return { kind: 'create' }
    if (candidates.length > 1) return { kind: 'choose', candidates }
    const targetId = candidates[0]!
    if (hasMemberOutside(targetId, selected)) return { kind: 'merge', targetId }
    // 选区完全落在该组内部时没有可并入的家具：整组选中无事可做，部分成员则拆分为新组。
    const members = groupsMap.value.get(targetId)
    return !members || members.size !== selected.size ? { kind: 'create' } : { kind: 'none' }
  }

  /** 成组入口是否可用。 */
  function canGroupSelection(target: GroupEditTarget = selectionTarget()): boolean {
    return resolveGroupRequest(target).kind !== 'none'
  }

  function canUngroupSelection(target: GroupEditTarget = selectionTarget()): boolean {
    return getSelectedGroupIds(target).length > 0
  }

  /**
   * 把选中的家具并入 targetId；targetId 为 null 时新建组。
   * 合并沿用目标组 ID，因此名称、所属集合、顺序、显隐锁定与组原点都保持不变。
   */
  function groupInto(
    targetId: number | null,
    target: GroupEditTarget = selectionTarget()
  ): boolean {
    const scheme = activeScheme.value
    if (!scheme) return false
    const selected = targetItems(target)
    if (selected.size < 2) return false
    if (targetId !== null && !groupsMap.value.has(targetId)) return false
    if (
      targetId !== null &&
      target.kind === 'selection' &&
      !getGroupItems(targetId).some((item) => store.isItemEditable(item.internalId))
    )
      return false

    const nextGroupId = targetId ?? scheme.maxGroupId.value + 1

    return recordTransaction(targetId === null ? 'group.create' : 'group.merge', () => {
      const items = scheme.items.value
      // 只收集归属真正发生变化的家具，未命中的对象必须保留原引用。
      const moving = new Set<string>()
      for (const item of items) {
        if (selected.has(item.internalId) && item.groupId !== nextGroupId)
          moving.add(item.internalId)
      }
      if (!moving.size) return false

      const previousTree = scheme.collectionTree.value
      // 【核心优化点】必须使用 `.map()` 产出新的家具列表，并且只对改动的家具使用 `{...item}` 解构深拷贝。
      // 如此操作后，没有修改过的家具的内存引用(===)不会变化，
      // 这能让历史系统立刻“跳过”排查上千个没有动过的对象，极大加速系统！
      setSchemeItems(
        scheme,
        items.map((item) =>
          moving.has(item.internalId) ? { ...item, groupId: nextGroupId } : item
        )
      )
      if (targetId === null) scheme.maxGroupId.value = nextGroupId
      // 目标组身份独占：只移除已解散的组，不把源组名称或所属集合搬到目标组上。
      const live = new Set<number>()
      for (const item of scheme.items.value) if (item.groupId > 0) live.add(item.groupId)
      const groups = previousTree.groups.filter((group) => live.has(group.groupId))
      if (groups.length !== previousTree.groups.length) {
        scheme.collectionTree.value = { ...previousTree, groups }
      }
      scheme.groupOrigins.value = reconcileGroupOrigins(
        scheme.groupOrigins.value,
        scheme.items.value
      )
      store.triggerSceneUpdate()
      return true
    })
  }

  /** 兼容入口：可直接执行的动作立即执行，需要选择目标或无事可做时返回 false。 */
  function groupSelected(): boolean {
    const request = resolveGroupRequest()
    if (request.kind === 'none' || request.kind === 'choose') return false
    return groupInto(request.kind === 'merge' ? request.targetId : null)
  }

  /** 成组入口：目标唯一时立即执行，涉及多个组时打开目标选择对话框。 */
  function requestGroup(target: GroupEditTarget = selectionTarget()): boolean {
    const request = resolveGroupRequest(target)
    if (request.kind === 'none') return false
    if (request.kind !== 'choose') {
      return groupInto(request.kind === 'merge' ? request.targetId : null, target)
    }
    const uiStore = useUIStore()
    uiStore.groupMergeCandidates = [...request.candidates]
    uiStore.groupMergeTarget = target
    uiStore.groupMergeOpen = true
    return false
  }

  // 画布按可编辑家具解组，面板按明确指定的完整组解组。
  function ungroupSelected(target: GroupEditTarget = selectionTarget()) {
    const scheme = activeScheme.value
    if (!scheme || !canUngroupSelection(target)) return
    const selected = targetItems(target)

    recordTransaction('group.remove', () => {
      const items = scheme.items.value

      // 同上：严格遵循不直接写 item.groupId = 0 而是用解构产出新对象的方法
      // 维系响应式引用的历史系统的极速快进性能
      setSchemeItems(
        scheme,
        items.map((item) =>
          selected.has(item.internalId) && item.groupId > 0 ? { ...item, groupId: 0 } : item
        )
      )

      scheme.groupOrigins.value = reconcileGroupOrigins(
        scheme.groupOrigins.value,
        scheme.items.value
      )

      store.triggerSceneUpdate()
    })

    console.log(`[Group] 已取消 ${selected.size} 个物品的组合`)
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
    if (!scheme || !canEditGroupOrigin(groupId)) return
    if (!store.isItemEditable(itemId)) return

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
    if (!scheme || !canEditGroupOrigin(groupId)) return

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
    renameGroup,
    canRenameGroup,
    groupSelected,
    groupInto,
    requestGroup,
    resolveGroupRequest,
    canGroupSelection,
    canUngroupSelection,
    getSelectedGroupIds,
    ungroupSelected,
    getGroupItems,
    getItemGroupId,
    getAllGroupIds,
    getGroupColor,
    canEditGroupOrigin,
    setGroupOrigin,
    clearGroupOrigin,
    getGroupOrigin,
  }
}

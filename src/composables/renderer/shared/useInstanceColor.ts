import { ref } from 'vue'
import type { InstancedMesh } from 'three'
import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { scratchColor } from './scratchObjects'

/**
 * 实例颜色管理
 *
 * 负责根据状态（hover/选中/分组/参照物）计算和更新实例颜色
 */
export function useInstanceColor() {
  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const { getGroupColor } = useEditorGroups()

  // 当前 hover 的物品（仅 3D 视图内部使用，不改变全局选中状态）
  const hoveredItemId = ref<string | null>(null)
  // 被抑制 hover 的物品 ID（用于在选中瞬间暂时屏蔽 hover 效果，直到鼠标移出）
  const suppressedHoverId = ref<string | null>(null)

  /**
   * 将 CSS 颜色字符串转换为十六进制数值
   */
  function convertColorToHex(colorStr: string | undefined): number {
    if (!colorStr) return 0x94a3b8
    const matches = colorStr.match(/\d+/g)
    if (!matches || matches.length < 3) return 0x94a3b8
    const r = parseInt(matches[0] ?? '148', 10)
    const g = parseInt(matches[1] ?? '163', 10)
    const b = parseInt(matches[2] ?? '184', 10)
    return (r << 16) | (g << 8) | b
  }

  /**
   * 获取物品颜色（考虑 hover/选中/分组/参照物状态）
   *
   * @param item - 物品数据
   * @param type - 渲染类型（box/icon）
   * @param mode - 渲染模式（box/icon/simple-box/model），默认为非 model 模式
   */
  function getItemColor(item: AppItem, type: 'box' | 'icon', mode?: string): number {
    // Model 模式特殊处理：只有参照物需要颜色叠加，其他状态保持白色（由描边系统处理）
    if (mode === 'model') {
      // 参照物高亮（唯一需要颜色叠加的状态）
      if (uiStore.alignReferenceItemId === item.internalId) {
        return 0xfacc15 // yellow-400
      }
      // 其他状态（hover/选中/组合）都返回白色，不影响纹理原色
      return 0xffffff
    }

    // 以下是 Box/Icon/SimpleBox 模式的原有逻辑
    // hover 高亮优先级最高（即使物品已被选中，hover 时也显示为琥珀色）
    if (hoveredItemId.value === item.internalId) {
      return type === 'icon' ? 0xf59e0b : 0xf59e0b // Icon & Box/SimpleBox: amber-400
    }

    // 参照物高亮（次优先级）
    if (uiStore.alignReferenceItemId === item.internalId) {
      return type === 'icon' ? 0xfacc15 : 0xfacc15 // Icon & Box/SimpleBox: yellow-400
    }

    const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()

    // 其次是选中高亮
    if (selectedItemIds.has(item.internalId)) {
      return type === 'icon' ? 0x60a5fa : 0x60a5fa // Icon & Box/SimpleBox: blue-400
    }

    const groupId = item.groupId
    if (groupId > 0) {
      return convertColorToHex(getGroupColor(groupId))
    }

    return 0x94a3b8
  }

  /**
   * 更新所有实例颜色（用于选中状态变化或 hover 变化时的刷新）
   */
  function updateInstancesColor(
    mode: string,
    meshTarget: InstancedMesh | null,
    iconMeshTarget: InstancedMesh | null,
    simpleBoxMeshTarget: InstancedMesh | null,
    indexToIdMap: Map<number, string>,
    // Model 模式额外参数
    modelMeshMap?: Map<number, InstancedMesh>,
    modelInternalIdToMeshInfo?: Map<string, { itemId: number; localIndex: number }>
  ) {
    const items = editorStore.activeScheme?.items.value ?? []
    if (!indexToIdMap || indexToIdMap.size === 0) return

    const itemById = new Map<string, AppItem>()
    for (const item of items) {
      itemById.set(item.internalId, item)
    }

    // 仅更新当前可见的 Mesh
    if (mode === 'box' && meshTarget) {
      for (const [index, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        scratchColor.setHex(getItemColor(item, 'box', mode))
        meshTarget.setColorAt(index, scratchColor)
      }
      if (meshTarget.instanceColor) meshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'icon' && iconMeshTarget) {
      for (const [index, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        scratchColor.setHex(getItemColor(item, 'icon', mode))
        iconMeshTarget.setColorAt(index, scratchColor)
      }
      if (iconMeshTarget.instanceColor) iconMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      for (const [index, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        scratchColor.setHex(getItemColor(item, 'box', mode))
        simpleBoxMeshTarget.setColorAt(index, scratchColor)
      }
      if (simpleBoxMeshTarget.instanceColor) simpleBoxMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'model' && modelMeshMap && modelInternalIdToMeshInfo) {
      // Model 模式：遍历所有物品，更新对应的 mesh 实例颜色
      for (const [, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue

        const meshInfo = modelInternalIdToMeshInfo.get(id)
        if (!meshInfo) continue

        const mesh = modelMeshMap.get(meshInfo.itemId)
        if (!mesh) continue

        scratchColor.setHex(getItemColor(item, 'box', mode))
        mesh.setColorAt(meshInfo.localIndex, scratchColor)
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
  }

  /**
   * 局部更新单个物品的颜色（用于 hover 状态变化）
   */
  function updateInstanceColorById(
    id: string,
    mode: string,
    meshTarget: InstancedMesh | null,
    iconMeshTarget: InstancedMesh | null,
    simpleBoxMeshTarget: InstancedMesh | null,
    idToIndexMap: Map<string, number>,
    // Model 模式额外参数
    modelMeshMap?: Map<number, InstancedMesh>,
    modelInternalIdToMeshInfo?: Map<string, { itemId: number; localIndex: number }>
  ) {
    const item = editorStore.activeScheme?.items.value.find((it) => it.internalId === id)
    if (!item) return

    if (mode === 'box' && meshTarget) {
      const index = idToIndexMap.get(id)
      if (index === undefined) return
      scratchColor.setHex(getItemColor(item, 'box', mode))
      meshTarget.setColorAt(index, scratchColor)
      if (meshTarget.instanceColor) meshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'icon' && iconMeshTarget) {
      const index = idToIndexMap.get(id)
      if (index === undefined) return
      scratchColor.setHex(getItemColor(item, 'icon', mode))
      iconMeshTarget.setColorAt(index, scratchColor)
      if (iconMeshTarget.instanceColor) iconMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      const index = idToIndexMap.get(id)
      if (index === undefined) return
      scratchColor.setHex(getItemColor(item, 'box', mode))
      simpleBoxMeshTarget.setColorAt(index, scratchColor)
      if (simpleBoxMeshTarget.instanceColor) simpleBoxMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'model' && modelMeshMap && modelInternalIdToMeshInfo) {
      // Model 模式：通过 internalId 找到对应的 mesh 和 localIndex
      const meshInfo = modelInternalIdToMeshInfo.get(id)
      if (!meshInfo) return

      const mesh = modelMeshMap.get(meshInfo.itemId)
      if (!mesh) return

      scratchColor.setHex(getItemColor(item, 'box', mode))
      mesh.setColorAt(meshInfo.localIndex, scratchColor)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /**
   * 设置 hover 物品并局部刷新对应实例颜色
   */
  function setHoveredItemId(
    id: string | null,
    mode: string,
    meshTarget: InstancedMesh | null,
    iconMeshTarget: InstancedMesh | null,
    simpleBoxMeshTarget: InstancedMesh | null,
    idToIndexMap: Map<string, number>,
    // Model 模式额外参数
    modelMeshMap?: Map<number, InstancedMesh>,
    modelInternalIdToMeshInfo?: Map<string, { itemId: number; localIndex: number }>
  ) {
    // 如果当前有被抑制的 hover ID，且传入的 ID 依然是它，则忽略（保持选中状态的颜色）
    if (suppressedHoverId.value && id === suppressedHoverId.value) {
      return
    }

    // 如果鼠标移到了其他物体或空处，解除抑制
    if (suppressedHoverId.value && id !== suppressedHoverId.value) {
      suppressedHoverId.value = null
    }

    const prevId = hoveredItemId.value
    hoveredItemId.value = id

    // 先恢复上一个 hover 的颜色，再应用新的 hover 颜色
    if (prevId && prevId !== id) {
      updateInstanceColorById(
        prevId,
        mode,
        meshTarget,
        iconMeshTarget,
        simpleBoxMeshTarget,
        idToIndexMap,
        modelMeshMap,
        modelInternalIdToMeshInfo
      )
    }

    if (id) {
      updateInstanceColorById(
        id,
        mode,
        meshTarget,
        iconMeshTarget,
        simpleBoxMeshTarget,
        idToIndexMap,
        modelMeshMap,
        modelInternalIdToMeshInfo
      )
    }
  }

  return {
    hoveredItemId,
    suppressedHoverId,
    convertColorToHex,
    getItemColor,
    updateInstancesColor,
    updateInstanceColorById,
    setHoveredItemId,
  }
}

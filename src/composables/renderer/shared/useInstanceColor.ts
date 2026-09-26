import { ref } from 'vue'
import type { Color, InstancedMesh } from 'three'
import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { MODEL_FALLBACK_MESH_KEY } from '../modes/useModelMode'
import { scratchColor } from './scratchObjects'
import {
  ALIGN_REFERENCE_ITEM_COLOR,
  convertColorToHex,
  DEFAULT_ITEM_COLOR,
  HOVER_ITEM_COLOR,
  SELECTED_ITEM_COLOR,
} from './interactionColors'

/**
 * Model 模式组色亮度归一化的亮度下限。
 * 防止高饱和组色被过度提亮，取值与 materialPipeline 的染色 boost 一致。
 */
const MODEL_GROUP_TINT_MIN_LUMINANCE = 0.4

/**
 * 实例颜色管理
 *
 * 负责根据状态（hover/选中/分组/参照物）计算和更新实例颜色
 */
export function useInstanceColor() {
  const editorStore = useEditorStore()
  const settingsStore = useSettingsStore()
  const uiStore = useUIStore()
  const { getGroupColor } = useEditorGroups()

  // 当前 hover 的物品（仅 3D 视图内部使用，不改变全局选中状态）
  const hoveredItemId = ref<string | null>(null)
  // 来自结构面板的 hover 集合（优先级高于画布单点 hover）
  const sidebarHoveredItemIds = ref<Set<string> | null>(null)
  // 被抑制 hover 的物品 ID（用于在选中瞬间暂时屏蔽 hover 效果，直到鼠标移出）
  const suppressedHoverId = ref<string | null>(null)

  function isItemHovered(internalId: string): boolean {
    const sidebarHovered = sidebarHoveredItemIds.value
    if (sidebarHovered && sidebarHovered.size > 0) {
      return sidebarHovered.has(internalId)
    }
    return hoveredItemId.value === internalId
  }

  function getItemColor(item: AppItem, mode?: string): number {
    // Model 模式特殊处理：默认只有参照物需要颜色叠加，其余状态保持白色（由描边系统处理）
    if (mode === 'model') {
      // 参照物高亮（始终需要颜色叠加）
      if (uiStore.alignReferenceItemId === item.internalId) {
        return ALIGN_REFERENCE_ITEM_COLOR
      }
      // 组合配色开关打开时，同组家具叠加组色（hover/选中仍由描边表达，不占用颜色）
      if (settingsStore.settings.modelGroupColorTint && item.groupId > 0) {
        return convertColorToHex(getGroupColor(item.groupId))
      }
      // 其他状态都返回白色，不影响纹理原色
      return 0xffffff
    }

    // 以下是 Box/Icon/SimpleBox 模式的原有逻辑
    if (isItemHovered(item.internalId)) return HOVER_ITEM_COLOR
    if (uiStore.alignReferenceItemId === item.internalId) return ALIGN_REFERENCE_ITEM_COLOR

    const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
    if (selectedItemIds.has(item.internalId)) return SELECTED_ITEM_COLOR

    const groupId = item.groupId
    if (groupId > 0) {
      return convertColorToHex(getGroupColor(groupId))
    }

    return DEFAULT_ITEM_COLOR
  }

  /**
   * 计算实例颜色并写入共享 scratchColor。
   *
   * Model 模式下 instanceColor 会被 three 内建管线乘进贴图，直接乘组色会让模型明显发暗，
   * 因此按亮度归一化后再写（与 materialPipeline 的染色 boost 同款），保留贴图明暗层次。
   * fallback 方块使用 box 材质（组色即面色），保持原始组色不做归一化。
   */
  function resolveItemColor(item: AppItem, mode: string, isFallbackBox: boolean): Color {
    scratchColor.setHex(getItemColor(item, mode))

    if (
      mode === 'model' &&
      !isFallbackBox &&
      settingsStore.settings.modelGroupColorTint &&
      item.groupId > 0 &&
      uiStore.alignReferenceItemId !== item.internalId
    ) {
      const luminance = 0.299 * scratchColor.r + 0.587 * scratchColor.g + 0.114 * scratchColor.b
      scratchColor.multiplyScalar(1 / Math.max(luminance, MODEL_GROUP_TINT_MIN_LUMINANCE))
    }

    return scratchColor
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
    modelMeshMap?: Map<string, InstancedMesh>,
    modelInternalIdToMeshInfo?: Map<string, { meshKey: string; localIndex: number }>,
    modelFallbackMesh?: InstancedMesh | null
  ) {
    const items = editorStore.activeScheme?.items.value ?? []
    if (!indexToIdMap || indexToIdMap.size === 0) return

    const itemById = new Map<string, AppItem>()
    for (const item of items) {
      itemById.set(item.internalId, item)
    }

    // Model 模式下 '-1' 对应 fallbackMesh（无模型配置的物品渲染为方块）
    const resolveModelMesh = (meshKey: string): InstancedMesh | null | undefined =>
      meshKey === MODEL_FALLBACK_MESH_KEY ? modelFallbackMesh : modelMeshMap?.get(meshKey)

    // 仅更新当前可见的 Mesh
    if (mode === 'box' && meshTarget) {
      for (const [index, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        meshTarget.setColorAt(index, resolveItemColor(item, mode, false))
      }
      if (meshTarget.instanceColor) meshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'icon' && iconMeshTarget) {
      for (const [index, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        iconMeshTarget.setColorAt(index, resolveItemColor(item, mode, false))
      }
      if (iconMeshTarget.instanceColor) iconMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      for (const [index, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        simpleBoxMeshTarget.setColorAt(index, resolveItemColor(item, mode, false))
      }
      if (simpleBoxMeshTarget.instanceColor) simpleBoxMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'model' && modelMeshMap && modelInternalIdToMeshInfo) {
      // Model 模式：遍历所有物品，更新对应的 mesh 实例颜色
      for (const [, id] of indexToIdMap.entries()) {
        const item = itemById.get(id)
        if (!item) continue

        const meshInfo = modelInternalIdToMeshInfo.get(id)
        if (!meshInfo) continue

        const mesh = resolveModelMesh(meshInfo.meshKey)
        if (!mesh) continue

        const isFallbackBox = meshInfo.meshKey === MODEL_FALLBACK_MESH_KEY
        mesh.setColorAt(meshInfo.localIndex, resolveItemColor(item, mode, isFallbackBox))
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
    modelMeshMap?: Map<string, InstancedMesh>,
    modelInternalIdToMeshInfo?: Map<string, { meshKey: string; localIndex: number }>,
    modelFallbackMesh?: InstancedMesh | null
  ) {
    const item = editorStore.activeScheme?.items.value.find((it) => it.internalId === id)
    if (!item) return

    if (mode === 'box' && meshTarget) {
      const index = idToIndexMap.get(id)
      if (index === undefined) return
      meshTarget.setColorAt(index, resolveItemColor(item, mode, false))
      if (meshTarget.instanceColor) meshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'icon' && iconMeshTarget) {
      const index = idToIndexMap.get(id)
      if (index === undefined) return
      iconMeshTarget.setColorAt(index, resolveItemColor(item, mode, false))
      if (iconMeshTarget.instanceColor) iconMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      const index = idToIndexMap.get(id)
      if (index === undefined) return
      simpleBoxMeshTarget.setColorAt(index, resolveItemColor(item, mode, false))
      if (simpleBoxMeshTarget.instanceColor) simpleBoxMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'model' && modelMeshMap && modelInternalIdToMeshInfo) {
      // Model 模式：通过 internalId 找到对应的 mesh 和 localIndex
      const meshInfo = modelInternalIdToMeshInfo.get(id)
      if (!meshInfo) return

      const isFallbackBox = meshInfo.meshKey === MODEL_FALLBACK_MESH_KEY
      const mesh = isFallbackBox ? modelFallbackMesh : modelMeshMap.get(meshInfo.meshKey)
      if (!mesh) return

      mesh.setColorAt(meshInfo.localIndex, resolveItemColor(item, mode, isFallbackBox))
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
    modelMeshMap?: Map<string, InstancedMesh>,
    modelInternalIdToMeshInfo?: Map<string, { meshKey: string; localIndex: number }>,
    modelFallbackMesh?: InstancedMesh | null
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
        modelInternalIdToMeshInfo,
        modelFallbackMesh
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
        modelInternalIdToMeshInfo,
        modelFallbackMesh
      )
    }
  }

  function setSidebarHoveredItemIds(ids: Set<string> | null) {
    if (!ids || ids.size === 0) {
      sidebarHoveredItemIds.value = null
      return
    }
    sidebarHoveredItemIds.value = new Set(ids)
  }

  return {
    hoveredItemId,
    sidebarHoveredItemIds,
    suppressedHoverId,
    getItemColor,
    updateInstancesColor,
    updateInstanceColorById,
    setHoveredItemId,
    setSidebarHoveredItemIds,
  }
}

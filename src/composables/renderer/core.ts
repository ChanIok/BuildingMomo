import { ref, watch, onUnmounted, computed, type Ref } from 'vue'
import type { Matrix4, Raycaster, InstancedMesh } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useBoxMode } from './modes/useBoxMode'
import { useIconMode } from './modes/useIconMode'
import { useSimpleBoxMode } from './modes/useSimpleBoxMode'
import { useModelMode } from './modes/useModelMode'
import { useInstanceColor } from './shared/useInstanceColor'
import { useInstanceMatrix } from './shared/useInstanceMatrix'
import { useSelectionOutline } from './shared/useSelectionOutline'
import type { PickingConfig } from './types'

/**
 * Three.js 实例化渲染器
 *
 * 协调四种渲染模式：box, icon, simple-box, model
 * 管理全局索引映射、颜色状态、矩阵更新和生命周期
 *
 * @param isTransformDragging - 可选，指示是否正在拖拽 Transform Gizmo
 */
export function useThreeInstancedRenderer(isTransformDragging?: Ref<boolean>) {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()
  const settingsStore = useSettingsStore()

  // 初始化各模式 composables
  const boxMode = useBoxMode()
  const iconMode = useIconMode()
  const simpleBoxMode = useSimpleBoxMode()
  const modelMode = useModelMode()

  // 初始化颜色管理器
  const colorManager = useInstanceColor()

  // 初始化矩阵更新器
  const matrixUpdater = useInstanceMatrix()

  // 初始化 Model 模式描边管理器（屏幕空间）
  const selectionOutline = useSelectionOutline()

  // 全局索引映射（用于 box/icon/simple-box 模式）
  const indexToIdMap = ref(new Map<number, string>())
  const idToIndexMap = ref(new Map<string, number>())

  /**
   * 主重建函数（路由到对应模式）
   */
  async function rebuildInstances() {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = boxMode.mesh.value
    const iconMeshTarget = iconMode.mesh.value
    const simpleBoxMeshTarget = simpleBoxMode.mesh.value

    // 隐藏其他模式的 mesh
    if (mode !== 'box' && meshTarget) {
      meshTarget.count = 0
    }
    if (mode !== 'icon' && iconMeshTarget) {
      iconMeshTarget.count = 0
    }
    if (mode !== 'simple-box' && simpleBoxMeshTarget) {
      simpleBoxMeshTarget.count = 0
    }
    if (mode !== 'model') {
      for (const [, mesh] of modelMode.meshMap.value.entries()) {
        mesh.count = 0
      }
    }

    // 执行对应模式的重建
    switch (mode) {
      case 'box':
        await boxMode.rebuild()
        break
      case 'icon':
        await iconMode.rebuild()
        break
      case 'simple-box':
        await simpleBoxMode.rebuild()
        break
      case 'model':
        console.log('[ThreeInstancedRenderer] Starting model mode rebuild')
        await modelMode.rebuild()

        // 初始化 mask mesh（为每个模型类型创建对应的 mask mesh）
        for (const [itemId, mesh] of modelMode.meshMap.value.entries()) {
          selectionOutline.initMaskMesh(itemId, mesh, 10000) // MAX_RENDER_INSTANCES
        }

        // 为 fallbackMesh 创建 mask mesh
        const fallbackMesh = modelMode.fallbackMesh.value
        if (fallbackMesh && fallbackMesh.count > 0) {
          console.log(
            `[ThreeInstancedRenderer] Creating mask mesh for fallbackMesh, count=${fallbackMesh.count}`
          )
          selectionOutline.initMaskMesh(-1, fallbackMesh, 10000)
        }

        // 更新 mask 状态
        const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
        selectionOutline.updateMasks(
          selectedItemIds,
          colorManager.hoveredItemId.value,
          modelMode.meshMap.value,
          modelMode.internalIdToMeshInfo.value,
          fallbackMesh
        )

        // Model 模式使用独立的索引映射，直接返回不更新全局映射
        colorManager.updateInstancesColor(
          mode,
          meshTarget,
          iconMeshTarget,
          simpleBoxMeshTarget,
          modelMode.indexToIdMap.value
        )
        return
    }

    // 非 Model 模式：构建全局索引映射
    const items = editorStore.activeScheme?.items.value ?? []
    const map = new Map<number, string>()
    const instanceCount = Math.min(items.length, 10000) // MAX_INSTANCES

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) continue
      map.set(index, item.internalId)
    }

    indexToIdMap.value = map
    const reverseMap = new Map<string, number>()
    for (const [index, id] of map.entries()) {
      reverseMap.set(id, index)
    }
    idToIndexMap.value = reverseMap

    // 更新颜色
    colorManager.updateInstancesColor(mode, meshTarget, iconMeshTarget, simpleBoxMeshTarget, map)
  }

  /**
   * 更新选中实例的矩阵（Gizmo 拖拽时调用）
   */
  function updateSelectedInstancesMatrix(idToWorldMatrixMap: Map<string, Matrix4>) {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = boxMode.mesh.value
    const iconMeshTarget = iconMode.mesh.value
    const simpleBoxMeshTarget = simpleBoxMode.mesh.value

    // Model 模式使用独立的索引映射
    const currentIdToIndexMap = mode === 'model' ? modelMode.idToIndexMap.value : idToIndexMap.value

    matrixUpdater.updateSelectedInstancesMatrix(
      idToWorldMatrixMap,
      mode,
      meshTarget,
      iconMeshTarget,
      simpleBoxMeshTarget,
      currentIdToIndexMap,
      iconMode.currentIconNormal.value,
      iconMode.currentIconUp.value
    )

    // Model 模式：同步更新 mask
    if (mode === 'model') {
      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
      selectionOutline.updateMasks(
        selectedItemIds,
        colorManager.hoveredItemId.value,
        modelMode.meshMap.value,
        modelMode.internalIdToMeshInfo.value,
        modelMode.fallbackMesh.value
      )
    }
  }

  /**
   * 设置 hover 物品 ID（用于高亮显示）
   */
  function setHoveredItemId(id: string | null) {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = boxMode.mesh.value
    const iconMeshTarget = iconMode.mesh.value
    const simpleBoxMeshTarget = simpleBoxMode.mesh.value

    // Model 模式使用独立的索引映射
    const currentIdToIndexMap = mode === 'model' ? modelMode.idToIndexMap.value : idToIndexMap.value

    if (mode === 'model') {
      // Model 模式：更新 colorManager 的内部状态（用于抑制逻辑）
      colorManager.hoveredItemId.value = id

      // 更新 mask
      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
      selectionOutline.updateMasks(
        selectedItemIds,
        id,
        modelMode.meshMap.value,
        modelMode.internalIdToMeshInfo.value,
        modelMode.fallbackMesh.value
      )
    } else {
      // 原有逻辑（Box/Icon/SimpleBox 模式）
      colorManager.setHoveredItemId(
        id,
        mode,
        meshTarget,
        iconMeshTarget,
        simpleBoxMeshTarget,
        currentIdToIndexMap
      )
    }
  }

  /**
   * 更新图标朝向（仅 Icon 模式）
   */
  function updateIconFacing(normal: [number, number, number], up?: [number, number, number]) {
    iconMode.updateFacing(normal, up)
  }

  /**
   * 获取当前模式的拾取配置（统一拾取接口）
   */
  const pickingConfig = computed<PickingConfig>(() => {
    const mode = settingsStore.settings.threeDisplayMode

    return {
      performRaycast: (raycaster: Raycaster) => {
        if (mode === 'model') {
          // Model 模式：遍历所有 mesh，返回最近的交点
          let closestHit: { instanceId: number; internalId: string; distance: number } | null = null

          // 辅助函数：检测单个 mesh 的射线交点
          function testMesh(mesh: InstancedMesh) {
            if (!mesh || mesh.count === 0) return

            const intersects = raycaster.intersectObject(mesh, false)
            const hit = intersects[0]

            if (hit && hit.instanceId !== undefined) {
              // ✨ 关键改动：使用局部索引映射
              // hit.instanceId 是 mesh 内的局部索引（0, 1, 2...）
              const localIndexMap = modelMode.meshToLocalIndexMap.value.get(mesh)
              if (!localIndexMap) return

              const internalId = localIndexMap.get(hit.instanceId)

              if (internalId && (!closestHit || hit.distance < closestHit.distance)) {
                closestHit = {
                  instanceId: hit.instanceId,
                  internalId,
                  distance: hit.distance,
                }
              }
            }
          }

          // 遍历所有模型 mesh
          for (const [, mesh] of modelMode.meshMap.value.entries()) {
            testMesh(mesh)
          }

          // 处理回退 mesh（如果有）
          const fallbackMesh = modelMode.fallbackMesh.value
          if (fallbackMesh) {
            testMesh(fallbackMesh)
          }

          return closestHit
        } else {
          // Box/Icon/SimpleBox 模式：单 mesh 检测
          let targetMesh: InstancedMesh | null = null

          if (mode === 'icon') targetMesh = iconMode.mesh.value
          else if (mode === 'simple-box') targetMesh = simpleBoxMode.mesh.value
          else targetMesh = boxMode.mesh.value

          if (!targetMesh || targetMesh.count === 0) return null

          const intersects = raycaster.intersectObject(targetMesh, false)
          const hit = intersects[0]

          if (hit && hit.instanceId !== undefined) {
            const internalId = indexToIdMap.value.get(hit.instanceId)
            if (internalId) {
              return {
                instanceId: hit.instanceId,
                internalId,
                distance: hit.distance,
              }
            }
          }

          return null
        }
      },

      // 动态返回当前模式的索引映射
      indexToIdMap: computed(() => {
        const currentMode = settingsStore.settings.threeDisplayMode
        return currentMode === 'model' ? modelMode.indexToIdMap.value : indexToIdMap.value
      }),
    }
  })

  // Watchers
  watch(
    [
      () => editorStore.activeScheme?.items.value, // 监听引用变化（切换方案时）
      () => editorStore.sceneVersion, // 监听版本号（内容修改时）
      () => gameDataStore.isInitialized, // 监听游戏数据加载状态（延迟加载支持）
    ],
    () => {
      // 拖拽时不触发全量更新，由 handleGizmoChange 直接更新实例矩阵
      if (isTransformDragging?.value) {
        return
      }
      rebuildInstances()
    },
    { deep: false, immediate: true }
  )

  // 监听显示模式变化，立即重建实例
  watch(
    () => settingsStore.settings.threeDisplayMode,
    () => {
      rebuildInstances()
    }
  )

  // 监听选中状态变化，刷新颜色
  watch(
    [
      () => editorStore.activeScheme?.selectedItemIds.value, // 监听 Set 引用变化（切换方案时）
      () => editorStore.selectionVersion, // 监听版本号（选择变化时）
    ],
    () => {
      if (isTransformDragging?.value) {
        return
      }

      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()

      // 1. 处理刚刚被选中的情况：抑制 Hover，使其显示选中色
      if (
        colorManager.hoveredItemId.value &&
        selectedItemIds.has(colorManager.hoveredItemId.value)
      ) {
        colorManager.suppressedHoverId.value = colorManager.hoveredItemId.value
        colorManager.hoveredItemId.value = null
      }

      // 2. 处理被抑制的物品不再被选中的情况：解除抑制
      if (
        colorManager.suppressedHoverId.value &&
        !selectedItemIds.has(colorManager.suppressedHoverId.value)
      ) {
        colorManager.suppressedHoverId.value = null
      }

      const mode = settingsStore.settings.threeDisplayMode
      const meshTarget = boxMode.mesh.value
      const iconMeshTarget = iconMode.mesh.value
      const simpleBoxMeshTarget = simpleBoxMode.mesh.value

      // Model 模式使用独立的索引映射
      const currentIndexToIdMap =
        mode === 'model' ? modelMode.indexToIdMap.value : indexToIdMap.value

      if (mode === 'model') {
        // Model 模式：更新 mask
        selectionOutline.updateMasks(
          selectedItemIds,
          colorManager.hoveredItemId.value,
          modelMode.meshMap.value,
          modelMode.internalIdToMeshInfo.value,
          modelMode.fallbackMesh.value
        )
      }

      colorManager.updateInstancesColor(
        mode,
        meshTarget,
        iconMeshTarget,
        simpleBoxMeshTarget,
        currentIndexToIdMap
      )
    }
  )

  // 资源清理
  onUnmounted(() => {
    console.log('[ThreeInstancedRenderer] Disposing resources')
    boxMode.dispose()
    iconMode.dispose()
    simpleBoxMode.dispose()
    modelMode.dispose()
    selectionOutline.dispose()
  })

  // 返回统一接口
  return {
    instancedMesh: boxMode.mesh,
    iconInstancedMesh: iconMode.mesh,
    simpleBoxInstancedMesh: simpleBoxMode.mesh,
    modelMeshMap: modelMode.meshMap,
    indexToIdMap,
    idToIndexMap,
    /**
     * Model 模式的索引映射（跨所有模型 mesh 的全局索引）
     *
     * 注意：当前拾取逻辑尚未完全支持 Model 模式的多 mesh 遍历
     * 此映射预留用于未来实现完整的 Model 拾取和选择功能
     */
    modelIndexToIdMap: modelMode.indexToIdMap,
    modelIdToIndexMap: modelMode.idToIndexMap,
    updateSelectedInstancesMatrix,
    setHoveredItemId,
    updateIconFacing,
    pickingConfig, // ✨ 新增：统一拾取配置
    renderSelectionOutlineMaskPass: selectionOutline.renderMaskPass,
    renderSelectionOutlineOverlay: selectionOutline.renderOverlay,
    syncOutlineSceneTransform: selectionOutline.syncSceneTransform,
  }
}

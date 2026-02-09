import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WorkingCoordinateSystem } from '../types/editor'
import type { ViewPreset } from '../composables/useThreeCamera'
import {
  convertPositionWorkingToGlobal,
  convertPositionGlobalToWorking,
} from '../lib/coordinateTransform'
import { matrixTransform } from '../lib/matrixTransform'

// 位置类型定义
interface Position {
  x: number
  y: number
  z: number
}
import { useSettingsStore } from './settingsStore'

/**
 * UI状态管理Store
 * 专门管理界面相关的状态，与业务逻辑分离
 */
export const useUIStore = defineStore('ui', () => {
  const settingsStore = useSettingsStore()

  // 视图模式状态
  const viewMode = ref<'2d' | '3d'>('3d')

  // 当前视图预设（透视、顶、前...）
  const currentViewPreset = ref<ViewPreset>('perspective')

  // 侧边栏视图状态
  const sidebarView = ref<'structure' | 'transform' | 'editorSettings'>('structure')
  // 结构面板 hover 的物品类型（gameId），用于联动画布高亮
  const sidebarHoveredGameId = ref<number | null>(null)

  // Three.js 容器的布局信息（用于性能优化，避免频繁调用 getBoundingClientRect）
  const editorContainerRect = ref<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  })

  // 工作坐标系状态
  const workingCoordinateSystem = ref<WorkingCoordinateSystem>({
    enabled: false,
    rotation: {
      x: 0,
      y: 0,
      z: 0,
    },
  })

  // Gizmo 空间模式：代理到 settingsStore，自动持久化
  const gizmoSpace = computed({
    get: () => settingsStore.settings.gizmoSpace,
    set: (value) => {
      settingsStore.settings.gizmoSpace = value
    },
  })

  // 定点旋转状态（临时状态，不持久化）
  const customPivotEnabled = ref(false)
  const customPivotPosition = ref<{ x: number; y: number; z: number } | null>(null)

  // 组合原点选择模式（临时状态，不持久化）
  const isSelectingGroupOrigin = ref(false)
  const selectingForGroupId = ref<number | null>(null)

  // 定点旋转物品选择模式（临时状态，不持久化）
  const isSelectingPivotItem = ref(false)
  const selectedPivotPosition = ref<{ x: number; y: number; z: number } | null>(null)

  // 对齐到参照物模式（临时状态，不持久化）
  const isSelectingAlignReference = ref(false)
  const alignReferenceItemId = ref<string | null>(null)
  const alignReferencePosition = ref<'min' | 'center' | 'max'>('max')

  // ========== 视图模式管理 ==========

  function toggleViewMode() {
    viewMode.value = viewMode.value === '2d' ? '3d' : '2d'
    console.log('[UIStore] View mode switched to:', viewMode.value)
  }

  function setViewMode(mode: '2d' | '3d') {
    viewMode.value = mode
    console.log('[UIStore] View mode set to:', viewMode.value)
  }

  function setCurrentViewPreset(preset: ViewPreset) {
    currentViewPreset.value = preset
    // console.log('[UIStore] Current view preset set to:', preset)
  }

  function updateEditorContainerRect(rect: {
    left: number
    top: number
    width: number
    height: number
  }) {
    editorContainerRect.value = rect
  }

  // ========== 工作坐标系管理 ==========

  function setWorkingCoordinateSystem(
    enabled: boolean,
    rotation: { x: number; y: number; z: number }
  ) {
    // 四舍五入到2位小数，避免浮点数精度问题（作为最终防线）
    const roundedX = Math.round(rotation.x * 100) / 100
    const roundedY = Math.round(rotation.y * 100) / 100
    const roundedZ = Math.round(rotation.z * 100) / 100

    workingCoordinateSystem.value.enabled = enabled
    workingCoordinateSystem.value.rotation.x = roundedX
    workingCoordinateSystem.value.rotation.y = roundedY
    workingCoordinateSystem.value.rotation.z = roundedZ
    console.log('[UIStore] Working coordinate system updated:', {
      enabled,
      rotation: { x: roundedX, y: roundedY, z: roundedZ },
    })
  }

  /**
   * 位置转换：工作坐标系 -> 世界空间
   *
   * @param workingPoint 工作坐标系下的点（世界空间语义，Y 向上为正）
   * @returns 世界空间下的点
   */
  function workingToWorld(workingPoint: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    if (!workingCoordinateSystem.value.enabled) {
      return workingPoint
    }

    return convertPositionWorkingToGlobal(workingPoint, workingCoordinateSystem.value.rotation)
  }

  /**
   * 位置转换：世界空间 -> 工作坐标系
   *
   * @param worldPoint 世界空间下的点
   * @returns 工作坐标系下的点（世界空间语义，Y 向上为正）
   */
  function worldToWorking(worldPoint: Position): Position {
    if (!workingCoordinateSystem.value.enabled) {
      return worldPoint
    }

    return convertPositionGlobalToWorking(worldPoint, workingCoordinateSystem.value.rotation)
  }

  // ========== 数据空间 <-> 工作坐标系 便捷 API ==========

  /**
   * 位置转换：数据空间 -> 工作坐标系（用于 UI 显示）
   *
   * 组合了：数据空间 -> 世界空间（Y 翻转）-> 工作坐标系
   *
   * @param dataPos 数据空间下的点（游戏存档坐标）
   * @returns 工作坐标系下的点（用于 UI 显示）
   */
  function dataToWorking(dataPos: Position): Position {
    if (!workingCoordinateSystem.value.enabled) {
      return dataPos
    }
    const worldPos = matrixTransform.dataPositionToWorld(dataPos)
    const workingPos = convertPositionGlobalToWorking(
      worldPos,
      workingCoordinateSystem.value.rotation
    )
    // 工作坐标系输出是世界空间语义，转回数据空间语义用于 UI 显示
    return matrixTransform.worldPositionToData(workingPos)
  }

  /**
   * 位置转换：工作坐标系 -> 数据空间（用于 UI 输入写回）
   *
   * 组合了：工作坐标系 -> 世界空间 -> 数据空间（Y 翻转）
   *
   * @param workingPos 工作坐标系下的点（来自 UI 输入）
   * @returns 数据空间下的点（用于存储）
   */
  function workingToData(workingPos: Position): Position {
    if (!workingCoordinateSystem.value.enabled) {
      return workingPos
    }
    // UI 输入是数据空间语义，先转为世界空间语义
    const worldSemanticInput = matrixTransform.dataPositionToWorld(workingPos)
    const worldPos = convertPositionWorkingToGlobal(
      worldSemanticInput,
      workingCoordinateSystem.value.rotation
    )
    return matrixTransform.worldPositionToData(worldPos)
  }

  /**
   * 位置增量转换：工作坐标系增量 -> 数据空间增量
   *
   * 用于将 UI 输入的相对位移转换为数据空间的位移
   * 注意：增量转换不需要考虑原点，只需要旋转
   *
   * @param workingDelta 工作坐标系下的位移增量
   * @returns 数据空间下的位移增量
   */
  function workingDeltaToData(workingDelta: Position): Position {
    if (!workingCoordinateSystem.value.enabled) {
      return workingDelta
    }
    // 增量转换：先将 UI 输入（数据空间语义）转为世界空间语义
    const worldSemanticDelta = matrixTransform.dataPositionToWorld(workingDelta)
    // 应用工作坐标系旋转
    const worldDelta = convertPositionWorkingToGlobal(
      worldSemanticDelta,
      workingCoordinateSystem.value.rotation
    )
    // 转回数据空间
    return matrixTransform.worldPositionToData(worldDelta)
  }

  // ========== 侧边栏管理 ==========

  function setSidebarView(view: 'structure' | 'transform' | 'editorSettings') {
    sidebarView.value = view
    console.log('[UIStore] Sidebar view set to:', view)
  }

  function setSidebarHoveredGameId(gameId: number | null) {
    sidebarHoveredGameId.value = gameId
  }

  // ========== 定点旋转管理 ==========

  function setCustomPivotEnabled(enabled: boolean) {
    customPivotEnabled.value = enabled
    if (!enabled) {
      customPivotPosition.value = null
    }
  }

  function setCustomPivotPosition(position: { x: number; y: number; z: number } | null) {
    customPivotPosition.value = position
  }

  // ========== 组合原点选择管理 ==========

  function setSelectingGroupOrigin(selecting: boolean, groupId?: number) {
    isSelectingGroupOrigin.value = selecting
    selectingForGroupId.value = selecting && groupId !== undefined ? groupId : null
  }

  // ========== 定点旋转物品选择管理 ==========

  function setSelectingPivotItem(selecting: boolean) {
    isSelectingPivotItem.value = selecting
    if (!selecting) {
      // 退出选择模式时不清空结果，等待外部消费后再清空
    }
  }

  function setSelectedPivotPosition(position: { x: number; y: number; z: number } | null) {
    selectedPivotPosition.value = position
  }

  // ========== 对齐到参照物管理 ==========

  function setSelectingAlignReference(selecting: boolean) {
    isSelectingAlignReference.value = selecting
    if (!selecting) {
      // 退出选择模式时不清空参照物，保持用户已选的参照物
    }
  }

  function setAlignReferenceItem(itemId: string | null) {
    alignReferenceItemId.value = itemId
  }

  function setAlignReferencePosition(position: 'min' | 'center' | 'max') {
    alignReferencePosition.value = position
  }

  // ========== 坐标系统一管理 ==========

  /**
   * 获取当前有效的坐标系旋转
   *
   * 优先级（与 Gizmo 一致）：
   * 1. Local 模式 + 单选 → 使用物品自身旋转
   * 2. Local 模式 + 多选 → 回退到 Working（如启用）或 World
   * 3. World 模式 → 使用 Working（如启用）或 World
   *
   * @param selectedIds 当前选中的物品 ID 集合
   * @param itemsMap 物品映射表（用于查找单选物品）
   * @returns 有效的坐标系旋转，或 null（表示全局坐标系）
   */
  function getEffectiveCoordinateRotation(
    selectedIds: Set<string>,
    itemsMap: Map<string, any>
  ): { x: number; y: number; z: number } | null {
    // 1. Local 模式
    if (gizmoSpace.value === 'local') {
      // 单选：使用物品自身旋转
      if (selectedIds.size === 1) {
        const itemId = Array.from(selectedIds)[0]
        const item = itemId ? itemsMap.get(itemId) : null
        if (item) {
          return matrixTransform.dataRotationToVisual({
            x: item.rotation.x,
            y: item.rotation.y,
            z: item.rotation.z,
          })
        }
      }

      // 多选：回退到 Working（如启用）
      if (workingCoordinateSystem.value.enabled) {
        return workingCoordinateSystem.value.rotation
      }

      // 否则回退到 World
      return null
    }

    // 2. World 模式
    if (workingCoordinateSystem.value.enabled) {
      return workingCoordinateSystem.value.rotation
    }

    return null
  }

  return {
    // 状态
    viewMode,
    workingCoordinateSystem,
    gizmoSpace,
    sidebarView,
    sidebarHoveredGameId,
    customPivotEnabled,
    customPivotPosition,
    isSelectingGroupOrigin,
    selectingForGroupId,
    isSelectingPivotItem,
    selectedPivotPosition,
    isSelectingAlignReference,
    alignReferenceItemId,
    alignReferencePosition,

    // 视图模式
    toggleViewMode,
    setViewMode,
    currentViewPreset,
    setCurrentViewPreset,
    editorContainerRect,
    updateEditorContainerRect,

    // 侧边栏
    setSidebarView,
    setSidebarHoveredGameId,

    // 工作坐标系
    setWorkingCoordinateSystem,
    workingToWorld,
    worldToWorking,
    getEffectiveCoordinateRotation,

    // 数据空间 <-> 工作坐标系（推荐用于 UI）
    dataToWorking,
    workingToData,
    workingDeltaToData,

    // 定点旋转
    setCustomPivotEnabled,
    setCustomPivotPosition,

    // 组合原点选择
    setSelectingGroupOrigin,

    // 定点旋转物品选择
    setSelectingPivotItem,
    setSelectedPivotPosition,

    // 对齐到参照物
    setSelectingAlignReference,
    setAlignReferenceItem,
    setAlignReferencePosition,
  }
})

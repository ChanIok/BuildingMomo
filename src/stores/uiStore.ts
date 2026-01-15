import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { WorkingCoordinateSystem } from '../types/editor'
import type { ViewPreset } from '../composables/useThreeCamera'
import {
  convertPositionWorkingToGlobal,
  convertPositionGlobalToWorking,
  convertRotationWorkingToGlobal,
  convertRotationGlobalToWorking,
} from '../lib/coordinateTransform'

/**
 * UI状态管理Store
 * 专门管理界面相关的状态，与业务逻辑分离
 */
export const useUIStore = defineStore('ui', () => {
  // 视图模式状态
  const viewMode = ref<'2d' | '3d'>('3d')

  // 当前视图预设（透视、顶、前...）
  const currentViewPreset = ref<ViewPreset>('perspective')

  // 侧边栏视图状态
  const sidebarView = ref<'structure' | 'transform' | 'editorSettings'>('structure')

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

  // Gizmo 空间模式：world（全局坐标系）或 local（物体自身坐标系）
  const gizmoSpace = ref<'world' | 'local'>('world')

  // 定点旋转状态（临时状态，不持久化）
  const customPivotEnabled = ref(false)
  const customPivotPosition = ref<{ x: number; y: number; z: number } | null>(null)

  // 参照物选择模式（临时状态，不持久化）
  const isSelectingAlignmentPivot = ref(false)
  const alignmentPivotId = ref<string | null>(null)

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

  // 工作坐标系坐标转换：工作坐标系 -> 全局坐标系
  function workingToGlobal(point: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    if (!workingCoordinateSystem.value.enabled) {
      return point
    }

    return convertPositionWorkingToGlobal(point, workingCoordinateSystem.value.rotation)
  }

  // 工作坐标系坐标转换：全局坐标系 -> 工作坐标系
  function globalToWorking(point: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    if (!workingCoordinateSystem.value.enabled) {
      return point
    }

    return convertPositionGlobalToWorking(point, workingCoordinateSystem.value.rotation)
  }

  // ========== 旋转转换（四元数版本，精确处理三轴旋转） ==========

  /**
   * 工作坐标系旋转转换：工作坐标系 -> 全局坐标系
   *
   * 使用四元数确保旋转组合的正确性，避免欧拉角的万向锁问题
   *
   * @param workingRotation 工作坐标系中的相对旋转（度）
   * @returns 全局坐标系中的绝对旋转（度）
   */
  function rotationWorkingToGlobal(workingRotation: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    if (!workingCoordinateSystem.value.enabled) {
      return workingRotation
    }

    return convertRotationWorkingToGlobal(workingRotation, workingCoordinateSystem.value.rotation)
  }

  /**
   * 工作坐标系旋转转换：全局坐标系 -> 工作坐标系
   *
   * 使用四元数确保旋转分解的正确性，避免欧拉角的万向锁问题
   *
   * @param globalRotation 全局坐标系中的绝对旋转（度）
   * @returns 工作坐标系中的相对旋转（度）
   */
  function rotationGlobalToWorking(globalRotation: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    if (!workingCoordinateSystem.value.enabled) {
      return globalRotation
    }

    return convertRotationGlobalToWorking(globalRotation, workingCoordinateSystem.value.rotation)
  }

  // ========== 侧边栏管理 ==========

  function setSidebarView(view: 'structure' | 'transform' | 'editorSettings') {
    sidebarView.value = view
    console.log('[UIStore] Sidebar view set to:', view)
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

  // ========== 参照物选择管理 ==========

  function setSelectingAlignmentPivot(selecting: boolean) {
    isSelectingAlignmentPivot.value = selecting
  }

  function setAlignmentPivotId(id: string | null) {
    alignmentPivotId.value = id
  }

  function clearAlignmentPivot() {
    alignmentPivotId.value = null
  }

  // 监听方案切换，自动清除参照物
  // 注意：这里使用延迟导入避免循环依赖
  import('./editorStore').then(({ useEditorStore }) => {
    const editorStore = useEditorStore()
    watch(
      () => editorStore.activeSchemeId,
      () => {
        alignmentPivotId.value = null
      }
    )
  })

  return {
    // 状态
    viewMode,
    workingCoordinateSystem,
    gizmoSpace,
    sidebarView,
    customPivotEnabled,
    customPivotPosition,
    isSelectingAlignmentPivot,
    alignmentPivotId,

    // 视图模式
    toggleViewMode,
    setViewMode,
    currentViewPreset,
    setCurrentViewPreset,
    editorContainerRect,
    updateEditorContainerRect,

    // 侧边栏
    setSidebarView,

    // 工作坐标系
    setWorkingCoordinateSystem,
    workingToGlobal,
    globalToWorking,
    rotationWorkingToGlobal,
    rotationGlobalToWorking,

    // 定点旋转
    setCustomPivotEnabled,
    setCustomPivotPosition,

    // 参照物选择
    setSelectingAlignmentPivot,
    setAlignmentPivotId,
    clearAlignmentPivot,
  }
})

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkingCoordinateSystem } from '../types/editor'
import type { ViewPreset } from '../composables/useThreeCamera'

/**
 * UI状态管理Store
 * 专门管理界面相关的状态，与业务逻辑分离
 */
export const useUIStore = defineStore('ui', () => {
  // 视图模式状态
  const viewMode = ref<'2d' | '3d'>('3d')

  // 当前视图预设（透视、顶、前...）
  const currentViewPreset = ref<ViewPreset>('perspective')

  // 工作坐标系状态
  const workingCoordinateSystem = ref<WorkingCoordinateSystem>({
    enabled: false,
    rotationAngle: 0,
  })

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

  // ========== 工作坐标系管理 ==========

  function setWorkingCoordinateSystem(enabled: boolean, angle: number) {
    workingCoordinateSystem.value.enabled = enabled
    workingCoordinateSystem.value.rotationAngle = angle
    console.log('[UIStore] Working coordinate system updated:', {
      enabled,
      angle,
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

    const angleRad = (workingCoordinateSystem.value.rotationAngle * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
      z: point.z,
    }
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

    const angleRad = (-workingCoordinateSystem.value.rotationAngle * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
      z: point.z,
    }
  }

  return {
    // 状态
    viewMode,
    workingCoordinateSystem,

    // 视图模式
    toggleViewMode,
    setViewMode,
    currentViewPreset,
    setCurrentViewPreset,

    // 工作坐标系
    setWorkingCoordinateSystem,
    workingToGlobal,
    globalToWorking,
  }
})

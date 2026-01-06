import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

import type { Locale } from '../composables/useI18n'

// 应用设置接口
export interface AppSettings {
  // 显示设置
  theme: 'light' | 'dark' | 'auto'
  showFurnitureTooltip: boolean
  showBackground: boolean

  // 数据设置
  autoUpdateFurniture: boolean

  // 编辑辅助
  enableDuplicateDetection: boolean
  enableLimitDetection: boolean
  enableAutoSave: boolean

  // 3D 视图设置
  threeDisplayMode: 'box' | 'icon' | 'simple-box' | 'model' // 3D 显示模式：立方体、图标、简化方块或模型
  threeSymbolScale: number // 图标/方块缩放比例 (1.0 = 100%)

  // 相机设置
  cameraFov: number // 透视相机视场角 (30-90)
  cameraBaseSpeed: number // WASD 移动基础速度
  cameraShiftMultiplier: number // Shift 加速倍率
  cameraMouseSensitivity: number // 鼠标视角灵敏度
  cameraZoomSpeed: number // 鼠标滚轮缩放速度
  perspectiveControlMode: 'orbit' | 'flight' // 透视视图下的控制模式偏好

  // 语言设置
  language: Locale
}

// 默认设置
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  showFurnitureTooltip: true,
  showBackground: true,
  autoUpdateFurniture: true,
  enableDuplicateDetection: true,
  enableLimitDetection: true,
  enableAutoSave: true,
  threeDisplayMode: 'simple-box',
  threeSymbolScale: 1.0,
  cameraFov: 50,
  cameraBaseSpeed: 1000,
  cameraShiftMultiplier: 4,
  cameraMouseSensitivity: 0.002,
  cameraZoomSpeed: 2.5,
  perspectiveControlMode: 'orbit',
  language: 'zh',
}

const STORAGE_KEY = 'buildingmomo_settings'

export const useSettingsStore = defineStore('settings', () => {
  // 使用 VueUse 的 useLocalStorage，自动持久化
  const settings = useLocalStorage<AppSettings>(STORAGE_KEY, DEFAULT_SETTINGS, {
    mergeDefaults: true, // 自动合并默认值
  })

  // 重置为默认设置
  function resetSettings(): void {
    settings.value = { ...DEFAULT_SETTINGS }
    console.log('[SettingsStore] Settings reset to default')
  }

  return {
    settings,
    resetSettings,
  }
})

import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

import type { Locale } from '../composables/useI18n'

// 应用设置接口
export interface AppSettings {
  // 显示设置
  showFurnitureTooltip: boolean
  showBackground: boolean

  // 数据设置
  autoUpdateFurniture: boolean

  // 编辑辅助
  enableDuplicateDetection: boolean
  enableLimitDetection: boolean
  enableAutoSave: boolean
  showGizmo: boolean

  // 3D 视图设置
  threeDisplayMode: 'box' | 'icon' | 'simple-box' // 3D 显示模式：立方体、图标或简化方块
  threeSymbolScale: number // 图标/方块缩放比例 (1.0 = 100%)

  // 语言设置
  language: Locale
}

// 默认设置
const DEFAULT_SETTINGS: AppSettings = {
  showFurnitureTooltip: true,
  showBackground: true,
  autoUpdateFurniture: true,
  enableDuplicateDetection: true,
  enableLimitDetection: true,
  enableAutoSave: true,
  showGizmo: true,
  threeDisplayMode: 'simple-box',
  threeSymbolScale: 1.0,
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

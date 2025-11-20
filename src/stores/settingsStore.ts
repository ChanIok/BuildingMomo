import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

// 应用设置接口
export interface AppSettings {
  // 显示设置
  showFurnitureTooltip: boolean
  showBackground: boolean

  // 数据设置
  autoUpdateFurniture: boolean

  // 编辑辅助
  enableDuplicateDetection: boolean

  // 3D 视图设置
  threeDisplayMode: 'box' | 'icon' // 3D 显示模式：立方体或图标
  threeIconModeInOrthographic: boolean // 正交视图下自动使用图标模式
  threeIconScale: number // 图标缩放比例 (1.0 = 100%)
}

// 默认设置
const DEFAULT_SETTINGS: AppSettings = {
  showFurnitureTooltip: true,
  showBackground: true,
  autoUpdateFurniture: true,
  enableDuplicateDetection: true,
  threeDisplayMode: 'box',
  threeIconModeInOrthographic: true,
  threeIconScale: 1.0,
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

  // 初始化（现在只需要打印日志）
  function initialize(): void {
    console.log('[SettingsStore] Settings initialized:', settings.value)
  }

  return {
    settings,
    initialize,
    resetSettings,
  }
})

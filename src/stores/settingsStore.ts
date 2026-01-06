import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'

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

  // 变换步进设置
  translationSnap: number // 平移步进值（0 表示禁用）
  rotationSnap: number // 旋转步进值，单位：弧度（0 表示禁用）

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
  translationSnap: 0,
  rotationSnap: 0,
  language: 'zh',
}

const STORAGE_KEY = 'buildingmomo_settings'
const PASSWORD_STORAGE_KEY = 'momo_lab_password'

export const useSettingsStore = defineStore('settings', () => {
  // 使用 VueUse 的 useLocalStorage，自动持久化
  const settings = useLocalStorage<AppSettings>(STORAGE_KEY, DEFAULT_SETTINGS, {
    mergeDefaults: true, // 自动合并默认值
  })

  // 认证状态
  const isAuthenticated = ref<boolean>(false)
  const isVerifying = ref<boolean>(false)

  // 重置为默认设置
  function resetSettings(): void {
    settings.value = { ...DEFAULT_SETTINGS }
    console.log('[SettingsStore] Settings reset to default')
  }

  /**
   * 验证密码
   * @param password 访问密码
   * @param persistPassword 是否持久化到本地设备（默认 true）
   * @returns 验证是否成功
   */
  async function verifyPassword(
    password: string,
    persistPassword: boolean = true
  ): Promise<boolean> {
    isVerifying.value = true

    // 开发环境 + Secure 模式：跳过 API 验证
    if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_SECURE_MODE === 'true') {
      isAuthenticated.value = true
      if (persistPassword) {
        localStorage.setItem(PASSWORD_STORAGE_KEY, password)
      }
      isVerifying.value = false
      console.log('[SettingsStore] Dev mode: API verification skipped')
      return true
    }

    // 生产环境：真实 API 验证
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include', // 允许发送和接收 Cookie
      })

      const data = await response.json()

      if (data.success) {
        isAuthenticated.value = true
        if (persistPassword) {
          localStorage.setItem(PASSWORD_STORAGE_KEY, password)
        }
        return true
      }

      // 验证失败：如果是静默验证，清理旧密码
      if (!persistPassword) {
        localStorage.removeItem(PASSWORD_STORAGE_KEY)
      }
      return false
    } catch {
      return false
    } finally {
      isVerifying.value = false
    }
  }

  /**
   * 应用启动时的初始化验证
   */
  async function initializeAuth(): Promise<void> {
    const savedPassword = localStorage.getItem(PASSWORD_STORAGE_KEY)
    if (savedPassword) {
      await verifyPassword(savedPassword, false)
    }
  }

  return {
    settings,
    resetSettings,
    // 认证相关
    isAuthenticated,
    isVerifying,
    verifyPassword,
    initializeAuth,
  }
})

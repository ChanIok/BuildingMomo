import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'

import type { Locale } from '../composables/useI18n'

// 输入绑定配置接口
export interface InputBindings {
  camera: {
    orbitRotate: 'middle' | 'right'
    flightLook: 'middle' | 'right'
    enableAltLeftClick: boolean
  }
  selection: {
    add: 'shift' | 'ctrl' | 'alt'
    subtract: 'alt' | 'ctrl' | 'shift'
    toggleIndividual: string // 支持任意组合键
    intersect: string // 支持任意组合键或 'none'
  }
}

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
  mirrorWithRotation: boolean // 镜像时同时旋转
  enableWatchNotification: boolean // 文件监控弹窗提示

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
  cameraLockHorizontalMovement: boolean // 锁定水平移动（WASD仅在水平面移动）

  // 坐标系设置
  gizmoSpace: 'world' | 'local' // Gizmo 空间模式（全局/局部坐标系）

  // 变换步进设置
  translationSnap: number // 平移步进值（0 表示禁用）
  rotationSnap: number // 旋转步进值，单位：弧度（0 表示禁用）
  enableSurfaceSnap: boolean // 启用表面碰撞吸附
  surfaceSnapThreshold: number // 表面吸附距离（单位）

  // 语言设置
  language: Locale

  // 输入绑定设置
  inputBindings: InputBindings
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
  mirrorWithRotation: true,
  enableWatchNotification: true,
  threeDisplayMode: 'simple-box',
  threeSymbolScale: 1.0,
  cameraFov: 50,
  cameraBaseSpeed: 1000,
  cameraShiftMultiplier: 4,
  cameraMouseSensitivity: 0.002,
  cameraZoomSpeed: 2.5,
  perspectiveControlMode: 'orbit',
  cameraLockHorizontalMovement: false,
  gizmoSpace: 'world',
  translationSnap: 0,
  rotationSnap: 0,
  enableSurfaceSnap: false,
  surfaceSnapThreshold: 20,
  language: 'zh',
  inputBindings: {
    camera: {
      orbitRotate: 'middle',
      flightLook: 'middle',
      enableAltLeftClick: false,
    },
    selection: {
      add: 'shift',
      subtract: 'alt',
      toggleIndividual: 'ctrl',
      intersect: 'shift+alt',
    },
  },
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
   * 静默解决 InputBindings 冲突
   * 当用户修改某个选择修饰键绑定时，自动清除冲突项
   * @param field 修改的字段
   * @param newValue 新值
   */
  function resolveSelectionBindingConflicts(
    field: keyof InputBindings['selection'],
    newValue: string
  ): void {
    const bindings = settings.value.inputBindings.selection

    // 如果新值是 'none'，直接返回
    if (newValue === 'none') return

    // 提取新值的主键（去除组合键的 +）
    const newParts = newValue.split('+')

    // 遍历其他字段，清除使用相同键的配置
    const fields: Array<keyof InputBindings['selection']> = [
      'add',
      'subtract',
      'toggleIndividual',
      'intersect',
    ]

    for (const otherField of fields) {
      if (otherField === field) continue // 跳过自己

      const otherValue = bindings[otherField]
      if (otherValue === 'none') continue

      const otherParts = otherValue.split('+')

      // 检查是否完全相同（不区分顺序）
      if (
        newParts.length === otherParts.length &&
        newParts.every((part) => otherParts.includes(part))
      ) {
        // 完全相同，清空旧的
        ;(bindings[otherField] as any) = 'none'
        console.log(
          `[SettingsStore] Conflict resolved: ${otherField} cleared due to duplicate with ${field}`
        )
      }
    }

    // 检查与 Alt+左键相机控制的冲突
    resolveAltCameraConflicts()
  }

  /**
   * 解决 Alt+左键相机控制 与 选择修饰键的冲突
   * 当启用 Alt+左键相机控制时，只禁用“单独的 alt”绑定，保留组合键（如 ctrl+alt、shift+alt）
   */
  function resolveAltCameraConflicts(): void {
    const enableAlt = settings.value.inputBindings.camera.enableAltLeftClick
    const bindings = settings.value.inputBindings.selection

    if (enableAlt) {
      // Alt+左键相机控制已启用：只禁用单独的 'alt'，保留组合键
      const fields: Array<keyof InputBindings['selection']> = [
        'add',
        'subtract',
        'toggleIndividual',
        'intersect',
      ]

      for (const field of fields) {
        const value = bindings[field]
        // 只检查是否完全等于 'alt'（不包含组合键）
        if (value === 'alt') {
          ;(bindings[field] as any) = 'none'
          console.log(
            `[SettingsStore] Conflict resolved: ${field} cleared because Alt+Left Camera is enabled`
          )
        }
      }
    }
    // 当相机控制禁用时，不需要任何操作（用户可以自由设置选择修饰键）
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
    resolveSelectionBindingConflicts,
    resolveAltCameraConflicts,
    // 认证相关
    isAuthenticated,
    isVerifying,
    verifyPassword,
    initializeAuth,
  }
})

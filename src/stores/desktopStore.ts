import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { DesktopSettings, DesktopStatus, CleanMemoryResult } from '@/types/desktop'

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  gpuRealtimePriority: true,
  rtssHangLimitEnabled: false,
  rtssHangLimitFps: 15,
}

const DEFAULT_DESKTOP_STATUS: DesktopStatus = {
  isDesktop: false,
  rtssAvailable: false,
  gameRunning: false,
  gameFocused: false,
  isLimiting: false,
}

const STORAGE_KEY = 'buildingmomo_desktop_settings'

/**
 * 桌面宿主环境状态与调度管理 Store
 * 负责桌面客户端专有能力的配置持久化及与 C++ 宿主 (WebView2) 的双向 IPC 通信
 */
export const useDesktopStore = defineStore('desktop', () => {
  // ========== 状态定义 ==========

  /**
   * 桌面端偏好设置（自动持久化到 localStorage，具备版本默认值合并）
   */
  const settings = useLocalStorage<DesktopSettings>(STORAGE_KEY, DEFAULT_DESKTOP_SETTINGS, {
    mergeDefaults: true,
  })

  /**
   * 桌面端运行时状态（由 C++ 原生宿主通过 WebMessage 驱动）
   */
  const status = ref<DesktopStatus>({ ...DEFAULT_DESKTOP_STATUS })

  // ========== 计算属性 ==========

  /**
   * 当前是否运行在桌面端客户端容器内
   */
  const isDesktop = computed(() => status.value.isDesktop)

  // ========== 原生通信与逻辑 ==========

  /**
   * 获取当前宿主环境注入的 WebView2 接口
   */
  function getWebview() {
    if (typeof window === 'undefined') return undefined
    return window.chrome?.webview
  }

  /**
   * 将当前设置同步至 C++ 原生宿主
   */
  function syncConfigToNative(): void {
    const webview = getWebview()
    if (!webview) return

    webview.postMessage({
      type: 'updateDesktopConfig',
      gpuRealtimePriority: settings.value.gpuRealtimePriority,
      rtssHangLimitEnabled: settings.value.rtssHangLimitEnabled,
      rtssHangLimitFps: Number(settings.value.rtssHangLimitFps) || 15,
    })
  }

  /**
   * 处理原生宿主下发的广播状态消息
   */
  function handleNativeMessage(event: MessageEvent): void {
    const data = event.data
    if (!data || typeof data !== 'object') return

    if (data.type === 'desktopStatus' && data.status) {
      status.value.isDesktop = true
      status.value.rtssAvailable = Boolean(data.status.rtssAvailable)
      status.value.gameRunning = Boolean(data.status.gameRunning)
      status.value.gameFocused = Boolean(data.status.gameFocused)
      status.value.isLimiting = Boolean(data.status.isLimiting)
    } else if (data.type === 'cleanMemoryResult') {
      const target = data.target as 'game' | 'editor'
      const resolver = cleanMemoryResolvers.get(target)
      if (resolver) {
        cleanMemoryResolvers.delete(target)
        resolver({
          target,
          success: Boolean(data.success),
          releasedMb: Number(data.releasedMb) || 0,
          errorCode: data.errorCode || (data.success ? 'ok' : 'failed'),
        })
      }
    }
  }

  const cleanMemoryResolvers = new Map<string, (result: CleanMemoryResult) => void>()

  /**
   * 请求 C++ 宿主释放指定目标（游戏或编辑器自身）的工作集物理内存
   */
  function cleanMemory(target: 'game' | 'editor'): Promise<CleanMemoryResult> {
    const webview = getWebview()
    if (!webview) {
      return Promise.resolve({
        target,
        success: false,
        releasedMb: 0,
        errorCode: 'failed',
      })
    }

    return new Promise((resolve) => {
      cleanMemoryResolvers.set(target, resolve)
      webview.postMessage({
        type: 'cleanMemory',
        target,
      })
      setTimeout(() => {
        if (cleanMemoryResolvers.has(target)) {
          cleanMemoryResolvers.delete(target)
          resolve({
            target,
            success: false,
            releasedMb: 0,
            errorCode: 'failed',
          })
        }
      }, 5000)
    })
  }

  /**
   * 初始化桌面端连接
   * 在根组件挂载时调用，建立 WebMessage 监听并完成初次状态握手与配置推送
   */
  function init(): void {
    const webview = getWebview()
    if (!webview) return

    status.value.isDesktop = true
    webview.addEventListener('message', handleNativeMessage)

    // 初次握手：请求原生宿主当前状态，并同步已有本地偏好
    webview.postMessage({ type: 'getDesktopConfig' })
    syncConfigToNative()

    // 监听用户设置变动，自动同步给原生执行层
    watch(
      () => settings.value,
      () => {
        syncConfigToNative()
      },
      { deep: true }
    )
  }

  return {
    // 状态
    settings,
    status,
    isDesktop,

    // 动作
    init,
    syncConfigToNative,
    cleanMemory,
  }
})

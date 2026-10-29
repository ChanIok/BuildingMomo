/**
 * 桌面端配置与运行时状态类型定义
 */

export interface DesktopSettings {
  /** 是否开启 GPU 实时调度优先级 (REALTIME) */
  gpuRealtimePriority: boolean
  /** 是否在游戏失去焦点时自动限制帧率 */
  rtssHangLimitEnabled: boolean
  /** 失焦后台限制目标帧率 (1~240) */
  rtssHangLimitFps: number
}

export interface DesktopVersion {
  /** 外壳的提交短哈希 */
  commit: string
  /** 外壳所基于提交的时间 (ISO 8601，含时区偏移) */
  committedAt: string
}

export interface DesktopStatus {
  /** Native AI bridge protocol; absent on older desktop shells. */
  aiProtocol?: number
  /** 是否处于桌面宿主 (WebView2) 环境 */
  isDesktop: boolean
  /** 当前进程是否处于管理员运行权限 (Elevated) */
  isElevated: boolean
  /** 用户是否启用了“默认以管理员身份运行”策略（根据数据目录 no_admin 标记文件反推） */
  runAsAdminEnabled: boolean
  /** RTSS (RivaTuner Statistics Server) 是否已就绪并运行 */
  rtssAvailable: boolean
  /** 目标游戏是否正在运行 */
  gameRunning: boolean
  /** 目标游戏当前是否处于前台激活状态 */
  gameFocused: boolean
  /** 当前是否正处于限帧生效状态 */
  isLimiting: boolean
  /** 外壳版本信息；纯网页环境为 null */
  version: DesktopVersion | null
}

export interface CleanMemoryResult {
  target: 'game' | 'editor'
  success: boolean
  releasedMb: number
  errorCode: 'ok' | 'game_not_running' | 'access_denied' | 'failed'
}

/**
 * 原生宿主通信协议接口
 */
export interface ChromeWebView {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

declare global {
  interface Window {
    chrome?: {
      webview?: ChromeWebView
    }
  }
}

/**
 * 帧率监视器（模块级单例）
 *
 * recordRenderFrame() 在每次 Three.js 实际渲染时调用。
 * 每 250ms 采样一次当前瞬时 FPS 写入 ring buffer，共保留 60 个历史点（15 秒）。
 * 空闲超过 1s 不渲染时，帧记录自动清除，FPS 归零。
 */

const SAMPLE_INTERVAL_MS = 250
const HISTORY_SIZE = 60

// 最近帧的时间戳（用于计算瞬时 FPS，最多保留 20 帧）
let _recentFrames: number[] = []

// FPS 历史 ring buffer（chronological: ptr 为下一个写入位置）
const _fpsHistory = new Float32Array(HISTORY_SIZE)
let _historyPtr = 0

let _intervalId: ReturnType<typeof setInterval> | null = null
let _refCount = 0

/** 每次 Three.js 实际渲染时调用（在 @render 回调最前面） */
export function recordRenderFrame(): void {
  _recentFrames.push(performance.now())
  if (_recentFrames.length > 20) _recentFrames = _recentFrames.slice(-20)
}

/** 当前瞬时 FPS（基于最近帧间隔） */
export function getInstantFps(): number {
  const n = _recentFrames.length
  if (n < 2) return 0
  const span = _recentFrames[n - 1]! - _recentFrames[0]!
  return span > 0 ? ((n - 1) * 1000) / span : 0
}

/** 最近帧的平均帧时间（ms） */
export function getFrameMs(): number {
  const n = _recentFrames.length
  if (n < 2) return 0
  return (_recentFrames[n - 1]! - _recentFrames[0]!) / (n - 1)
}

/**
 * 返回 FPS 历史 ring buffer（只读引用）
 * 读取顺序：i=0 最旧，i=HISTORY_SIZE-1 最新，公式：(ptr + i) % size
 */
export function getFpsHistory(): { data: Float32Array; ptr: number; size: number } {
  return { data: _fpsHistory, ptr: _historyPtr, size: HISTORY_SIZE }
}

/** 启动采样定时器（ref-counted，支持多个组件同时使用） */
export function startFpsMonitor(): void {
  _refCount++
  if (_intervalId !== null) return

  _intervalId = setInterval(() => {
    _fpsHistory[_historyPtr % HISTORY_SIZE] = getInstantFps()
    _historyPtr++
    // 清除超过 1s 前的帧记录，确保空闲时 FPS 自然归零
    const cutoff = performance.now() - 1000
    _recentFrames = _recentFrames.filter((t) => t > cutoff)
  }, SAMPLE_INTERVAL_MS)
}

/** 停止采样定时器（ref-counted） */
export function stopFpsMonitor(): void {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount > 0 || _intervalId === null) return
  clearInterval(_intervalId)
  _intervalId = null
}

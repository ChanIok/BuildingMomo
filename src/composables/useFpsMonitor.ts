/**
 * 帧率监视器（模块级单例）
 *
 * recordRenderFrame() 在每次 Three.js 实际渲染时调用。
 * 每 250ms 采样一次最近一秒的 FPS，共保留 60 个历史点（15 秒）。
 * 空闲超过 1s 不渲染时，帧记录自动清除，FPS 归零。
 */

const SAMPLE_INTERVAL_MS = 250
const HISTORY_SIZE = 60

// 由采样定时器裁剪到最近一秒，避免高刷新率下统计窗口过短。
let _recentFrames: number[] = []
let _firstFrame: number | undefined

// FPS 历史 ring buffer（chronological: ptr 为下一个写入位置）
const _fpsHistory = new Float32Array(HISTORY_SIZE)
let _historyPtr = 0

let _intervalId: ReturnType<typeof setInterval> | null = null
let _refCount = 0
let _gpuMs: number | null = null
let _gpuSampledAt = -Infinity

export function recordGpuFrame(milliseconds: number | null, sampledAt: number): void {
  _gpuMs = milliseconds
  _gpuSampledAt = sampledAt
}

export function getGpuFrameMs(): number | null {
  const lastFrame = _recentFrames[_recentFrames.length - 1]
  // GPU results arrive asynchronously and can be seconds behind submission.
  // Clear on actual rendering inactivity, not on the age of a valid query.
  return _refCount > 0 &&
    lastFrame !== undefined &&
    lastFrame >= _gpuSampledAt &&
    performance.now() - lastFrame < 1000
    ? _gpuMs
    : null
}

/** 每次 Three.js 实际渲染时调用（在 @render 回调最前面） */
export function recordRenderFrame(): void {
  if (_refCount === 0) return
  const now = performance.now()
  if (_recentFrames.length === 0) _firstFrame = now
  _recentFrames.push(now)
}

/** 最近一秒实际绘制数；启动时按已观察到的时长计算。 */
export function getInstantFps(): number {
  if (_firstFrame === undefined) return 0
  const now = performance.now()
  const start = Math.max(_firstFrame, now - 1000)
  if (now <= start) return 0
  let count = 0
  for (const time of _recentFrames) if (time > start) count++
  return (count * 1000) / (now - start)
}

/** 最近帧的平均帧时间（ms） */
export function getFrameMs(): number {
  const fps = getInstantFps()
  return fps > 0 ? 1000 / fps : 0
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

  _recentFrames = []
  _firstFrame = undefined
  _gpuMs = null
  _fpsHistory.fill(0)
  _historyPtr = 0
  _intervalId = setInterval(() => {
    // 清除超过 1s 前的帧记录，确保空闲时 FPS 自然归零
    const cutoff = performance.now() - 1000
    _recentFrames = _recentFrames.filter((t) => t > cutoff)
    _fpsHistory[_historyPtr % HISTORY_SIZE] = getInstantFps()
    _historyPtr++
  }, SAMPLE_INTERVAL_MS)
}

/** 停止采样定时器（ref-counted） */
export function stopFpsMonitor(): void {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount > 0 || _intervalId === null) return
  clearInterval(_intervalId)
  _intervalId = null
  _recentFrames = []
  _firstFrame = undefined
  _gpuMs = null
}

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type LoadingType = 'icon' | 'model'
export type LoadingPhase = 'network' | 'processing'
export type LoadingMode = 'simple' | 'staged' // 新增：加载模式
export interface LoadingDisplayOptions {
  showDelayMs?: number
  completeHoldMs?: number
}

const DEFAULT_SHOW_DELAY_MS = 200
const DEFAULT_COMPLETE_HOLD_MS = 500

export const useLoadingStore = defineStore('loading', () => {
  // 状态
  const isLoading = ref(false)
  const isVisible = ref(false)
  const loadingType = ref<LoadingType | null>(null)
  const current = ref(0)
  const total = ref(0)
  const failedCount = ref(0)

  // 当前加载阶段
  const phase = ref<LoadingPhase>('network')

  // 新增：加载模式
  const mode = ref<LoadingMode>('simple')

  // 自动隐藏/延迟显示定时器
  let showTimer: number | null = null
  let hideTimer: number | null = null
  let loadingSessionId = 0
  let activeCompleteHoldMs = DEFAULT_COMPLETE_HOLD_MS

  function clearTimers() {
    if (showTimer !== null) {
      clearTimeout(showTimer)
      showTimer = null
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function resetState() {
    isLoading.value = false
    isVisible.value = false
    current.value = 0
    total.value = 0
    failedCount.value = 0
    loadingType.value = null
  }

  // 计算属性
  const progress = computed(() => {
    if (total.value === 0) return 0

    // Simple模式：单阶段 0-100%
    if (mode.value === 'simple') {
      return Math.round((current.value / total.value) * 100)
    }

    // Staged模式：两阶段进度
    if (phase.value === 'network') {
      // 阶段1：网络加载 (0-50%)
      return Math.round((current.value / total.value) * 50)
    } else {
      // 阶段2：渲染准备 (50-100%)
      const processingProgress = (current.value / total.value) * 50
      return Math.round(50 + processingProgress)
    }
  })

  const hasFailures = computed(() => failedCount.value > 0)

  const isComplete = computed(() => current.value >= total.value && total.value > 0)

  // 方法
  function startLoading(
    type: LoadingType,
    totalCount: number,
    loadingMode: LoadingMode = 'simple',
    displayOptions: LoadingDisplayOptions = {}
  ) {
    if (totalCount <= 0) {
      clearTimers()
      resetState()
      return
    }

    const showDelayMs = Math.max(0, displayOptions.showDelayMs ?? DEFAULT_SHOW_DELAY_MS)
    activeCompleteHoldMs = Math.max(0, displayOptions.completeHoldMs ?? DEFAULT_COMPLETE_HOLD_MS)
    loadingSessionId++
    const sessionId = loadingSessionId

    clearTimers()

    isLoading.value = true
    isVisible.value = false
    loadingType.value = type
    current.value = 0
    total.value = totalCount
    failedCount.value = 0
    phase.value = 'network' // 重置为网络阶段
    mode.value = loadingMode // 设置加载模式

    console.log(`[LoadingStore] 开始加载 ${type}, 总数: ${totalCount}, 模式: ${loadingMode}`)

    if (showDelayMs === 0) {
      isVisible.value = true
      return
    }

    showTimer = window.setTimeout(() => {
      if (sessionId !== loadingSessionId) return
      if (!isLoading.value) return
      isVisible.value = true
      showTimer = null
    }, showDelayMs)
  }

  /**
   * 设置加载阶段（仅在staged模式下有效）
   */
  function setPhase(newPhase: LoadingPhase) {
    if (mode.value !== 'staged') {
      console.warn(`[LoadingStore] setPhase仅在staged模式下生效，当前模式: ${mode.value}`)
      return
    }

    phase.value = newPhase
    if (newPhase === 'processing') {
      // 切换到处理阶段时，重置 current 以便重新统计处理进度
      current.value = 0
    }
    console.log(`[LoadingStore] 切换阶段: ${newPhase}`)
  }

  function updateProgress(currentCount: number, failed: number = 0) {
    current.value = currentCount
    failedCount.value = failed

    // 如果加载完成，延迟隐藏
    if (currentCount >= total.value) {
      finishLoading()
    }
  }

  function finishLoading() {
    console.log(`[LoadingStore] 加载完成`)
    isLoading.value = false

    if (showTimer !== null) {
      clearTimeout(showTimer)
      showTimer = null
    }

    // 未达到显示阈值时，直接清空，避免瞬时任务闪烁
    if (!isVisible.value) {
      resetState()
      return
    }

    // 显示完成状态一小段时间后再隐藏
    hideTimer = window.setTimeout(() => {
      resetState()
      hideTimer = null
    }, activeCompleteHoldMs)
  }

  function cancelLoading() {
    console.log(`[LoadingStore] 取消加载`)
    loadingSessionId++
    clearTimers()
    resetState()
  }

  return {
    // 状态
    isLoading,
    isVisible,
    loadingType,
    current,
    total,
    failedCount,
    phase,
    mode,
    progress,
    hasFailures,
    isComplete,

    // 方法
    startLoading,
    setPhase,
    updateProgress,
    finishLoading,
    cancelLoading,
  }
})

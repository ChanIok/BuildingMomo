import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type LoadingType = 'icon' | 'model'
export type LoadingPhase = 'network' | 'processing'
export type LoadingMode = 'simple' | 'staged' // 新增：加载模式

export const useLoadingStore = defineStore('loading', () => {
  // 状态
  const isLoading = ref(false)
  const loadingType = ref<LoadingType | null>(null)
  const current = ref(0)
  const total = ref(0)
  const failedCount = ref(0)

  // 当前加载阶段
  const phase = ref<LoadingPhase>('network')

  // 新增：加载模式
  const mode = ref<LoadingMode>('simple')

  // 自动隐藏定时器
  let hideTimer: number | null = null

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
    loadingMode: LoadingMode = 'simple'
  ) {
    // 清除之前的自动隐藏定时器
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    isLoading.value = true
    loadingType.value = type
    current.value = 0
    total.value = totalCount
    failedCount.value = 0
    phase.value = 'network' // 重置为网络阶段
    mode.value = loadingMode // 设置加载模式

    console.log(`[LoadingStore] 开始加载 ${type}, 总数: ${totalCount}, 模式: ${loadingMode}`)
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

    // 2秒后清空状态，让完成动画有时间显示
    hideTimer = window.setTimeout(() => {
      current.value = 0
      total.value = 0
      failedCount.value = 0
      loadingType.value = null
      hideTimer = null
    }, 2000)
  }

  function cancelLoading() {
    console.log(`[LoadingStore] 取消加载`)
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    isLoading.value = false
    current.value = 0
    total.value = 0
    failedCount.value = 0
    loadingType.value = null
  }

  return {
    // 状态
    isLoading,
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

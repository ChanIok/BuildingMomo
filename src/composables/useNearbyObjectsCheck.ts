import { ref, watch, type Ref } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { useEditorStore } from '@/stores/editorStore'
import { yieldToMain } from './renderer/shared/asyncRaycast'

// ============================================================
// 配置常量
// ============================================================

/** 每帧时间预算（毫秒） */
const BUDGET_MS = 3

/** 每隔多少个物品检查一次时间 */
const ITEMS_PER_CHECK = 1000

// ============================================================
// 类型定义
// ============================================================

interface NearbyCheckTask {
  cancelled: boolean
}

export interface NearbyObjectsCheckOptions {
  /** 检测阈值（距离，默认 1000） */
  threshold?: number
  /** 节流间隔（毫秒，默认 200） */
  throttleMs?: number
}

// ============================================================
// Composable
// ============================================================

/**
 * 检测相机周围是否有物体
 *
 * 使用时间切片避免阻塞主线程，适用于大量物品的场景
 *
 * @param cameraPosition - 相机位置（响应式）
 * @param options - 配置选项
 * @returns hasNearbyObjects - 是否有近处物体
 */
export function useNearbyObjectsCheck(
  cameraPosition: Ref<[number, number, number]>,
  options?: NearbyObjectsCheckOptions
) {
  const editorStore = useEditorStore()
  const hasNearbyObjects = ref(false)

  // 配置
  const threshold = options?.threshold ?? 1000
  const throttleMs = options?.throttleMs ?? 200
  const THRESHOLD_SQ = threshold * threshold

  // 当前任务（用于取消）
  let currentTask: NearbyCheckTask | null = null

  /**
   * 异步检测（时间切片）
   */
  async function performCheckAsync() {
    // 取消上一个任务
    if (currentTask) {
      currentTask.cancelled = true
    }

    const task: NearbyCheckTask = { cancelled: false }
    currentTask = task

    const items = editorStore.activeScheme?.items.value
    if (!items || items.length === 0) {
      hasNearbyObjects.value = false
      return
    }

    // 缓存相机位置（避免在循环中反复访问响应式）
    const camPos = cameraPosition.value
    const camX = camPos[0]
    const camY = -camPos[1] // Y 轴取反（Three.js 坐标系）
    const camZ = camPos[2]

    let frameStart = performance.now()

    for (let i = 0; i < items.length; i++) {
      // 检查是否被取消
      if (task.cancelled) return

      // 每 N 个物品检查时间预算
      if (i % ITEMS_PER_CHECK === 0 && i > 0) {
        const elapsed = performance.now() - frameStart
        if (elapsed > BUDGET_MS) {
          await yieldToMain()
          // yield 后再次检查取消状态
          if (task.cancelled) return
          frameStart = performance.now()
        }
      }

      const item = items[i]
      if (!item) continue

      const dx = item.x - camX
      const dy = item.y - camY
      const dz = item.z - camZ

      if (dx * dx + dy * dy + dz * dz < THRESHOLD_SQ) {
        hasNearbyObjects.value = true
        return
      }
    }

    hasNearbyObjects.value = false
  }

  // 节流版本
  const throttledCheck = useThrottleFn(performCheckAsync, throttleMs)

  // 监听相机位置变化
  watch(cameraPosition, throttledCheck)

  // 监听场景变化（物品增删）
  watch(() => editorStore.sceneVersion, throttledCheck)

  // 监听方案切换（立即执行）
  watch(
    () => editorStore.activeSchemeId,
    () => {
      performCheckAsync()
    }
  )

  return {
    hasNearbyObjects,
  }
}

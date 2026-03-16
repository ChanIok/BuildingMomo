export interface TaskToken {
  cancelled: boolean
}

export interface TimeSlicerOptions {
  budgetMs?: number
  checkEvery?: number
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * 让出主线程一帧。
 * 优先使用 scheduler.yield（若可用），回退到 requestAnimationFrame，
 * 最终回退到 setTimeout(0)。
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = () => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
      } else {
        setTimeout(resolve, 0)
      }
    }

    const schedulerObj = (globalThis as any).scheduler
    if (schedulerObj && typeof schedulerObj.yield === 'function') {
      schedulerObj.yield().then(resolve).catch(fallback)
      return
    }

    fallback()
  })
}

export function createTaskToken(): TaskToken {
  return { cancelled: false }
}

export function cancelTaskToken(task: TaskToken | null | undefined): void {
  if (task) {
    task.cancelled = true
  }
}

/**
 * 生成可复用的时间分片检查器。
 * 调用 checkpoint(iteration, task)：
 * - 返回 true: 继续执行
 * - 返回 false: 任务已取消，应立即终止
 */
export function createTimeSlicer(options: TimeSlicerOptions = {}) {
  const budgetMs = Math.max(0, options.budgetMs ?? 8)
  const checkEvery = Math.max(1, Math.floor(options.checkEvery ?? 1))
  let frameStart = nowMs()

  const shouldCheckTime = (iteration: number) => iteration > 0 && iteration % checkEvery === 0

  async function checkpoint(iteration: number, task?: TaskToken | null): Promise<boolean> {
    if (task?.cancelled) return false
    if (!shouldCheckTime(iteration)) return true
    if (nowMs() - frameStart <= budgetMs) return true

    await yieldToMain()
    if (task?.cancelled) return false
    frameStart = nowMs()
    return true
  }

  function reset() {
    frameStart = nowMs()
  }

  return {
    checkpoint,
    reset,
  }
}

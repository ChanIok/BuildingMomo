import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLoadingStore } from '../../src/stores/loadingStore'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('window', globalThis)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('render preparation feedback', () => {
  it('keeps repeated phase reports idempotent while accepting updated totals', () => {
    const loading = useLoadingStore()
    const session = loading.startLoading('model', 2, 'staged')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      loading.setPhase('shaders', 2, session)
      loading.updateProgress(1, 0, session)
      loading.setPhase('shaders', 3, session)
      expect(loading.current).toBe(1)
      expect(loading.total).toBe(3)
      expect(log).toHaveBeenCalledExactlyOnceWith('[LoadingStore] 切换阶段: shaders')
    } finally {
      log.mockRestore()
    }
  })

  it('clears completed feedback without reporting a cancelled task', () => {
    const loading = useLoadingStore()
    const session = loading.startLoading('model', 1, 'staged', { showDelayMs: 0 })
    loading.finishLoading(session)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      loading.cancelLoading(session)
      expect(log).not.toHaveBeenCalled()
      expect(loading.isVisible).toBe(false)
      expect(loading.total).toBe(0)
      vi.runAllTimers()
      expect(loading.isVisible).toBe(false)
    } finally {
      log.mockRestore()
    }
  })

  it('tracks shader preparation without replacing its phase at completion', () => {
    const loading = useLoadingStore()
    const session = loading.startLoading('environment', 1, 'staged', { showDelayMs: 0 })
    loading.setPhase('shaders', 10, session)
    loading.updateProgress(5, 0, session)
    expect(loading.progress).toBe(75)
    loading.updateProgress(10, 0, session)
    expect(loading.isLoading).toBe(true)
    loading.finishLoading(session)
    expect(loading.phase).toBe('shaders')
    expect(loading.current).toBe(10)
    expect(loading.progress).toBe(100)
  })

  it('still completes simple icon loading automatically', () => {
    const loading = useLoadingStore()
    const session = loading.startLoading('icon', 2, 'simple', { showDelayMs: 0 })
    loading.updateProgress(2, 0, session)
    expect(loading.isLoading).toBe(false)
    expect(loading.progress).toBe(100)
    vi.runAllTimers()
    expect(loading.isVisible).toBe(false)
  })

  it('finishes staged loading only after its owner publishes the result', () => {
    const loading = useLoadingStore()
    const session = loading.startLoading('model', 2, 'staged', { showDelayMs: 0 })
    loading.updateProgress(2, 0, session)
    expect(loading.isLoading).toBe(true)
    expect(loading.progress).toBe(50)
    loading.setPhase('processing', 3, session)
    loading.updateProgress(3, 0, session)
    expect(loading.isLoading).toBe(true)
    expect(loading.isVisible).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(loading.isVisible).toBe(true)
    loading.finishLoading(session)
    expect(loading.isLoading).toBe(false)
    expect(loading.progress).toBe(100)
    vi.runAllTimers()
    expect(loading.isVisible).toBe(false)
  })

  it('ignores progress, failure and cancellation from a superseded owner', () => {
    const loading = useLoadingStore()
    const first = loading.startLoading('model', 5)
    const second = loading.startLoading('model', 8, 'staged', { showDelayMs: 0 })
    loading.updateProgress(5, 0, first)
    loading.setPhase('processing', 2, first)
    loading.failLoading(new Error('old failure'), first)
    loading.cancelLoading(first)
    loading.finishLoading(first)
    expect(loading.isLoading).toBe(true)
    expect(loading.total).toBe(8)
    expect(loading.current).toBe(0)
    expect(loading.error).toBeNull()
    loading.failLoading(new Error('current failure'), second)
    expect(loading.error).toBe('current failure')
    expect(loading.isLoading).toBe(false)
    vi.runAllTimers()
    expect(loading.isVisible).toBe(true)
    loading.startLoading('model', 1)
    expect(loading.error).toBeNull()
  })
})

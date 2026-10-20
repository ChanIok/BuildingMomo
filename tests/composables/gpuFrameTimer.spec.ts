import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createGpuFrameTimer } from '../../src/composables/renderer/gpuFrameTimer'

let available: boolean, disjoint: boolean, lost: boolean, enabled: boolean
let current: object | null
let canvas: EventTarget
let gl: ReturnType<typeof mockContext>
let timer: ReturnType<typeof createGpuFrameTimer>
let report: ReturnType<typeof vi.fn>

function mockContext() {
  return {
    canvas,
    CURRENT_QUERY: 1,
    QUERY_RESULT_AVAILABLE: 2,
    QUERY_RESULT: 3,
    getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 })),
    getParameter: vi.fn(() => disjoint),
    getQuery: vi.fn(() => current),
    createQuery: vi.fn(() => ({})),
    beginQuery: vi.fn((_target: number, query: object) => {
      current = query
    }),
    endQuery: vi.fn(() => {
      current = null
    }),
    deleteQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: object, parameter: number) =>
      parameter === 2 ? available : 12_500_000
    ),
    isContextLost: vi.fn(() => lost),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  available = false
  disjoint = false
  lost = false
  enabled = true
  current = null
  canvas = new EventTarget()
  gl = mockContext()
  report = vi.fn()
  timer = createGpuFrameTimer(gl as unknown as WebGL2RenderingContext, () => enabled, report)
})

afterEach(() => {
  timer.dispose()
  vi.useRealTimers()
})

it('reads nanoseconds asynchronously only after availability, including while rendering is idle', () => {
  const end = timer.beginFrame()!
  expect(gl.endQuery).not.toHaveBeenCalled()
  end()
  vi.advanceTimersByTime(100)
  expect(report).not.toHaveBeenCalled()
  expect(gl.getQueryParameter.mock.calls.every(([, parameter]) => parameter === 2)).toBe(true)
  available = true
  vi.advanceTimersByTime(100)
  expect(report).toHaveBeenLastCalledWith(12.5, 0)
  expect(gl.deleteQuery).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('discards pending results when the GPU clock becomes disjoint', () => {
  timer.beginFrame()!()
  disjoint = true
  available = true
  vi.advanceTimersByTime(100)
  expect(report).toHaveBeenLastCalledWith(null, 100)
  expect(gl.getQueryParameter).not.toHaveBeenCalled()
  expect(gl.deleteQuery).toHaveBeenCalledTimes(1)
})

it('does not interfere with another profiler or collect while disabled', () => {
  current = {}
  expect(timer.beginFrame()).toBeUndefined()
  expect(gl.beginQuery).not.toHaveBeenCalled()
  current = null
  enabled = false
  expect(timer.beginFrame()).toBeUndefined()
  expect(gl.beginQuery).not.toHaveBeenCalled()
})

it('limits sampling frequency and bounds pending queries when the driver does not return results', () => {
  timer.beginFrame()!()
  expect(timer.beginFrame()).toBeUndefined()
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(250)
    timer.beginFrame()!()
  }
  vi.advanceTimersByTime(250)
  expect(timer.beginFrame()).toBeUndefined()
  expect(gl.createQuery).toHaveBeenCalledTimes(4)
  enabled = false
  vi.advanceTimersByTime(100)
  expect(gl.deleteQuery).toHaveBeenCalledTimes(4)
  expect(vi.getTimerCount()).toBe(0)
})

it('ignores lost queries and resumes only with a restored context', () => {
  const end = timer.beginFrame()!
  lost = true
  canvas.dispatchEvent(new Event('webglcontextlost'))
  end()
  expect(gl.endQuery).not.toHaveBeenCalled()
  expect(timer.beginFrame()).toBeUndefined()
  lost = false
  current = null
  canvas.dispatchEvent(new Event('webglcontextrestored'))
  expect(timer.beginFrame()).toBeTypeOf('function')
  expect(gl.getExtension).toHaveBeenCalledTimes(2)
})

it('disposes active and queued work without letting a deferred end touch another query', () => {
  const end = timer.beginFrame()!
  timer.dispose()
  current = {}
  end()
  expect(gl.endQuery).toHaveBeenCalledTimes(1)
  expect(gl.deleteQuery).toHaveBeenCalledTimes(1)
  expect(timer.beginFrame()).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not start queries when the timer extension is unavailable', () => {
  timer.dispose()
  gl.getExtension.mockReturnValue(null as never)
  timer = createGpuFrameTimer(gl as unknown as WebGL2RenderingContext, () => enabled, report)
  expect(timer.beginFrame()).toBeUndefined()
  expect(gl.createQuery).not.toHaveBeenCalled()
})

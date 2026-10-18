import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let now = 0
let monitor: typeof import('../../src/composables/useFpsMonitor')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  monitor = await import('../../src/composables/useFpsMonitor')
  monitor.startFpsMonitor()
})

afterEach(() => {
  monitor.stopFpsMonitor()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function advance(time: number) {
  const elapsed = time - now
  now = time
  vi.advanceTimersByTime(elapsed)
}

it('measures 120 rendered frames per second on a 144 Hz cadence', () => {
  for (let frame = 1; frame <= 288; frame++) {
    advance((frame * 1000) / 144)
    if (frame % 6 !== 0) monitor.recordRenderFrame()
  }
  expect(monitor.getInstantFps()).toBeCloseTo(120, 0)
  expect(monitor.getFrameMs()).toBeCloseTo(1000 / 120, 1)
})

it('recovers from a frame hitch after it leaves the measurement window', () => {
  for (let frame = 1; frame <= 120; frame++) {
    advance((frame * 1000) / 120)
    monitor.recordRenderFrame()
  }
  advance(1250)
  monitor.recordRenderFrame()
  expect(monitor.getInstantFps()).toBeLessThan(100)
  for (let frame = 1; frame <= 180; frame++) {
    advance(1250 + (frame * 1000) / 120)
    monitor.recordRenderFrame()
  }
  expect(monitor.getInstantFps()).toBeCloseTo(120, 3)
})

it('clears idle readings and does not collect frames while the monitor is closed', () => {
  monitor.recordRenderFrame()
  advance(20)
  monitor.recordRenderFrame()
  expect(monitor.getInstantFps()).toBe(50)
  advance(1020)
  expect(monitor.getInstantFps()).toBe(0)
  expect(monitor.getFrameMs()).toBe(0)
  monitor.stopFpsMonitor()
  advance(1040)
  monitor.recordRenderFrame()
  advance(1060)
  monitor.recordRenderFrame()
  expect(monitor.getInstantFps()).toBe(0)
})

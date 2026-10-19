import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// Exercise the installed dependency patch, including after a fresh pnpm install.
const source = readFileSync(createRequire(import.meta.url).resolve('@tresjs/core'), 'utf8')

function section(declaration: string) {
  const start = source.indexOf(declaration)
  if (start < 0) throw new Error(`Tres dependency changed: ${declaration}`)
  return source.slice(start, source.indexOf('//#endregion', start))
}

function rafLoop(initialLimit: number) {
  let limit = initialLimit
  let tick!: (frame: { timestamp: number }) => void
  const cycle = vi.fn()
  const createLoop = runInNewContext(section('const useCreateRafLoop =') + '; useCreateRafLoop', {
    toValue: (value: () => number) => value(),
    createTimer: () => ({
      update() {},
      start() {},
      stop() {},
      getDelta: () => 0,
      getElapsed: () => 0,
    }),
    createEventHook: () => ({ trigger() {}, on() {} }),
    useRafFn: (callback: typeof tick) => {
      tick = callback
      return { pause() {}, resume() {}, isActive: { value: true } }
    },
  })
  const loop = createLoop(cycle, { fpsLimit: () => limit })
  loop.start()
  return {
    cycle,
    tick: (timestamp: number) => tick({ timestamp }),
    loop,
    setLimit: (value: number) => {
      limit = value
    },
  }
}

describe('Tres frame pacing', () => {
  for (const refresh of [59.94, 60, 120, 144, 165, 180, 240]) {
    for (const limit of [30, 60, 120, 240]) {
      it(`keeps ${limit} FPS cadence on a ${refresh} Hz RAF`, () => {
        const { tick, cycle } = rafLoop(limit)
        for (let frame = 0; frame < refresh * 10; frame++)
          tick((frame * 1000) / refresh + Math.sin(frame) * 0.05)
        expect(
          Math.abs(cycle.mock.calls.length - Math.min(refresh, limit) * 10)
        ).toBeLessThanOrEqual(2)
      })
    }
  }

  it('retains at most one frame of credit after a long stall', () => {
    const { tick, cycle } = rafLoop(60)
    tick(0)
    tick(1000)
    for (let time = 1001; time < 1016; time++) tick(time)
    expect(cycle).toHaveBeenCalledTimes(3)
    tick(1017)
    expect(cycle).toHaveBeenCalledTimes(4)
  })

  for (const refresh of [144, 180]) {
    for (const limit of [60, 120]) {
      it(`keeps ${limit} FPS with occasional missed ${refresh} Hz callbacks`, () => {
        const { tick, cycle } = rafLoop(limit)
        let time = 0
        for (let frame = 0; time < 10000; frame++) {
          tick(time)
          time += (1000 / refresh) * (frame % 17 === 0 ? 2 : 1)
        }
        expect(Math.abs(cycle.mock.calls.length - limit * 10)).toBeLessThanOrEqual(2)
      })
    }
  }

  it('applies changed limits immediately and resets the clock when restarted', () => {
    const { tick, cycle, setLimit, loop } = rafLoop(30)
    tick(0)
    tick(10)
    expect(cycle).toHaveBeenCalledTimes(1)
    setLimit(120)
    tick(11)
    tick(19.4)
    expect(cycle).toHaveBeenCalledTimes(3)
    setLimit(Infinity)
    tick(20)
    tick(21)
    expect(cycle).toHaveBeenCalledTimes(5)
    setLimit(30)
    tick(22)
    loop.stop()
    loop.start()
    tick(23)
    expect(cycle).toHaveBeenCalledTimes(7)
  })
})

it('collects Tres memory statistics on a timer only while Devtools subscribes', () => {
  let tick!: () => void
  let dispose!: () => void
  const pause = vi.fn()
  const scan = vi.fn(() => 123)
  const messenger = { hasSubscribers: false, send: vi.fn() }
  const setup = runInNewContext(section('function setupTresDevtools(') + '; setupTresDevtools', {
    window: { __TRES__DEVTOOLS__: messenger },
    useFps: () => ({ value: 60 }),
    useMemory: () => ({ isSupported: { value: false }, memory: { value: null } }),
    useIntervalFn: (callback: () => void, interval: number) => {
      expect(interval).toBeGreaterThanOrEqual(100)
      tick = callback
      return { pause }
    },
    useRafFn: () => {
      throw new Error('Statistics must not schedule a per-frame scan')
    },
    calculateMemoryUsage: scan,
    boundedPush: (array: number[], value: number) => array.push(value),
    onUnmounted: (callback: () => void) => {
      dispose = callback
    },
  })
  setup({ scene: { value: {} } })
  tick()
  expect(scan).not.toHaveBeenCalled()
  messenger.hasSubscribers = true
  tick()
  expect(scan).toHaveBeenCalledTimes(1)
  expect(messenger.send).toHaveBeenCalledTimes(2)
  messenger.hasSubscribers = false
  tick()
  expect(scan).toHaveBeenCalledTimes(1)
  dispose()
  expect(pause).toHaveBeenCalledOnce()
})

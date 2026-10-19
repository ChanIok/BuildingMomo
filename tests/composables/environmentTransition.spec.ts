import { afterEach, expect, it, vi } from 'vitest'
import { createEnvironmentTransition } from '../../src/composables/renderer/environmentTransition'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  const options = {
    start: vi.fn(),
    apply: vi.fn(async () => {}),
    prepare: vi.fn(
      async (_stale: () => boolean, progress: (current: number, total: number) => void) => {
        progress(3, 3)
        return true
      }
    ),
    progress: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn(),
    fail: vi.fn(),
    invalidate: vi.fn(),
  }
  const transition = createEnvironmentTransition(options)
  return {
    options,
    transition,
    paint: () => {
      frames.shift()!(0)
      frames.shift()!(16)
    },
  }
}

it('holds scene rendering and lets the UI paint before preparing; finishes after preparation', async () => {
  const { options, transition, paint } = setup()
  const task = transition.request()
  expect(transition.pending).toBe(true)
  expect(options.start).toHaveBeenCalledOnce()
  expect(options.apply).not.toHaveBeenCalled()
  paint()
  await task
  expect(options.progress).toHaveBeenCalledWith(3, 3)
  expect(options.finish).toHaveBeenCalledOnce()
  expect(transition.pending).toBe(false)
  expect(options.invalidate).toHaveBeenCalledOnce()
})

it('serializes rapid settings changes and never publishes a superseded shader variant', async () => {
  const { options, transition, paint } = setup()
  let release!: (ready: boolean) => void
  let stale!: () => boolean
  options.prepare.mockImplementationOnce((isStale) => {
    stale = isStale
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const task = transition.request()
  paint()
  await Promise.resolve()
  await Promise.resolve()
  expect(options.prepare).toHaveBeenCalledOnce()
  await transition.request()
  expect(stale()).toBe(true)
  release(false)
  await task
  expect(options.start).toHaveBeenCalledOnce()
  expect(options.apply).toHaveBeenCalledTimes(2)
  expect(options.prepare).toHaveBeenCalledTimes(2)
  expect(options.finish).toHaveBeenCalledOnce()
})

it('ignores late completions after disposal', async () => {
  const { options, transition, paint } = setup()
  const task = transition.request()
  transition.dispose()
  paint()
  await task
  expect(options.apply).not.toHaveBeenCalled()
  expect(options.finish).not.toHaveBeenCalled()
  expect(options.cancel).toHaveBeenCalledOnce()
  expect(options.fail).not.toHaveBeenCalled()
  expect(options.invalidate).not.toHaveBeenCalled()
})

it('reports preparation failures and releases the rendering hold', async () => {
  const { options, transition, paint } = setup()
  const error = new Error('shader failed')
  options.prepare.mockRejectedValueOnce(error)
  const task = transition.request()
  paint()
  await task
  expect(options.fail).toHaveBeenCalledWith(error)
  expect(options.finish).not.toHaveBeenCalled()
  expect(transition.pending).toBe(false)
})

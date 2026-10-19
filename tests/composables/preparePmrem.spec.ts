import { afterEach, expect, it, vi } from 'vitest'
import {
  Mesh,
  PerspectiveCamera,
  Texture,
  WebGLRenderTarget,
  type PMREMGenerator,
  type WebGLRenderer,
} from 'three'
import { preparePmrem } from '../../src/composables/renderer/preparePmrem'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  let complete = false
  const target = new WebGLRenderTarget(32, 32)
  const dispose = vi.spyOn(target, 'dispose')
  const render = vi.fn()
  const program = { program: {} }
  const programs: object[] = []
  const gl = {
    getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }),
    getProgramParameter: vi.fn(() => complete),
    isContextLost: () => false,
  }
  const renderer = {
    info: { programs },
    render,
    compile: vi.fn(() => {
      if (!programs.length) programs.push(program)
    }),
    getContext: () => gl,
  } as unknown as WebGLRenderer
  const generator = {
    fromEquirectangular: vi.fn((_texture: Texture, output?: WebGLRenderTarget) => {
      if (output) expect(output.scissorTest).toBe(true)
      renderer.render(new Mesh(), new PerspectiveCamera())
      const result = output ?? target
      result.scissorTest = false
      return result
    }),
  } as unknown as PMREMGenerator
  return {
    renderer,
    generator,
    target,
    dispose,
    render,
    gl,
    complete() {
      complete = true
      frames.shift()!(0)
    },
  }
}

it('submits the actual PMREM shaders first and yields before any filtering draw', async () => {
  const state = setup()
  const { renderer, generator, target, render } = state
  const texture = new Texture()
  const task = preparePmrem(renderer, generator, texture, () => false)
  expect(renderer.render).toBe(render)
  expect(renderer.compile).toHaveBeenCalledOnce()
  expect(render).not.toHaveBeenCalled()
  state.complete()
  expect(await task).toBe(target)
  expect(render).toHaveBeenCalledOnce()
  expect(generator.fromEquirectangular).toHaveBeenLastCalledWith(texture, target)
  target.dispose()
})

it('disposes an unpublished target on cancellation without drawing a pending program', async () => {
  const state = setup()
  let stale = false
  const task = preparePmrem(state.renderer, state.generator, new Texture(), () => stale)
  stale = true
  state.complete()
  expect(await task).toBeUndefined()
  expect(state.render).not.toHaveBeenCalled()
  expect(state.dispose).toHaveBeenCalledOnce()
})

it('restores the renderer when shader submission throws', async () => {
  const state = setup()
  vi.mocked(state.renderer.compile).mockImplementationOnce(() => {
    throw new Error('compile failed')
  })
  await expect(
    preparePmrem(state.renderer, state.generator, new Texture(), () => false)
  ).rejects.toThrow('compile failed')
  expect(state.renderer.render).toBe(state.render)
})

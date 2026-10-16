import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RenderContextOptions } from '@nuan5-pro/render'
import {
  furnitureRender,
  installFurnitureRender,
  readyFurnitureRender,
} from '../../src/composables/useFurnitureRender'

const state = vi.hoisted(() => ({ createLayer: vi.fn() }))
vi.mock('@nuan5-pro/render', () => ({
  createRenderContext: () => ({ beforeRender: vi.fn(), prepareScene: vi.fn(), dispose: vi.fn() }),
  createFurnitureLayer: () => state.createLayer(),
}))

const owners: ReturnType<typeof installFurnitureRender>[] = []
function install() {
  const owner = installFurnitureRender({} as RenderContextOptions)
  owners.push(owner)
  return owner
}

beforeEach(() => {
  state.createLayer.mockReset()
})
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose()
})

it('shares setup work and retries a failed manifest only when readiness is requested again', async () => {
  const layer = {
    setup: vi
      .fn()
      .mockRejectedValueOnce(new Error('manifest unavailable'))
      .mockResolvedValue(undefined),
    dispose: vi.fn(),
  }
  state.createLayer.mockReturnValue(layer)
  install()
  const results = await Promise.allSettled([readyFurnitureRender(), readyFurnitureRender()])
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect(layer.setup).toHaveBeenCalledTimes(1)
  expect(furnitureRender.value).toBeNull()
  await Promise.resolve()
  expect(layer.setup).toHaveBeenCalledTimes(1)

  expect(await readyFurnitureRender()).toBe(layer)
  expect(furnitureRender.value).toBe(layer)
  expect(await readyFurnitureRender()).toBe(layer)
  expect(layer.setup).toHaveBeenCalledTimes(2)
})

it('does not publish a disposed owner or clear its replacement when old setup settles late', async () => {
  let finish!: () => void
  const oldLayer = {
    setup: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    ),
    dispose: vi.fn(),
  }
  const newLayer = { setup: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() }
  state.createLayer.mockReturnValueOnce(oldLayer).mockReturnValueOnce(newLayer)
  const oldOwner = install()
  const pending = readyFurnitureRender()
  oldOwner.dispose()
  install()
  expect(await readyFurnitureRender()).toBe(newLayer)
  finish()
  await expect(pending).rejects.toThrow('Furniture render context disposed')
  oldOwner.dispose()
  expect(furnitureRender.value).toBe(newLayer)
  expect(await readyFurnitureRender()).toBe(newLayer)
})

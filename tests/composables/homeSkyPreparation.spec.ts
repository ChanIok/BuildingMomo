import { afterEach, expect, it, vi } from 'vitest'
import { type Mesh, type ShaderMaterial, type Texture, type WebGLRenderer } from 'three'
import { createHomeSky } from '../../src/composables/renderer/homeSky'
import { sampleHomeTod } from '../../src/lib/homeTod'

const clock = vi.hoisted(() => ({ value: 0 }))
vi.mock('@/lib/homeAtmosphere', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/homeAtmosphere')>()),
  sampleAtmosphere: () => {
    clock.value += 0.01
    return [1, 2, 3]
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  clock.value = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock.value)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  const sky = createHomeSky({} as WebGLRenderer)
  const dome = sky.root.getObjectByName('home-sky-dome') as Mesh
  const texture = (dome.material as ShaderMaterial).uniforms.atmosphere!.value as Texture
  return {
    sky,
    texture,
    frames,
    async drain() {
      while (frames.length) {
        frames.shift()!(0)
        await Promise.resolve()
      }
    },
  }
}

it('yields sky-table calculations and publishes a complete texture atomically', async () => {
  const { sky, texture, frames, drain } = setup()
  try {
    const task = sky.update(sampleHomeTod(720))
    expect(frames.length).toBe(1)
    expect(texture.version).toBe(0)
    expect((texture.image.data as Float32Array).every((value) => value === 0)).toBe(true)
    await drain()
    await task
    expect(texture.version).toBe(1)
    const count = (texture.image.data as Float32Array).filter(
      (_, index) => index % 4 === 3 && texture.image.data[index] === 1
    ).length
    expect(count).toBe(96 * 64)
    await sky.update(sampleHomeTod(720))
    expect(texture.version).toBe(1)
    expect(frames).toHaveLength(0)
    const superseded = sky.update(sampleHomeTod(360))
    await sky.update(sampleHomeTod(720))
    await drain()
    await superseded
    expect(texture.version).toBe(1)
  } finally {
    sky.dispose()
  }
})

it('does not publish superseded or disposed sky preparations', async () => {
  const { sky, texture, drain } = setup()
  const first = sky.update(sampleHomeTod(360))
  const latest = sky.update(sampleHomeTod(1080))
  await drain()
  await Promise.all([first, latest])
  expect(texture.version).toBe(1)
  const task = sky.update(sampleHomeTod(720))
  sky.dispose()
  await drain()
  await task
  expect(texture.version).toBe(1)
})

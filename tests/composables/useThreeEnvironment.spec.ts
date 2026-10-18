import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  Box3,
  BoxGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { createSceneEnvironment } from '../../src/composables/useThreeEnvironment'

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>()
  return {
    ...three,
    PMREMGenerator: class {
      fromScene() {
        return { texture: new three.Texture(), dispose: vi.fn() }
      }
      fromEquirectangular() {
        return this.fromScene()
      }
      dispose() {}
    },
  }
})
vi.mock('@nuan5-pro/render', () => ({
  setEnvironmentDiffuseWeight: vi.fn(),
  setEnvironmentReflection: vi.fn(),
}))
vi.mock('@/composables/renderer/homeSky', () => ({
  createHomeSky: () => ({
    root: new Group(),
    dispose: vi.fn(),
    update: vi.fn(),
    load: async () => {},
  }),
}))
vi.mock('three/addons/loaders/HDRLoader.js', () => ({
  HDRLoader: class {
    async loadAsync() {
      return new Texture()
    }
  },
}))
vi.mock('@/composables/renderer/homeOutput', () => ({ updateHomeOutput: vi.fn() }))
vi.mock('@/composables/renderer/preparePmrem', () => ({
  preparePmrem: async (
    _renderer: unknown,
    generator: { fromEquirectangular(texture: Texture): unknown },
    texture: Texture
  ) => generator.fromEquirectangular(texture),
}))

let scene: Scene
let renderer: WebGLRenderer
let environment: ReturnType<typeof createSceneEnvironment>
let sun: DirectionalLight
const invalidate = vi.fn()

beforeEach(() => {
  scene = new Scene()
  renderer = {
    toneMapping: 3,
    toneMappingExposure: 0.8,
    capabilities: { maxTextureSize: 8192 },
    shadowMap: { enabled: true, needsUpdate: false },
  } as unknown as WebGLRenderer
  environment = createSceneEnvironment(renderer, scene, invalidate)
  sun = scene.getObjectByName('editor-environment-sun') as DirectionalLight
  sun.shadow.camera.up.set(0, 0, 1)
  environment.update('studio', 720)
  invalidate.mockClear()
})

afterEach(() => {
  environment.dispose()
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      const material = object.material as MeshBasicMaterial
      material.dispose()
    }
  })
})

function addIsland() {
  const terrain = new Mesh(new BoxGeometry(50000, 40000, 6000), new MeshBasicMaterial())
  terrain.position.set(-2000, -18000, -1000)
  terrain.receiveShadow = true
  scene.add(terrain)
  return terrain
}

function expectShadowCoverage(bounds: Box3) {
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const clip = new Vector3(x, y, z).project(sun.shadow.camera)
        expect(Math.abs(clip.x)).toBeLessThan(1)
        expect(Math.abs(clip.y)).toBeLessThan(1)
        expect(Math.abs(clip.z)).toBeLessThan(1)
      }
    }
  }
}

it('covers the whole island and world-transformed furniture instances, not a local camera window', () => {
  const terrain = addIsland()
  const furniture = new InstancedMesh(new BoxGeometry(200, 300, 1000), new MeshBasicMaterial(), 2)
  furniture.setMatrixAt(0, new Matrix4().makeTranslation(35000, 16000, 5000))
  furniture.setMatrixAt(1, new Matrix4().makeTranslation(-40000, -10000, 12000))
  furniture.castShadow = true
  const root = new Group()
  root.scale.y = -1
  root.add(furniture)
  scene.add(root)

  environment.beforeRender()

  expectShadowCoverage(new Box3().setFromObject(terrain))
  expectShadowCoverage(new Box3().setFromObject(furniture))
  expect(sun.shadow.mapSize.toArray()).toEqual([4096, 4096])
  expect(renderer.shadowMap.needsUpdate).toBe(true)
})

it('keeps the shadow volume fixed when navigating and excludes distant non-shadow geometry', () => {
  addIsland()
  environment.beforeRender()
  const position = sun.position.clone()
  const projection = sun.shadow.camera.projectionMatrix.clone()
  const backdrop = new Mesh(new BoxGeometry(1e7, 1e7, 1e7), new MeshBasicMaterial())
  scene.add(backdrop)
  const camera = new PerspectiveCamera()
  scene.add(camera)
  renderer.shadowMap.needsUpdate = false
  invalidate.mockClear()
  const traverse = vi.spyOn(scene, 'traverseVisible')
  const matrices = vi.spyOn(scene, 'updateMatrixWorld')

  for (let frame = 0; frame < 30; frame++) {
    camera.position.set(frame * 1000, -frame * 2000, frame * 100)
    environment.beforeRender()
    expect(sun.position.equals(position)).toBe(true)
    expect(sun.shadow.camera.projectionMatrix.equals(projection)).toBe(true)
    expect(renderer.shadowMap.needsUpdate).toBe(false)
  }
  expect(invalidate).not.toHaveBeenCalled()
  expect(traverse).not.toHaveBeenCalled()
  expect(matrices).not.toHaveBeenCalled()
})

it('refits immediately when terrain loads or furniture extends beyond the current world bounds', () => {
  environment.beforeRender()
  const terrain = addIsland()
  renderer.shadowMap.needsUpdate = true
  environment.beforeRender()
  expectShadowCoverage(new Box3().setFromObject(terrain))
  expect(renderer.shadowMap.needsUpdate).toBe(true)

  const furniture = new Mesh(new BoxGeometry(2000, 2000, 6000), new MeshBasicMaterial())
  furniture.castShadow = true
  furniture.position.set(90000, 50000, 15000)
  scene.add(furniture)
  renderer.shadowMap.needsUpdate = true
  environment.beforeRender()

  expectShadowCoverage(new Box3().setFromObject(terrain))
  expectShadowCoverage(new Box3().setFromObject(furniture))
  expect(renderer.shadowMap.needsUpdate).toBe(true)
})

it('fits the full depth range after changes to the sun direction', async () => {
  const terrain = addIsland()
  environment.beforeRender()
  for (const minute of [0, 360, 720, 1080]) {
    environment.update('home', minute)
    expectShadowCoverage(new Box3().setFromObject(terrain))
    expect(sun.shadow.camera.near).toBeGreaterThan(0)
  }
  await Promise.resolve()
})

it('refits after casters are hidden or removed', () => {
  addIsland()
  environment.beforeRender()
  const islandProjection = sun.shadow.camera.projectionMatrix.clone()
  const caster = new Mesh(new BoxGeometry(1000, 1000, 1000), new MeshBasicMaterial())
  caster.position.set(150000, 100000, 50000)
  caster.castShadow = true
  scene.add(caster)
  renderer.shadowMap.needsUpdate = true
  environment.beforeRender()
  expect(sun.shadow.camera.projectionMatrix.equals(islandProjection)).toBe(false)
  caster.visible = false
  renderer.shadowMap.needsUpdate = true
  environment.beforeRender()
  expect(sun.shadow.camera.projectionMatrix.equals(islandProjection)).toBe(true)
  caster.visible = true
  renderer.shadowMap.needsUpdate = true
  environment.beforeRender()
  caster.removeFromParent()
  renderer.shadowMap.needsUpdate = true
  environment.beforeRender()
  expect(sun.shadow.camera.projectionMatrix.equals(islandProjection)).toBe(true)
  caster.geometry.dispose()
  caster.material.dispose()
})

it('toggles shadow rendering independently and refits changes made while disabled', () => {
  const terrain = addIsland()
  environment.beforeRender()
  const lightColor = sun.color.clone()
  const intensity = sun.intensity
  const version = terrain.material.version
  environment.setShadowsEnabled(false)
  expect(renderer.shadowMap.enabled).toBe(false)
  expect(terrain.material.version).toBe(version + 1)
  terrain.position.x += 70000
  environment.beforeRender()

  environment.setShadowsEnabled(true)
  environment.beforeRender()

  expect(renderer.shadowMap.enabled).toBe(true)
  expect(terrain.material.version).toBe(version + 2)
  expect(renderer.shadowMap.needsUpdate).toBe(true)
  expectShadowCoverage(new Box3().setFromObject(terrain))
  expect(sun.color.equals(lightColor)).toBe(true)
  expect(sun.intensity).toBe(intensity)
})

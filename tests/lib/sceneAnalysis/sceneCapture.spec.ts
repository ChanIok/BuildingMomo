import { afterEach, expect, it, vi } from 'vitest'
import {
  Box3,
  BoxGeometry,
  Color,
  CustomToneMapping,
  DirectionalLight,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Scene,
  ShaderChunk,
  Vector3,
  Vector4,
} from 'three'
import {
  buildAnalysisCaptureGroup,
  createSceneCapture,
  frameAnalysisCamera,
  readAnalysisPixels,
} from '@/composables/renderer/sceneCapture'
import type { AnalysisRenderSnapshot } from '@/lib/sceneAnalysis/images'
import { homeOutputUniforms, updateHomeOutput } from '@/composables/renderer/homeOutput'
import { sampleHomeTod } from '@/lib/homeTod'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function boxCorners(...bounds: Box3[]) {
  const points: Vector3[] = []
  for (const box of bounds)
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z))
  return points
}

function fixture() {
  const geometry = new BoxGeometry(2, 2, 2)
  const material = new MeshBasicMaterial({ alphaTest: 0.4, transparent: true })
  const mesh = new InstancedMesh(geometry, material, 3)
  mesh.scale.y = -1
  mesh.updateMatrixWorld(true)
  for (let i = 0; i < 3; i++) {
    mesh.setMatrixAt(i, new Matrix4().makeTranslation(i * 10, 20, 0))
    mesh.setColorAt(i, new Color('#ff0000'))
  }
  const snapshot: AnalysisRenderSnapshot = {
    snapshotId: 's',
    items: [
      {
        itemId: 'a',
        gameId: 1,
        worldMatrix: new Matrix4().makeTranslation(20, -20, 0).toArray(),
        points: null,
        bounds: {
          source: 'model-aabb',
          min: { x: 19, y: -21, z: -1 },
          max: { x: 21, y: -19, z: 1 },
        },
      },
      { itemId: 'missing', gameId: 2, worldMatrix: null, points: null, bounds: null },
    ],
  }
  return { geometry, material, mesh, snapshot }
}

it('borrows exact alpha/dye materials with original slots and reflected parent matrix; never disposes shared assets', () => {
  const { geometry, material, mesh, snapshot } = fixture()
  const geometryDispose = vi.spyOn(geometry, 'dispose'),
    materialDispose = vi.spyOn(material, 'dispose')
  const originalMatrices = mesh.instanceMatrix.array.slice(),
    originalColors = mesh.instanceColor!.array.slice()
  const capture = buildAnalysisCaptureGroup(
    { getInstance: (id) => (id === 'a' ? { mesh, index: 2 } : undefined) },
    snapshot,
    { itemIds: ['a', 'missing'] }
  )
  const borrowed = capture.group.children.find(
    (object) => object instanceof InstancedMesh
  ) as InstancedMesh
  expect(capture.group.children).toEqual([borrowed])
  expect(borrowed.geometry).toBe(geometry)
  expect(borrowed.material).toBe(material)
  expect(borrowed.count).toBe(3)
  expect(borrowed.matrix.equals(mesh.matrixWorld)).toBe(true)
  const matrix = new Matrix4()
  borrowed.getMatrixAt(0, matrix)
  expect(matrix.determinant()).toBe(0)
  borrowed.getMatrixAt(2, matrix)
  expect(new Matrix4().multiplyMatrices(borrowed.matrix, matrix).elements).toEqual(
    snapshot.items[0]!.worldMatrix
  )
  const color = new Color()
  borrowed.getColorAt(2, color)
  expect(color.toArray()).toEqual([1, 1, 1])
  expect(capture).toMatchObject({ renderedItemIds: ['a'], missingItemIds: ['missing'] })
  capture.dispose()
  expect(geometryDispose).not.toHaveBeenCalled()
  expect(materialDispose).not.toHaveBeenCalled()
  expect(mesh.instanceMatrix.array).toEqual(originalMatrices)
  expect(mesh.instanceColor!.array).toEqual(originalColors)
  geometry.dispose()
  material.dispose()
  mesh.dispose()
})

it('fits all bound corners with perspective cameras at arbitrary angles, fields of view and aspect ratios', () => {
  const bounds = new Box3(new Vector3(-200, -1, 20), new Vector3(400, 1, 21))
  for (const azimuth of [0, 35, 120, 225, 310])
    for (const elevation of [-35, 0, 25, 90])
      for (const aspect of [0.5, 2]) {
        const camera = frameAnalysisCamera(
          boxCorners(bounds),
          { azimuth, elevation, fov: 60 },
          aspect
        )
        expect(camera.isPerspectiveCamera).toBe(true)
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
              const p = new Vector3(x, y, z).project(camera)
              expect(Math.abs(p.x)).toBeLessThan(1)
              expect(Math.abs(p.y)).toBeLessThan(1)
              expect(Math.abs(p.z)).toBeLessThan(1)
            }
      }
})
it('honors an explicit camera target and distance instead of silently reframing the whole scene', () => {
  const bounds = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
  const camera = frameAnalysisCamera(boxCorners(bounds), {
    target: { x: 10, y: 20, z: 30 },
    distance: 100,
    azimuth: 90,
    elevation: 0,
    fov: 70,
  })
  expect(camera.position.x).toBeCloseTo(10)
  expect(camera.position.y).toBeCloseTo(120)
  expect(camera.position.z).toBeCloseTo(30)
  expect(camera.fov).toBe(70)
})

it('does not fit the empty corners between separate instances', () => {
  const bounds = [-100, 100].map(
    (value) => new Box3(new Vector3(value - 1, value - 1, -1), new Vector3(value + 1, value + 1, 1))
  )
  const points = boxCorners(...bounds)
  const union = new Box3().setFromPoints(points)
  const settings = { azimuth: 45, elevation: 0, fov: 60 }
  const camera = frameAnalysisCamera(points, settings, 1)
  const conservative = frameAnalysisCamera(boxCorners(union), settings, 1)
  expect(camera.userData.analysis.distance).toBeLessThan(
    conservative.userData.analysis.distance * 0.7
  )
})

it.each([1, 0])(
  'frames loaded local geometry through reflected/scaled display matrices (Z scale %s), not its world AABB',
  (zScale) => {
    const { geometry, material, mesh, snapshot } = fixture()
    geometry.computeBoundingBox()
    const matrix = new Matrix4()
      .makeRotationZ(Math.PI / 4)
      .scale(new Vector3(-20, 2, zScale))
      .setPosition(20, -20, 0)
    const worldBox = geometry.boundingBox!.clone().applyMatrix4(matrix)
    const item = {
      ...snapshot.items[0]!,
      worldMatrix: matrix.toArray(),
      bounds: { source: 'model-aabb' as const, min: worldBox.min, max: worldBox.max },
    }
    const capture = buildAnalysisCaptureGroup(
      { getInstance: () => ({ mesh, index: 2 }) },
      { snapshotId: 's', items: [item] },
      { itemIds: ['a'] }
    )
    const points = capture.framingPoints.get('a')!
    const expected = boxCorners(geometry.boundingBox!).map((point) => point.applyMatrix4(matrix))
    expect(points).toHaveLength(8)
    for (const point of points)
      expect(expected.some((candidate) => candidate.distanceTo(point) < 1e-9)).toBe(true)
    const settings = { azimuth: 45, elevation: 0, fov: 60 }
    const camera = frameAnalysisCamera(points, settings, 1, capture.bounds)
    expect(camera.userData.analysis.distance).toBeLessThan(
      frameAnalysisCamera(boxCorners(worldBox), settings, 1).userData.analysis.distance * 0.8
    )
    for (const point of points) {
      const projected = point.clone().project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(1)
      expect(Math.abs(projected.y)).toBeLessThan(1)
      expect(Math.abs(projected.z)).toBeLessThan(1)
    }
    capture.dispose()
    geometry.dispose()
    material.dispose()
    mesh.dispose()
  }
)

it('fits an explicit target automatically, while visible surroundings only extend clipping', () => {
  const bounds = [new Box3(new Vector3(-20, -10, -5), new Vector3(20, 10, 5))]
  const settings = { target: { x: 30, y: -15, z: 8 }, azimuth: 130, elevation: 25 }
  const camera = frameAnalysisCamera(boxCorners(...bounds), settings)
  const surrounding = frameAnalysisCamera(
    boxCorners(...bounds),
    settings,
    1,
    new Box3(new Vector3(-1000, -1000, -1000), new Vector3(1000, 1000, 1000))
  )
  expect(surrounding.position.toArray()).toEqual(camera.position.toArray())
  expect(surrounding.far).toBeGreaterThan(camera.far)
  expect(camera.userData.analysis.target).toEqual(settings.target)
  for (const x of [-20, 20])
    for (const y of [-10, 10])
      for (const z of [-5, 5]) {
        const point = new Vector3(x, y, z).project(camera)
        expect(Math.abs(point.x)).toBeLessThan(1)
        expect(Math.abs(point.y)).toBeLessThan(1)
        expect(Math.abs(point.z)).toBeLessThan(1)
      }
})

it('renders detached world-space paths using shared segment geometry without original items', () => {
  const capture = buildAnalysisCaptureGroup(
    { getInstance: () => undefined },
    {
      snapshotId: 's',
      items: [
        {
          itemId: 'path',
          gameId: 1,
          worldMatrix: null,
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 200, y: 0, z: 100 },
          ],
          bounds: {
            source: 'slide-path',
            min: { x: -100, y: -100, z: -100 },
            max: { x: 300, y: 100, z: 200 },
          },
        },
      ],
    },
    { itemIds: ['path'] }
  )
  expect(capture.group.children).toHaveLength(1)
  expect(capture.renderedItemIds).toEqual(['path'])
  capture.dispose()
})

function rendererMock() {
  const state = {
    target: { name: 'user-target' } as unknown,
    viewport: new Vector4(2, 3, 400, 300),
    scissor: new Vector4(4, 5, 200, 100),
    test: true,
    color: new Color('#123456'),
    alpha: 0.4,
  }
  const renderer = {
    outputColorSpace: 'srgb',
    toneMapping: 3,
    toneMappingExposure: 0.8,
    extensions: { has: () => true },
    debug: {
      checkShaderErrors: false,
      onShaderError: null as ((...args: unknown[]) => void) | null,
    },
    xr: { enabled: true },
    shadowMap: { enabled: true, autoUpdate: false, needsUpdate: true },
    autoClear: false,
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    getViewport: (v: Vector4) => v.copy(state.viewport),
    getScissor: (v: Vector4) => v.copy(state.scissor),
    getScissorTest: () => state.test,
    getClearColor: (v: Color) => v.copy(state.color),
    getClearAlpha: () => state.alpha,
    setRenderTarget: vi.fn((target: unknown) => {
      state.target = target
    }),
    setViewport: (v: Vector4 | number, y?: number, w?: number, h?: number) => {
      if (v instanceof Vector4) state.viewport.copy(v)
      else state.viewport.set(v, y!, w!, h!)
    },
    setScissor: (v: Vector4) => state.scissor.copy(v),
    setScissorTest: (v: boolean) => {
      state.test = v
    },
    setClearColor: (v: Color | string, alpha: number) => {
      state.color.set(v)
      state.alpha = alpha
    },
    render: vi.fn(),
    readRenderTargetPixels: vi.fn(),
  }
  return { renderer, state }
}

it.each([
  'success',
  'draw-failure',
  'read-failure',
  'prepare-failure',
  'shader-failure',
  'model-shader-failure',
])('restores scene identity/content and every leased renderer state on %s', (mode) => {
  const { renderer, state } = rendererMock()
  const original = {
    ...state,
    viewport: state.viewport.clone(),
    scissor: state.scissor.clone(),
    color: state.color.clone(),
  }
  const scene = new Scene(),
    originalGroup = new Group(),
    light = new DirectionalLight()
  scene.add(originalGroup, light, light.target)
  scene.background = new Color('#abcdef')
  const children = scene.children,
    background = scene.background
  const group = new Group(),
    camera = frameAnalysisCamera(
      boxCorners(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))),
      {}
    )
  const previousShaderError = vi.fn()
  const finishedDraw = vi.fn()
  function failShader() {
    renderer.debug.onShaderError!(
      {
        getProgramInfoLog: () => 'Fragment shader is not compiled',
        getShaderInfoLog: () => 'mix: no matching overloaded function',
      },
      {},
      {},
      {}
    )
    finishedDraw() // Our error hook must not interrupt Three's render cleanup.
  }
  renderer.debug.onShaderError = previousShaderError
  renderer.render.mockImplementation((...args: unknown[]) => {
    if (args[0] !== scene) {
      // The standard final output pass draws a fullscreen mesh, not the source scene.
      expect(args[0]).toHaveProperty('isMesh', true)
      expect((args[0] as { material: { defines: object } }).material.defines).toMatchObject({
        SRGB_TRANSFER: '',
        CINEON_TONE_MAPPING: '',
      })
      if (mode === 'shader-failure') failShader()
      return
    }
    expect(args[0]).toBe(scene)
    expect(scene.children).toEqual([group])
    expect(scene.children).not.toContain(originalGroup)
    expect(renderer.shadowMap.enabled).toBe(false)
    expect(state.target).toHaveProperty('texture.type', HalfFloatType)
    if (mode === 'draw-failure') throw new Error('draw')
    if (mode === 'model-shader-failure') failShader()
  })
  if (mode === 'read-failure')
    renderer.readRenderTargetPixels.mockImplementation(() => {
      throw new Error('read')
    })
  const draw = () =>
    readAnalysisPixels(renderer as never, scene, camera, group, () => {
      if (mode === 'prepare-failure') throw new Error('prepare')
    })
  if (mode === 'success') expect(draw()).toHaveLength(1024 * 1024 * 4)
  else if (mode === 'shader-failure' || mode === 'model-shader-failure') {
    expect(draw).toThrow(/Scene capture shader compilation failed/)
    expect(previousShaderError).toHaveBeenCalledOnce()
    expect(finishedDraw).toHaveBeenCalledOnce()
    expect(renderer.render).toHaveBeenCalledTimes(mode === 'model-shader-failure' ? 1 : 2)
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled()
  } else expect(draw).toThrow()
  expect(scene.children).toBe(children)
  expect(scene.background).toBe(background)
  expect(originalGroup.parent).toBe(scene)
  expect(group.parent).toBeNull()
  expect(state).toEqual(original)
  expect(renderer.xr.enabled).toBe(true)
  expect(renderer.shadowMap).toEqual({ enabled: true, autoUpdate: false, needsUpdate: true })
  expect(renderer.autoClear).toBe(false)
  expect(renderer.debug.checkShaderErrors).toBe(false)
  expect(renderer.debug.onShaderError).toBe(previousShaderError)
  expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(original.target, 2, 1)
})

it('uses ES 1.00 numeric mix selectors in the shared home curve and binds home uniforms to the raw output pass', () => {
  const originalChunk = ShaderChunk.tonemapping_pars_fragment
  const { renderer } = rendererMock()
  const scene = new Scene()
  try {
    updateHomeOutput(renderer as never, sampleHomeTod(720))
    expect(renderer.toneMapping).toBe(CustomToneMapping)
    expect(ShaderChunk.tonemapping_pars_fragment).toContain(
      'mix(straight, low, vec3(lessThan(logColor, vec3(toeMatch))))'
    )
    expect(ShaderChunk.tonemapping_pars_fragment).toContain(
      'mix(straight, high, vec3(greaterThan(logColor, vec3(shoulderMatch))))'
    )
    renderer.render.mockImplementation((...args: unknown[]) => {
      if (args[0] === scene) return
      const material = (
        args[0] as {
          material: {
            glslVersion: string | null
            defines: object
            uniforms: Record<string, { value: unknown }>
            fragmentShader: string
          }
        }
      ).material
      expect(material.glslVersion).toBeNull() // OutputPass remains GLSL ES 1.00.
      expect(material.defines).toMatchObject({ CUSTOM_TONE_MAPPING: '', SRGB_TRANSFER: '' })
      expect(material.fragmentShader).toContain('#include <tonemapping_pars_fragment>')
      expect(material.uniforms.editorHomeFilm).toBe(
        homeOutputUniforms(renderer as never).editorHomeFilm
      )
      expect(material.uniforms.editorHomeGamma).toBe(
        homeOutputUniforms(renderer as never).editorHomeGamma
      )
      expect(material.uniforms.toneMappingExposure?.value).toBe(renderer.toneMappingExposure)
    })
    readAnalysisPixels(
      renderer as never,
      scene,
      frameAnalysisCamera(boxCorners(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))), {}),
      new Group(),
      () => {}
    )
    expect(renderer.render).toHaveBeenCalledTimes(2)
  } finally {
    ShaderChunk.tonemapping_pars_fragment = originalChunk
  }
})

it.each([false, true])(
  'captures square defaults or explicit dimensions (%s), serializes encoding and skips cancelled work',
  async (explicitSize) => {
    const width = explicitSize ? 640 : 1024,
      height = explicitSize ? 480 : 1024
    const { mesh, snapshot, geometry, material } = fixture()
    const { renderer } = rendererMock()
    let encode!: (blob: Blob) => void
    let encodingCamera: unknown
    const originalCamera = {},
      pixels: { data: Uint8ClampedArray }[] = []
    let currentCamera: unknown = originalCamera
    const context = {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => pixels.push(image),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 32 }),
    }
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob(callback: (blob: Blob) => void) {
          encodingCamera = currentCamera
          encode = callback
        },
      }),
    })
    const glRenderer = { ...renderer, getContext: () => ({ isContextLost: () => false }) }
    glRenderer.readRenderTargetPixels.mockImplementation(
      (_target: unknown, _x: number, _y: number, w: number, h: number, bytes: Uint8Array) => {
        bytes[0] = 42
        bytes[(h - 1) * w * 4] = 99
      }
    )
    const provider = createSceneCapture({
      renderer: glRenderer as never,
      scene: new Scene(),
      getLayer: () => ({ getInstance: () => ({ mesh, index: 2 }) }) as never,
      isReady: () => true,
      beforeRender() {},
      invalidate() {},
      getRevision: () => 0,
      withCamera(camera, draw) {
        expect(camera).toMatchObject({ isPerspectiveCamera: true, fov: 60, aspect: width / height })
        const previous = currentCamera
        currentCamera = camera
        try {
          return draw()
        } finally {
          currentCamera = previous
        }
      },
    })
    const firstController = new AbortController(),
      secondController = new AbortController()
    const request = {
      itemIds: ['a'],
      camera: { fov: 60 },
      ...(explicitSize ? { width, height } : {}),
      labels: { a: '1000' },
    }
    const first = provider.render(snapshot, request, {
      signal: firstController.signal,
      assertCurrent() {},
    })
    const second = provider.render(snapshot, request, {
      signal: secondController.signal,
      assertCurrent() {},
    })
    const secondResult = expect(second).rejects.toMatchObject({ code: 'cancelled' })
    await Promise.resolve()
    expect(glRenderer.render).toHaveBeenCalledTimes(2)
    expect(encodingCamera).toBe(originalCamera)
    expect(context.fillText).toHaveBeenCalledWith('1000', expect.any(Number), expect.any(Number))
    // Only requested item labels are baked in, never a diagnostic text/bar.
    expect(context.fillText).toHaveBeenCalledTimes(1)
    expect(context.fillRect).toHaveBeenCalledTimes(1)
    expect(context.fillRect).not.toHaveBeenCalledWith(0, 0, width, 32)
    expect(pixels[0]?.data[0]).toBe(99)
    expect(pixels[0]?.data[(height - 1) * width * 4]).toBe(42)
    secondController.abort()
    encode(new Blob(['png'], { type: 'image/png' }))
    expect(await first).toMatchObject({
      width,
      height,
      details: {
        renderedItemIds: ['a'],
        missingItemIds: [],
        camera: { projection: 'perspective' },
        shadows: false,
      },
    })
    await secondResult
    expect(glRenderer.render).toHaveBeenCalledTimes(2)
    provider.dispose()
    await expect(
      provider.render(snapshot, request, { signal: firstController.signal, assertCurrent() {} })
    ).rejects.toMatchObject({ code: 'cancelled' })
    geometry.dispose()
    material.dispose()
    mesh.dispose()
  }
)

it('tints capture-owned instance colors without changing source buffers or materials', () => {
  const { mesh, snapshot, geometry, material } = fixture(),
    before = mesh.instanceColor!.array.slice()
  const capture = buildAnalysisCaptureGroup({ getInstance: () => ({ mesh, index: 2 }) }, snapshot, {
    itemIds: ['a'],
    color: '#2288cc',
  })
  const temporary = capture.group.children.find((o) => o instanceof InstancedMesh) as InstancedMesh
  const color = new Color()
  temporary.getColorAt(2, color)
  expect(color.getHexString()).toBe('2288cc')
  capture.dispose()
  expect(mesh.instanceColor!.array).toEqual(before)
  expect(temporary.material).toBe(material)
  geometry.dispose()
  material.dispose()
  mesh.dispose()
})

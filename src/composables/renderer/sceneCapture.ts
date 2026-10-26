import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  Light,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { FurnitureLayer } from '@nuan5-pro/render/furniture'
import { buildSlidePathSegmentLocalMatrix } from '@/lib/slidePath'
import { SceneAnalysisError } from '@/lib/sceneAnalysis/types'
import { homeOutputUniforms } from './homeOutput'
import {
  assertImageTask,
  canvasPng,
  createAnalysisCanvas,
  type AnalysisCaptureProvider,
  type AnalysisRenderSnapshot,
  type AnalysisCamera,
  type AnalysisViewRequest,
} from '@/lib/sceneAnalysis/images'

function captureBoxCorners(box: Box3, matrix = new Matrix4()) {
  const corners: Vector3[] = []
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        corners.push(new Vector3(x, y, z).applyMatrix4(matrix))
      }
  return corners
}

export function frameAnalysisCamera(
  corners: readonly Vector3[],
  settings: AnalysisCamera = {},
  aspect = 1,
  visibleBounds = corners.reduce((box, point) => box.expandByPoint(point), new Box3())
) {
  const fov = settings.fov ?? 45
  const tanVertical = Math.tan((fov * Math.PI) / 360),
    tanHorizontal = tanVertical * aspect
  const azimuth = ((settings.azimuth ?? 45) * Math.PI) / 180,
    elevation = ((settings.elevation ?? 25) * Math.PI) / 180
  const direction = new Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation)
  )
  const camera = new PerspectiveCamera(fov, aspect)
  camera.up.set(0, 0, 1)
  if (Math.abs(Math.cos(elevation)) < 1e-8) camera.up.set(-Math.cos(azimuth), -Math.sin(azimuth), 0)
  camera.position.copy(direction)
  camera.lookAt(new Vector3())
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
  // Center in this viewing direction, not at the union's world-axis center.
  const viewBounds = new Box3()
  for (const point of corners)
    viewBounds.expandByPoint(new Vector3(point.dot(right), point.dot(up), point.dot(direction)))
  const center = viewBounds.getCenter(new Vector3())
  const target = settings.target
    ? new Vector3(settings.target.x, settings.target.y, settings.target.z)
    : right
        .clone()
        .multiplyScalar(center.x)
        .addScaledVector(up, center.y)
        .addScaledVector(direction, center.z)
  let fit = 0.01
  // Fit actual instance corners; union AABB corners can describe large empty regions.
  for (const point of corners) {
    const delta = point.clone().sub(target)
    fit = Math.max(
      fit,
      delta.dot(direction) +
        Math.max(Math.abs(delta.dot(right)) / tanHorizontal, Math.abs(delta.dot(up)) / tanVertical)
    )
  }
  const distance = settings.distance ?? fit * 1.08
  camera.near = Math.min(0.1, distance / 100)
  camera.far =
    distance +
    visibleBounds.getSize(new Vector3()).length() +
    target.distanceTo(visibleBounds.getCenter(new Vector3())) +
    1
  camera.position.copy(target).addScaledVector(direction, distance)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  camera.userData.analysis = {
    target: { x: target.x, y: target.y, z: target.z },
    azimuth: settings.azimuth ?? 45,
    elevation: settings.elevation ?? 25,
    distance,
    fov,
  }
  return camera
}

/** Temporary instance slots retain original indexes: dye uniforms reference the
 * source batch's per-instance texture. Compacting the subset would miscolour it.
 * Geometry/material are borrowed; only instance buffers/helpers are owned here.
 */
export function buildAnalysisCaptureGroup(
  layer: Pick<FurnitureLayer, 'getInstance'>,
  snapshot: AnalysisRenderSnapshot,
  request: AnalysisViewRequest
) {
  const group = new Group()
  const meshes = new Map<InstancedMesh, InstancedMesh>()
  const owned: { dispose(): void }[] = []
  const bounds = new Box3()
  const framingPoints = new Map<string, Vector3[]>()
  const renderedItemIds: string[] = [],
    missingItemIds: string[] = []
  const wanted = new Set(request.itemIds)
  const zero = new Matrix4().makeScale(0, 0, 0)
  let pathGeometry: BoxGeometry | undefined, pathMaterial: MeshBasicMaterial | undefined
  try {
    for (const item of snapshot.items) {
      if (!wanted.has(item.itemId)) continue
      let rendered = false
      let corners: Vector3[] | undefined
      if (item.points && item.points.length > 1) {
        if (!pathGeometry) {
          pathGeometry = new BoxGeometry(1, 1, 1)
          owned.push(pathGeometry)
        }
        if (!pathMaterial) {
          pathMaterial = new MeshBasicMaterial({ color: request.color ?? '#a7b9cf' })
          owned.push(pathMaterial)
        }
        for (let i = 1; i < item.points.length; i++) {
          const a = item.points[i - 1]!,
            b = item.points[i]!
          const matrix = buildSlidePathSegmentLocalMatrix(
            new Vector3(a.x, a.y, a.z),
            new Vector3(b.x, b.y, b.z)
          )
          if (!matrix) continue
          const segment = new Mesh(pathGeometry, pathMaterial)
          segment.matrixAutoUpdate = false
          segment.matrix.copy(matrix)
          group.add(segment)
          rendered = true
        }
      } else if (item.worldMatrix) {
        const source = layer.getInstance(item.itemId)
        if (source && source.index >= 0 && source.index < source.mesh.count) {
          let mesh = meshes.get(source.mesh)
          if (!mesh) {
            source.mesh.updateWorldMatrix(true, false)
            mesh = new InstancedMesh(source.mesh.geometry, source.mesh.material, source.mesh.count)
            owned.push(mesh)
            mesh.matrixAutoUpdate = false
            mesh.matrix.copy(source.mesh.matrixWorld)
            mesh.frustumCulled = false
            mesh.renderOrder = source.mesh.renderOrder
            for (let i = 0; i < source.mesh.count; i++) {
              mesh.setMatrixAt(i, zero)
              mesh.setColorAt(i, new Color(1, 1, 1))
            }
            meshes.set(source.mesh, mesh)
            group.add(mesh)
          }
          if (request.color) mesh.setColorAt(source.index, new Color(request.color))
          mesh.setMatrixAt(
            source.index,
            new Matrix4()
              .copy(mesh.matrix)
              .invert()
              .multiply(new Matrix4().fromArray(item.worldMatrix))
          )
          mesh.instanceMatrix.needsUpdate = true
          // Use the loaded geometry's local box and the exact display matrix;
          // a rotated world AABB adds another layer of empty space.
          if (source.mesh.geometry.boundingBox)
            corners = captureBoxCorners(
              source.mesh.geometry.boundingBox,
              new Matrix4().fromArray(item.worldMatrix)
            )
          rendered = true
        }
      }
      if (!rendered || !item.bounds) {
        missingItemIds.push(item.itemId)
        continue
      }
      renderedItemIds.push(item.itemId)
      const box = new Box3(
        new Vector3(item.bounds.min.x, item.bounds.min.y, item.bounds.min.z),
        new Vector3(item.bounds.max.x, item.bounds.max.y, item.bounds.max.z)
      )
      bounds.union(box)
      framingPoints.set(item.itemId, corners ?? captureBoxCorners(box))
    }
    return {
      group,
      bounds,
      framingPoints,
      renderedItemIds,
      missingItemIds,
      dispose() {
        for (const resource of owned) resource.dispose()
      },
    }
  } catch (error) {
    for (const resource of owned) resource.dispose()
    throw error
  }
}

/** A synchronous draw/readback lease on the existing scene/context. Native
 * materials require that exact scene identity. Restore the scene children and
 * framebuffer in finally, BEFORE any asynchronous PNG encoding can yield.
 */
export function readAnalysisPixels(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  group: Group,
  beforeRender: () => void,
  size = { width: 1024, height: 1024 }
) {
  const { width, height } = size
  // Three disables tone mapping/output transfer on ordinary render targets.
  // Keep HDR linear until the standard OutputPass applies the viewport curve
  // and sRGB transfer (including our existing home film uniforms).
  const hdr = new WebGLRenderTarget(width, height, { depthBuffer: true, type: HalfFloatType })
  const target = new WebGLRenderTarget(width, height, { depthBuffer: false })
  const output = new OutputPass()
  Object.assign(output.uniforms, homeOutputUniforms(renderer))
  const state = {
    target: renderer.getRenderTarget(),
    face: renderer.getActiveCubeFace(),
    level: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()),
    scissorTest: renderer.getScissorTest(),
    clear: renderer.getClearColor(new Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    xr: renderer.xr.enabled,
    shadows: renderer.shadowMap.enabled,
    shadowAuto: renderer.shadowMap.autoUpdate,
    shadowNeeds: renderer.shadowMap.needsUpdate,
    checkShaderErrors: renderer.debug.checkShaderErrors,
    onShaderError: renderer.debug.onShaderError,
    children: scene.children,
    background: scene.background,
    fog: scene.fog,
    override: scene.overrideMaterial,
  }
  const pixels = new Uint8Array(width * height * 4)
  let shaderError: SceneAnalysisError | null = null
  try {
    // Three normally logs failed programs and continues drawing. A tool must
    // reject instead of publishing an apparently successful blank PNG.
    renderer.debug.checkShaderErrors = true
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      const log = [
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertexShader),
        gl.getShaderInfoLog(fragmentShader),
      ]
        .filter(Boolean)
        .join('\n')
      shaderError = new SceneAnalysisError(
        'unavailable',
        `Scene capture shader compilation failed:\n${log}`
      )
      state.onShaderError?.(gl, program, vertexShader, fragmentShader)
    }
    scene.updateMatrixWorld(true)
    // Keep the current frozen lighting/environment, but not terrain/sky/overlays.
    scene.traverseVisible((object) => {
      if (!(object instanceof Light)) return
      const light = object.clone() as Light
      light.matrixAutoUpdate = false
      light.matrix.copy(object.matrixWorld)
      light.castShadow = false
      if (object instanceof DirectionalLight && light instanceof DirectionalLight) {
        const position = object.target.getWorldPosition(new Vector3())
        light.target = new Object3D()
        light.target.position.copy(position)
        group.add(light.target)
      }
      group.add(light)
    })
    group.matrixAutoUpdate = false
    group.matrix.copy(scene.matrixWorld).invert()
    group.parent = scene
    scene.children = [group]
    scene.background = new Color('#edf0f4')
    scene.fog = null
    scene.overrideMaterial = null
    renderer.xr.enabled = false
    renderer.shadowMap.enabled = false
    renderer.autoClear = true
    renderer.setRenderTarget(hdr)
    renderer.setViewport(0, 0, width, height)
    renderer.setScissorTest(false)
    renderer.setClearColor('#edf0f4', 1)
    beforeRender()
    renderer.render(scene, camera)
    // Let Three finish its render-stack cleanup before rejecting a failed draw.
    if (shaderError) throw shaderError
    output.render(renderer, target, hdr, 0, false)
    if (shaderError) throw shaderError
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
    return pixels
  } finally {
    scene.children = state.children
    scene.background = state.background
    scene.fog = state.fog
    scene.overrideMaterial = state.override
    group.parent = null
    renderer.xr.enabled = state.xr
    renderer.shadowMap.enabled = state.shadows
    renderer.shadowMap.autoUpdate = state.shadowAuto
    renderer.shadowMap.needsUpdate = state.shadowNeeds
    renderer.autoClear = state.autoClear
    renderer.debug.checkShaderErrors = state.checkShaderErrors
    renderer.debug.onShaderError = state.onShaderError
    renderer.setRenderTarget(state.target, state.face, state.level)
    renderer.setViewport(state.viewport)
    renderer.setScissor(state.scissor)
    renderer.setScissorTest(state.scissorTest)
    renderer.setClearColor(state.clear, state.alpha)
    target.dispose()
    hdr.dispose()
    output.dispose()
  }
}

export function createSceneCapture(options: {
  renderer: WebGLRenderer
  scene: Scene
  getLayer: () => FurnitureLayer | null
  isReady: () => boolean
  withCamera: <T>(camera: Camera, draw: () => T) => T
  beforeRender: () => void
  invalidate: () => void
  getRevision: () => number
}): AnalysisCaptureProvider & { dispose(): void } {
  let disposed = false
  let queue = Promise.resolve()
  const captureImage: AnalysisCaptureProvider['render'] = async (snapshot, request, task) => {
    assertImageTask(task)
    if (disposed) throw new SceneAnalysisError('cancelled', 'Viewport capture owner was disposed')
    const layer = options.getLayer()
    if (!layer || !options.isReady() || options.renderer.getContext().isContextLost()) {
      throw new SceneAnalysisError(
        'unavailable',
        'Model viewport is not ready; wait for loading and end dragging before capturing'
      )
    }
    if (
      !options.renderer.extensions.has('EXT_color_buffer_float') &&
      !options.renderer.extensions.has('EXT_color_buffer_half_float')
    ) {
      throw new SceneAnalysisError(
        'unavailable',
        'This GPU does not support the HDR capture target'
      )
    }
    const width = request.width ?? 1024,
      height = request.height ?? 1024
    const gpuLimit = options.renderer.capabilities?.maxTextureSize
    if (gpuLimit && (width > gpuLimit || height > gpuLimit))
      throw new SceneAnalysisError(
        'unavailable',
        `Requested ${width}×${height} capture exceeds this GPU's ${gpuLimit}px texture limit`
      )
    const capture = buildAnalysisCaptureGroup(layer, snapshot, request)
    const rendered = new Set(capture.renderedItemIds)
    let pixels: Uint8Array
    let camera: PerspectiveCamera
    try {
      if (capture.bounds.isEmpty())
        throw new SceneAnalysisError(
          'unavailable',
          'No captured models available; switch to model mode, wait for loading, then start a new snapshot'
        )
      const focus = request.focusItemIds ? new Set(request.focusItemIds) : null
      const focusPoints = [...capture.framingPoints].flatMap(([id, points]) =>
        !focus || focus.has(id) ? points : []
      )
      if (!focusPoints.length)
        throw new SceneAnalysisError('invalid_input', 'Focus has no available bounds')
      camera = frameAnalysisCamera(focusPoints, request.camera, width / height, capture.bounds)
      pixels = options.withCamera(camera, () =>
        readAnalysisPixels(
          options.renderer,
          options.scene,
          camera,
          capture.group,
          options.beforeRender,
          { width, height }
        )
      )
    } finally {
      capture.dispose()
      options.invalidate()
    }
    assertImageTask(task)
    const { canvas, context } = createAnalysisCanvas(width, height)
    const image = context.createImageData(width, height)
    const stride = width * 4
    for (let row = 0; row < height; row++)
      image.data.set(
        pixels.subarray((height - row - 1) * stride, (height - row) * stride),
        row * stride
      )
    context.putImageData(image, 0, 0)
    if (request.labels) {
      context.font = '14px sans-serif'
      for (const item of snapshot.items) {
        if (!request.labels[item.itemId] || !item.bounds || !rendered.has(item.itemId)) continue
        const point = new Vector3()
          .addVectors(
            new Vector3(item.bounds.min.x, item.bounds.min.y, item.bounds.min.z),
            new Vector3(item.bounds.max.x, item.bounds.max.y, item.bounds.max.z)
          )
          .multiplyScalar(0.5)
          .project(camera!)
        const x = ((point.x + 1) * width) / 2,
          y = ((1 - point.y) * height) / 2
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue
        const label = request.labels[item.itemId]!
        context.fillStyle = '#ffffffdd'
        context.fillRect(x - 3, y - 15, context.measureText(label).width + 6, 19)
        context.fillStyle = '#172333'
        context.fillText(label, x, y)
      }
    }
    context.fillStyle = '#ffffffdd'
    context.fillRect(0, 0, width, 32)
    context.fillStyle = '#172333'
    context.font = '14px sans-serif'
    context.fillText(
      `Perspective · World cm / Z up · ${capture.renderedItemIds.length}/${request.itemIds.length} rendered · ${capture.missingItemIds.length} missing · No shadows`,
      12,
      21
    )
    const blob = await canvasPng(canvas)
    assertImageTask(task)
    if (disposed) throw new SceneAnalysisError('cancelled', 'Viewport capture owner was disposed')
    return {
      blob,
      width,
      height,
      details: {
        camera: {
          ...camera.userData.analysis,
          projection: 'perspective',
          position: camera.position.toArray(),
          near: camera.near,
          far: camera.far,
        },
        itemIds: request.itemIds,
        renderedItemIds: capture.renderedItemIds,
        missingItemIds: capture.missingItemIds,
        lighting: 'snapshot-viewport-environment',
        shadows: false,
        slidePaths: 'schematic',
      },
    }
  }
  return {
    revision: options.getRevision,
    render(snapshot, request, task) {
      // Serialize encoding as well as draws to bound transient framebuffer memory.
      const result = queue.then(() => captureImage(snapshot, request, task))
      queue = result.then(
        () => {},
        () => {}
      )
      return result
    },
    dispose() {
      disposed = true
    },
  }
}

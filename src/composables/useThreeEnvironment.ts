import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  LightProbe,
  PMREMGenerator,
  Vector3,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import {
  homeEnvironmentAsset,
  homeEnvironmentSH,
  homeEnvironmentSHSigns,
} from '@/lib/homeEnvironmentData'
import { sampleHomeTod, type HomeTodSample } from '@/lib/homeTod'
import {
  setEnvironmentDiffuseWeight,
  setEnvironmentReflection,
  type ShadingQuality,
} from '@nuan5-pro/render'
import { createHomeSky } from './renderer/homeSky'
import { updateHomeOutput } from './renderer/homeOutput'
import { preparePmrem } from './renderer/preparePmrem'

interface EnvironmentEntry {
  target: WebGLRenderTarget
}

const WHITE = [1, 1, 1] as const
const FILL_INTENSITY = 2
// Noon capture, direct-light PS: linear RGB (5.5595193, 4.0975056, 3.1879838).
// The shader applies View.PreExposure separately after lighting. Match its
// luminance while retaining the authored TOD hue and relative intensity curve.
// This is an editor calibration, not a native intensity unit conversion.
const HOME_NOON_SUN_INTENSITY = 5.198315765618913

/** One canvas owns its lights and two static PMREM targets. Source HDRI is
 * filtered once; manual TOD updates colours/SH, never a scene capture or clock. */
export function createSceneEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
  invalidate: () => void,
  shadingQuality: ShadingQuality = 'original'
) {
  let generator = new PMREMGenerator(renderer)
  const cache = new Map<string, EnvironmentEntry>()
  const sun = new DirectionalLight()
  const hemisphere = new HemisphereLight()
  const probe = new LightProbe()
  probe.intensity = 0
  probe.name = 'editor-home-source-irradiance'
  const homeSky = createHomeSky(renderer)
  homeSky.root.visible = false
  sun.castShadow = true
  const shadowSize = Math.min(4096, renderer.capabilities.maxTextureSize)
  sun.shadow.mapSize.set(shadowSize, shadowSize)
  sun.shadow.bias = -0.0005
  sun.name = 'editor-environment-sun'
  hemisphere.name = 'editor-environment-fill'
  scene.add(sun, sun.target, hemisphere, homeSky.root)
  // A zero-intensity probe still enables the SH shader path in Three.
  // Economy evaluates two endpoint irradiances on TOD changes instead.
  if (shadingQuality !== 'economy') scene.add(probe)
  const fillIrradiance = new Vector3()
  const downward = new Vector3(0, 0, -1)

  const previous = {
    environment: scene.environment,
    background: scene.background,
    intensity: scene.environmentIntensity,
    environmentRotation: scene.environmentRotation.clone(),
    backgroundRotation: scene.backgroundRotation.clone(),
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
  }
  const shadowBounds = new Box3()
  const sceneBounds = new Box3()
  const meshBounds = new Box3()
  const center = new Vector3()
  const direction = new Vector3()
  let mode: 'studio' | 'home' = 'studio'
  let sample: HomeTodSample | null = null
  let selectedKey = ''
  let disposed = false
  let homeLoading: Promise<void> | undefined
  let generation = 0
  // Home lighting is a private asset, so a rejected request means the session
  // lost access to it. Degrade to the studio rig once instead of leaving an
  // empty environment behind or retrying on every TOD change.
  let homeFailed = false

  function fallBackToStudio(error: unknown) {
    homeFailed = true
    selectedKey = ''
    console.warn('[Home environment] Home lighting unavailable, using studio lighting:', error)
  }

  function prepare(nextMode: 'studio' | 'home', minute: number) {
    if (nextMode !== 'home' || homeFailed) return Promise.resolve()
    if (!homeLoading) {
      const version = generation
      const owner = generator
      homeLoading = new HDRLoader()
        .loadAsync(homeEnvironmentAsset)
        .then(async (texture) => {
          try {
            if (disposed || version !== generation) return
            const target = await preparePmrem(
              renderer,
              owner,
              texture,
              () => disposed || version !== generation
            )
            if (target) {
              if (disposed || version !== generation) target.dispose()
              else cache.set('home', { target })
            }
          } finally {
            texture.dispose()
          }
        })
        .catch((error) => {
          if (version === generation) homeLoading = undefined
          throw error
        })
    }
    return Promise.all([homeLoading, homeSky.load(), homeSky.update(sampleHomeTod(minute))])
      .then(() => {})
      .catch((error) => {
        if (!disposed) fallBackToStudio(error)
      })
  }

  function disposeEntry(entry: EnvironmentEntry) {
    entry.target.dispose()
  }

  function positionLight() {
    // One world-space shadow volume covers all casters and receivers. Camera
    // navigation must not move its edges or consume another shadow pass.
    if (shadowBounds.isEmpty()) center.set(0, 0, 0)
    else shadowBounds.getCenter(center)
    const radius = shadowBounds.isEmpty() ? 1 : shadowBounds.getSize(direction).length() / 2
    const padding = Math.max(100, radius * 0.01)
    sun.target.position.copy(center)
    if (mode === 'home' && sample) direction.fromArray(sample.sunDirectionWorld)
    else direction.set(1500, 2000, 3000)
    sun.position
      .copy(direction.normalize())
      .multiplyScalar(radius + padding + 1)
      .add(center)
    sun.target.updateMatrixWorld()
    sun.updateMatrixWorld()
    sun.shadow.updateMatrices(sun)

    const camera = sun.shadow.camera
    if (shadowBounds.isEmpty()) meshBounds.setFromCenterAndSize(center, new Vector3(2, 2, 2))
    else meshBounds.copy(shadowBounds)
    meshBounds.applyMatrix4(camera.matrixWorldInverse)
    camera.left = meshBounds.min.x - padding
    camera.right = meshBounds.max.x + padding
    camera.bottom = meshBounds.min.y - padding
    camera.top = meshBounds.max.y + padding
    camera.near = Math.max(1, -meshBounds.max.z - padding)
    camera.far = Math.max(camera.near + 1, -meshBounds.min.z + padding)
    camera.updateProjectionMatrix()
    sun.shadow.updateMatrices(sun)
    renderer.shadowMap.needsUpdate = true
  }

  function update(nextMode: 'studio' | 'home', minute: number) {
    mode = nextMode === 'home' && homeFailed ? 'studio' : nextMode
    sample = mode === 'home' ? sampleHomeTod(minute) : null
    const selection = sample ? `home:${sample.minute}` : 'studio'
    if (selection === selectedKey) return
    const key = sample ? 'home' : 'studio'
    homeSky.root.visible = sample !== null
    if (sample) {
      updateHomeOutput(renderer, sample)
      void Promise.resolve(homeSky.update(sample)).then(() => {
        if (!disposed) invalidate()
      })
    } else {
      renderer.toneMapping = previous.toneMapping
      renderer.toneMappingExposure = previous.exposure
    }
    let entry = cache.get(key)
    if (!entry) {
      if (sample) {
        // prepare() resolves even after a fallback, so this re-runs the update
        // with the studio rig instead of the empty environment left above.
        void prepare('home', minute).then(() => {
          if (disposed) return
          selectedKey = ''
          update(mode, sample?.minute ?? 720)
        })
      } else if (!sample) {
        const room = new RoomEnvironment()
        try {
          entry = { target: generator.fromScene(room) }
        } finally {
          room.dispose()
        }
      }
    }
    if (entry) cache.set(key, entry)
    selectedKey = selection
    scene.environment = entry?.target.texture ?? null
    scene.background = sample ? null : previous.background
    if (sample) {
      // CUE4Parse HDR direction -> UE=(Z,-X,Y) -> world=(Z,X,Y).
      // WebGLMaterials negates environment Euler angles before sampling; these
      // produce world->HDR=(Y,Z,X). Verified against the source SH coefficients,
      // not chosen by where the panorama's brightest pixel happens to sit.
      scene.environmentRotation.set(Math.PI / 2, 0, Math.PI / 2, 'XYZ')
      scene.environmentIntensity = sample.skyIntensity
      sun.color.setRGB(...sample.sunColor)
      sun.intensity = (HOME_NOON_SUN_INTENSITY * sample.sunIntensity) / 7
      // Grade the distant diffuse probe with the authored home hemisphere tint.
      // This approximates the game's art-directed indirect light without scene
      // GI; the raw HDRI/SkyLight combination alone is strongly blue. Keep this
      // correction out of direct light, environment specular and visible sky.
      hemisphere.intensity = 0
      probe.intensity = sample.skyIntensity
      const skyColor = sample.skyColor
      const diffuseTint = sample.hemisphereDiffuseTint
      homeEnvironmentSH.forEach((coefficient, index) => {
        const sign = homeEnvironmentSHSigns[index]!
        probe.sh.coefficients[index]!.set(
          coefficient[0] * sign * skyColor[0] * diffuseTint[0],
          coefficient[1] * sign * skyColor[1] * diffuseTint[1],
          coefficient[2] * sign * skyColor[2] * diffuseTint[2]
        )
      })
      if (shadingQuality === 'economy') {
        hemisphere.position.set(0, 0, 1)
        probe.sh
          .getIrradianceAt(hemisphere.position, fillIrradiance)
          .multiplyScalar(sample.skyIntensity)
          .clampScalar(0, Infinity)
        hemisphere.color.setRGB(fillIrradiance.x, fillIrradiance.y, fillIrradiance.z)
        probe.sh
          .getIrradianceAt(downward, fillIrradiance)
          .multiplyScalar(sample.skyIntensity)
          .clampScalar(0, Infinity)
        hemisphere.groundColor.setRGB(fillIrradiance.x, fillIrradiance.y, fillIrradiance.z)
        hemisphere.intensity = 1
      }
      setEnvironmentDiffuseWeight(renderer, 0)
      setEnvironmentReflection(
        renderer,
        sample.generalReflectionTint,
        sample.waterReflectionTint,
        sample.skyColor
      )
    } else {
      scene.environmentRotation.copy(previous.environmentRotation)
      scene.backgroundRotation.copy(previous.backgroundRotation)
      scene.environmentIntensity = 0.3
      sun.color.set(0xfff4e6)
      sun.intensity = 2
      hemisphere.color.set(0xffffff)
      hemisphere.groundColor.set(0x888888)
      hemisphere.intensity = FILL_INTENSITY
      probe.intensity = 0
      hemisphere.position.set(0, 1, 0)
      setEnvironmentDiffuseWeight(renderer, 1)
      setEnvironmentReflection(renderer, WHITE, WHITE)
    }
    positionLight()
    invalidate()
  }

  return {
    update,
    prepare,
    reset() {
      generation++
      selectedKey = ''
      homeLoading = undefined
      homeFailed = false
      for (const entry of cache.values()) disposeEntry(entry)
      cache.clear()
      generator.dispose()
      generator = new PMREMGenerator(renderer)
    },
    setShadowsEnabled(enabled: boolean) {
      if (renderer.shadowMap.enabled === enabled) return
      renderer.shadowMap.enabled = enabled
      renderer.shadowMap.needsUpdate = true
      // Shadow sampling is a shader variant, not just a shadow-pass switch.
      const materials = new Set<Material>()
      scene.traverse((object) => {
        const mesh = object as Mesh
        if (!mesh.isMesh) return
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          materials.add(material)
      })
      for (const material of materials) material.needsUpdate = true
      invalidate()
    },
    materialLighting() {
      const direction = sun
        .getWorldPosition(new Vector3())
        .sub(sun.target.getWorldPosition(new Vector3()))
        .normalize()
      return {
        primaryDirection: direction.toArray() as [number, number, number],
        primaryColor: [
          sun.color.r * sun.intensity,
          sun.color.g * sun.intensity,
          sun.color.b * sun.intensity,
        ] as [number, number, number],
        tod: sample ?? sampleHomeTod(720),
      }
    },
    beforeRender() {
      if (!renderer.shadowMap.enabled || !renderer.shadowMap.needsUpdate) return
      scene.updateMatrixWorld()
      sceneBounds.makeEmpty()
      scene.traverseVisible((object) => {
        const mesh = object as Mesh | InstancedMesh
        if (!mesh.isMesh || (!mesh.castShadow && !mesh.receiveShadow)) return

        // Instanced furniture already maintains an aggregate local bounding box;
        // the prototype geometry alone would miss instances across the island.
        if ('isInstancedMesh' in mesh) {
          if (!mesh.boundingBox) mesh.computeBoundingBox()
          meshBounds.copy(mesh.boundingBox!)
        } else {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
          meshBounds.copy(mesh.geometry.boundingBox!)
        }
        sceneBounds.union(meshBounds.applyMatrix4(mesh.matrixWorld))
      })
      if (sceneBounds.equals(shadowBounds)) return
      shadowBounds.copy(sceneBounds)
      positionLight()
      invalidate()
    },
    dispose() {
      disposed = true
      scene.remove(sun, sun.target, hemisphere, probe)
      homeSky.dispose()
      sun.shadow.dispose()
      scene.environment = previous.environment
      scene.background = previous.background
      scene.environmentIntensity = previous.intensity
      scene.environmentRotation.copy(previous.environmentRotation)
      scene.backgroundRotation.copy(previous.backgroundRotation)
      renderer.toneMapping = previous.toneMapping
      renderer.toneMappingExposure = previous.exposure
      setEnvironmentReflection(renderer, WHITE, WHITE)
      setEnvironmentDiffuseWeight(renderer, 1)
      for (const entry of cache.values()) disposeEntry(entry)
      cache.clear()
      generator.dispose()
    },
  }
}

import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  NoColorSpace,
  DataTexture,
  FloatType,
  RGBAFormat,
  LinearFilter,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { homeCloudPlacements, homeSkyAsset } from '@/lib/homeSkyData'
import type { HomeTodSample } from '@/lib/homeTod'
import { matrixTransform } from '@/lib/matrixTransform'
import { homeOutputUniforms } from './homeOutput'
import { sampleAtmosphere } from '@/lib/homeAtmosphere'
import { createHomeMountains } from './homeMountains'
import { homeTodCurveShader, homeTodCurveUniforms } from './homeTodCurve'

const skyVertex = /* glsl */ `
uniform mat4 skyProjectionInverse;
uniform mat4 skyCameraWorld;
varying vec3 skyDirection;
void main() {
  vec4 nearPoint = skyProjectionInverse * vec4(position.xy, -1., 1.);
  vec4 farPoint = skyProjectionInverse * vec4(position.xy, 1., 1.);
  skyDirection = mat3(skyCameraWorld) * (farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);
  gl_Position = vec4(position.xy, 1., 1.);
}
`

const skyFragment = /* glsl */ `
uniform sampler2D atmosphere;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunVisible;
varying vec3 skyDirection;
void main() {
  vec3 direction = normalize(skyDirection);
  vec2 horizontal = direction.xy;
  vec2 solar = sunDirection.xy;
  float cosine = dot(horizontal, solar) / max(length(horizontal) * length(solar), 1e-6);
  float azimuth = acos(clamp(cosine, -1., 1.)) / 3.14159265;
  float elevation = asin(clamp(direction.z, 0., 1.)) / 1.57079633;
  vec3 sky = texture2D(atmosphere, vec2(azimuth, elevation)).rgb;
  float disk = smoothstep(cos(.014), cos(.011), dot(direction, sunDirection));
  sky += sunColor * disk * sunVisible * 6.;
  gl_FragColor = vec4(sky, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const cloudVertex = /* glsl */ `
varying vec2 cloudUv;
void main() {
  cloudUv = uv;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
  gl_Position.z = gl_Position.w;
}
`

const cloudFragment = /* glsl */ `
${homeTodCurveShader}
uniform sampler2D cloudAtlas;
uniform vec3 cloudShade;
uniform vec3 cloudLight;
uniform float maskThreshold;
varying vec2 cloudUv;
void main() {
  vec4 packed = texture2D(cloudAtlas, cloudUv);
  if (packed.a < maskThreshold) discard;
  // M_StaticClouds / MI_StaticClouds_01: the SRGB view decodes RGB, never alpha.
  // The source shader blends shade -> white with R, then -> bloom with G;
  // A is opacity. B is not a blue albedo channel.
  vec3 color = mix(cloudShade, vec3(1.), packed.r);
  color = mix(color, cloudLight, packed.g);
  color *= homeCloudTODColor();
  gl_FragColor = vec4(color, packed.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function disposePackedAssets(root: Group, curve: Texture | null) {
  const textures = new Set<Texture>()
  if (curve) textures.add(curve)
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
      material.dispose()
    }
  })
  textures.forEach((texture) => texture.dispose())
}

/** Source cloud meshes and masks, without volumetric raymarch/OIT or animation.
 * Background directions are camera-relative; editor objects keep real coordinates. */
export function createHomeSky(renderer: WebGLRenderer) {
  const root = new Group()
  root.name = 'home-sky'
  const mountains = createHomeMountains()
  root.add(mountains.root)
  const output = homeOutputUniforms(renderer)
  const todCurve = homeTodCurveUniforms(renderer)
  const width = 96,
    height = 64
  const radiance = new Float32Array(width * height * 4)
  const atmosphere = new DataTexture(radiance, width, height, RGBAFormat, FloatType)
  atmosphere.minFilter = atmosphere.magFilter = LinearFilter
  let atmosphereMinute = -1
  let atmosphereRevision = 0
  let atmospherePending: { minute: number; promise: Promise<void> } | undefined
  const sky = new ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: DoubleSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...output,
      atmosphere: { value: atmosphere },
      skyProjectionInverse: { value: new Matrix4() },
      skyCameraWorld: { value: new Matrix4() },
      sunDirection: { value: new Vector3() },
      sunColor: { value: new Vector3() },
      sunVisible: { value: 0 },
    },
  })
  const dome = new Mesh(new PlaneGeometry(2, 2), sky)
  dome.name = 'home-sky-dome'
  dome.frustumCulled = false
  dome.renderOrder = -10000
  dome.raycast = () => {}
  dome.visible = false
  dome.onBeforeRender = (_renderer, _scene, camera) => {
    sky.uniforms.skyProjectionInverse!.value.copy(camera.projectionMatrixInverse)
    sky.uniforms.skyCameraWorld!.value.copy(camera.matrixWorld)
  }
  root.add(dome)

  const cloudUniforms = {
    ...output,
    ...todCurve,
    cloudAtlas: { value: null as Texture | null },
    cloudShade: { value: new Vector3(1, 1, 1) },
    cloudLight: { value: new Vector3(1, 1, 1) },
  }
  const materials = [0.001, 0.3333].map(
    (maskThreshold) =>
      new ShaderMaterial({
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        uniforms: { ...cloudUniforms, maskThreshold: { value: maskThreshold } },
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      })
  )
  let disposed = false
  let pending: Promise<void> | null = null
  let packedScene: Group | null = null
  let packedCurve: Texture | null = null
  const cloudGeometries: BufferGeometry[] = []
  const cloudMeshes: Mesh[] = []

  function load() {
    if (pending) return pending
    pending = (async () => {
      const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/')
      const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
      const meshIds = [...new Set(homeCloudPlacements.map((value) => value.mesh))]
      const model = await loader.loadAsync(homeSkyAsset).finally(() => draco.dispose())
      let curve: Texture | null = null
      const sources = new Map<string, Mesh>()
      model.scene.traverse((object) => {
        if (object instanceof Mesh) sources.set(object.name, object)
      })
      try {
        const metadata = model.parser.json.extras?.homeSky
        if (metadata?.version !== 1 || !Number.isInteger(metadata.cloudTodTexture))
          throw new Error('Invalid home sky package')
        curve = await model.parser.getDependency('texture', metadata.cloudTodTexture)
        if (!curve || meshIds.some((id) => !sources.has(`S_StaticClouds_0${id}`)))
          throw new Error('Missing home sky assets')
      } catch (error) {
        disposePackedAssets(model.scene, curve)
        throw error
      }
      if (disposed) {
        disposePackedAssets(model.scene, curve)
        return
      }
      packedScene = model.scene
      packedCurve = curve
      const cloudSource = sources.get('S_StaticClouds_01')!
      if (!(cloudSource.material instanceof MeshBasicMaterial))
        throw new Error('Invalid home cloud material')
      const atlas = cloudSource.material.map
      if (!atlas) throw new Error('Missing home cloud atlas')
      atlas.colorSpace = SRGBColorSpace
      atlas.flipY = false
      cloudUniforms.cloudAtlas.value = atlas
      // The original GPU atlas is linear float data. Its exported PNG stores
      // quantized/clamped numeric values, not sRGB colour. No row-mixing mipmaps.
      curve.colorSpace = NoColorSpace
      curve.flipY = false
      curve.generateMipmaps = false
      curve.minFilter = curve.magFilter = LinearFilter
      todCurve.editorCloudTODCurve.value = curve
      todCurve.editorCloudTODReady.value = true
      const buckets: BufferGeometry[][] = [[], []]
      const gltfToUE = new Matrix4().makeRotationX(Math.PI / 2).scale(new Vector3(100, 100, 100))
      for (const item of homeCloudPlacements) {
        const geometry = sources.get(`S_StaticClouds_0${item.mesh}`)!.geometry.clone()
        for (const name of Object.keys(geometry.attributes)) {
          if (name !== 'position' && name !== 'uv') geometry.deleteAttribute(name)
        }
        const [roll, pitch, yaw] = item.rotation.map((value) => (value * Math.PI) / 180)
        const rotation = new Quaternion().setFromEuler(new Euler(-roll!, -pitch!, yaw!, 'ZYX'))
        const transform = new Matrix4().compose(
          new Vector3(...item.position),
          rotation,
          new Vector3(...item.scale)
        )
        matrixTransform.applyParentFlipInPlace(transform)
        geometry.applyMatrix4(transform.multiply(gltfToUE))
        buckets[item.masked ? 1 : 0]!.push(geometry)
      }
      buckets.forEach((geometries, index) => {
        const merged = mergeGeometries(geometries)
        geometries.forEach((geometry) => geometry.dispose())
        if (!merged) return
        cloudGeometries.push(merged)
        const mesh = new Mesh(merged, materials[index]!)
        mesh.name = `home-static-clouds-${index}`
        mesh.frustumCulled = false
        mesh.renderOrder = -9999 + index
        mesh.raycast = () => {}
        mesh.visible = atmosphereMinute >= 0
        cloudMeshes.push(mesh)
        root.add(mesh)
      })
      mountains.setAssets(sources)
    })()
    return pending
  }

  function prepareAtmosphere(sample: HomeTodSample) {
    if (atmosphereMinute === sample.minute) {
      if (atmospherePending) {
        atmosphereRevision++
        atmospherePending = undefined
      }
      return Promise.resolve()
    }
    if (atmospherePending?.minute === sample.minute) return atmospherePending.promise
    const version = ++atmosphereRevision
    const promise = (async () => {
      const next = new Float32Array(radiance.length)
      let start = performance.now()
      for (let y = 0; y < height; y++) {
        if (disposed || version !== atmosphereRevision) return
        const elevation = ((y / (height - 1)) * Math.PI) / 2
        // SM_Skysphere_InverseUV has V = .5 - elevation / PI.
        // Source shader: radiance * FinalBoost * (1 + pow(t, power) * HorizonBoost).
        const t = Math.max(
          0,
          Math.min(
            1,
            (0.5 - elevation / Math.PI - (1 - sample.skyHorizonOffset)) / sample.skyHorizonWidth
          )
        )
        const horizon = t ** sample.skyGradientPower
        for (let x = 0; x < width; x++) {
          const color = sampleAtmosphere(
            sample.atmosphere,
            elevation,
            (x / (width - 1)) * Math.PI,
            sample.sunDirectionWorld[2]
          )
          const offset = (y * width + x) * 4
          for (let c = 0; c < 3; c++) {
            const value = color[c]! * sample.skyZenith[c]! * (1 + horizon * sample.skyHorizon[c]!)
            next[offset + c] = value
          }
          next[offset + 3] = 1
        }
        if (performance.now() - start >= 3) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          start = performance.now()
        }
      }
      if (disposed || version !== atmosphereRevision) return
      radiance.set(next)
      atmosphereMinute = sample.minute
      atmosphere.needsUpdate = true
    })().finally(() => {
      if (version === atmosphereRevision) atmospherePending = undefined
    })
    atmospherePending = { minute: sample.minute, promise }
    return promise
  }

  return {
    root,
    load,
    async update(sample: HomeTodSample) {
      todCurve.editorCloudTODTime.value = sample.minute / 1440
      sky.uniforms.sunDirection!.value.fromArray(sample.sunDirectionWorld)
      sky.uniforms.sunColor!.value.fromArray(sample.sunColor)
      sky.uniforms.sunVisible!.value = sample.sunVisible
      cloudUniforms.cloudShade.value.fromArray(sample.cloudShade)
      cloudUniforms.cloudLight.value.fromArray(sample.cloudLight)
      mountains.update(sample)

      await prepareAtmosphere(sample)
      if (disposed || atmosphereMinute !== sample.minute) return
      dome.visible = true
      mountains.root.visible = true
      cloudMeshes.forEach((mesh) => (mesh.visible = true))
    },
    dispose() {
      disposed = true
      mountains.dispose()
      root.removeFromParent()
      cloudGeometries.forEach((geometry) => geometry.dispose())
      cloudMeshes.length = 0
      dome.geometry.dispose()
      if (packedScene) disposePackedAssets(packedScene, packedCurve)
      packedScene = null
      packedCurve = null
      cloudUniforms.cloudAtlas.value = null
      todCurve.editorCloudTODCurve.value = null
      todCurve.editorCloudTODReady.value = false
      atmosphere.dispose()
      sky.dispose()
      materials.forEach((material) => material.dispose())
    },
  }
}

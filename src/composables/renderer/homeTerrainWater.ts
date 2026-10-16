import {
  BufferAttribute,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Ray,
  RepeatWrapping,
  Vector3,
  type Object3D,
} from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { sampleHomeTod } from '@/lib/homeTod'
import { applyEnvironmentLighting } from '@nuan5-pro/render'

const RIVER_MATERIAL = 'MI_River_SLW_Home'

/** Immutable terrain only. Temporary BVHs never reorder the displayed geometry. */
function riverDepths(root: Object3D, river: Mesh) {
  const beds: MeshBVH[] = []
  const matrix = new Matrix4()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (!materials.some((material) => /^S_NHBldg_Foundation_/.test(material.name))) return
    const count = object instanceof InstancedMesh ? object.count : 1
    for (let i = 0; i < count; i++) {
      matrix.copy(object.matrixWorld)
      if (object instanceof InstancedMesh) {
        const instance = new Matrix4()
        object.getMatrixAt(i, instance)
        matrix.multiply(instance)
      }
      const geometry = object.geometry.clone().applyMatrix4(matrix)
      beds.push(new MeshBVH(geometry))
    }
  })

  matrix.copy(river.matrixWorld)
  if (river instanceof InstancedMesh) {
    if (river.count !== 1) throw new Error('Standalone home river expects one authored instance')
    const instance = new Matrix4()
    river.getMatrixAt(0, instance)
    matrix.multiply(instance)
  }
  const position = river.geometry.getAttribute('position')
  const depths = new Float32Array(position.count)
  const point = new Vector3()
  const ray = new Ray(new Vector3(), new Vector3(0, 0, -1))
  try {
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix)
      ray.origin.set(point.x, point.y, point.z + 1000)
      let floor = -Infinity
      for (const bed of beds) {
        const hit = bed.raycastFirst(ray, DoubleSide, 0, 4000)
        if (hit) floor = Math.max(floor, hit.point.z)
      }
      // The authored river continues beyond the island at the waterfall. There
      // is no bed there; retain a modest optical depth rather than delete it.
      depths[i] = Number.isFinite(floor) ? Math.max(0, point.z - floor) : 180
    }
  } finally {
    beds.forEach((bed) => bed.geometry.dispose())
  }
  river.geometry.setAttribute('terrainWaterDepth', new BufferAttribute(depths, 1))
  return depths
}

/** A local, single-pass approximation, not the furniture/native SLW contract.
 * Capture frame137442: river draw 14898, cb5: roughness .05, F0=.08*.255,
 * detail periods 1000/667 cm, near/far normal .1/.5, absorption reciprocal
 * (120,184.586,200)*2.5. Scene transport below uses the real static river bed.
 */
export function installHomeTerrainWater(
  root: Object3D,
  lighting: () => { mode: 'home' | 'studio'; minute: number }
) {
  root.updateMatrixWorld(true)
  const time = { value: 0 }
  const light = { value: new Vector3(1, 1, 1) }
  let lightingKey = ''
  let lastDraw = -Infinity
  let count = 0

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const source = Array.isArray(object.material) ? null : object.material
    if (!(source instanceof MeshStandardMaterial) || source.name !== RIVER_MATERIAL) return
    if (!source.normalMap) throw new Error('Authored home river normal is missing')
    const started = performance.now()
    const depths = riverDepths(root, object)
    source.normalMap.wrapS = source.normalMap.wrapT = RepeatWrapping
    source.normalMap.needsUpdate = true

    const material = new MeshPhysicalMaterial({
      name: RIVER_MATERIAL,
      color: 0x000000,
      normalMap: source.normalMap,
      metalness: 0,
      roughness: 0.1,
      ior: 1.333,
      specularIntensity: 1,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    })
    // Only environmentLighting reads this classification; this object never
    // enters furniture registries or their material/optical-resource pipeline.
    material.userData.water = { family: 'single-layer-water' }
    material.userData.terrainWater = {
      approximation: 'static-bed absorption + world-flow normals + existing sky IBL',
      captureDraw: 14898,
      depthMin: Math.min(...depths),
      depthMax: Math.max(...depths),
      bedBuildMs: performance.now() - started,
    }
    material.onBeforeRender = () => {
      lastDraw = performance.now()
      time.value = lastDraw * 0.001
      const selection = lighting()
      const key = `${selection.mode}:${selection.minute}`
      if (key === lightingKey) return
      lightingKey = key
      if (selection.mode === 'home') {
        const sample = sampleHomeTod(selection.minute)
        // Local incident-light proxy; follows the existing manual TOD without
        // a clock, exposure override or fixed screenshot-colour injection.
        const sky = sample.skyIntensity
        const sun = sample.sunIntensity / 7
        light.value.set(
          sample.skyColor[0] * sky * 0.65 + sample.sunColor[0] * sun * 0.35,
          sample.skyColor[1] * sky * 0.65 + sample.sunColor[1] * sun * 0.35,
          sample.skyColor[2] * sky * 0.65 + sample.sunColor[2] * sun * 0.35
        )
      } else light.value.set(1, 1, 1)
    }
    material.onBeforeCompile = (shader) => {
      shader.uniforms.terrainWaterTime = time
      shader.uniforms.terrainWaterLight = light
      shader.vertexShader =
        `
attribute float terrainWaterDepth;
varying float vTerrainWaterDepth;
varying vec3 vTerrainWaterWorld;
` + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
vec4 terrainWaterPosition = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  terrainWaterPosition = instanceMatrix * terrainWaterPosition;
#endif
vTerrainWaterWorld = (modelMatrix * terrainWaterPosition).xyz;
vTerrainWaterDepth = terrainWaterDepth;
#include <project_vertex>`
      )
      shader.fragmentShader =
        `
uniform float terrainWaterTime;
uniform vec3 terrainWaterLight;
varying float vTerrainWaterDepth;
varying vec3 vTerrainWaterWorld;
` + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `
// World centimetres, not the .28x.90 UV island covering the entire river.
vec2 riverUv = vTerrainWaterWorld.xy * vec2(1., -1.);
vec2 n1 = texture2D(normalMap, riverUv * .001 + terrainWaterTime * vec2(.003, .002)).rg * 2. - 1.;
vec2 n2 = texture2D(normalMap, riverUv * .0015 + terrainWaterTime * vec2(-.002, .001)).rg * 2. - 1.;
float riverDistance = length(cameraPosition - vTerrainWaterWorld);
float riverNormalWeight = mix(.1, .24, smoothstep(2000., 5000., riverDistance));
riverNormalWeight *= smoothstep(0., 20., vTerrainWaterDepth);
vec3 riverWorldNormal = inverseTransformDirection(normal, viewMatrix);
riverWorldNormal = normalize(riverWorldNormal + vec3((n1 + n2) * riverNormalWeight, 0.));
normal = normalize(mat3(viewMatrix) * riverWorldNormal);`
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
float riverFacing = clamp(dot(normal, normalize(vViewPosition)), 0., 1.);
float riverFresnel = .0204 + .9796 * pow(1. - riverFacing, 5.);
float riverPath = max(vTerrainWaterDepth, 0.) / max(riverFacing, .25);
vec3 riverAbsorption = vec3(.003333333, .002167007, .002);
vec3 riverTransmission = exp(-riverAbsorption * riverPath);
float riverCoverage = clamp(1. - dot(riverTransmission, vec3(.2126, .7152, .0722)), 0., .94);
float riverEdge = smoothstep(0., 8., vTerrainWaterDepth);
float riverAlpha = max(riverCoverage, riverFresnel * .65) * riverEdge;
if (riverAlpha < .001) discard;
// Low albedo is essential: the source WaterBaseColor is not Lambert diffuse.
// Transparency carries the actual river-bed mesh. Sky/sun reflection remains
// in linear HDR and uses the existing renderer's film/TOD output transform.
// Editor-calibrated volume tint, not a recovered native scattering solution.
vec3 riverVolume = vec3(.024, .064, .13) * terrainWaterLight;
outgoingLight = riverVolume * (1. - riverTransmission) / max(riverCoverage, .001)
  + outgoingLight * mix(.7, 1., riverFacing) / max(riverAlpha, .025);
diffuseColor.a = riverAlpha;
#include <opaque_fragment>`
      )
    }
    material.customProgramCacheKey = () => 'home-terrain-river-v1'
    object.material = applyEnvironmentLighting(material)
    source.dispose()
    count++
  })

  return { count, recentlyVisible: () => performance.now() - lastDraw < 250 }
}

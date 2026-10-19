import {
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { homeMountainPlacements } from '@/lib/homeSkyData'
import { matrixTransform } from '@/lib/matrixTransform'
import type { HomeTodSample } from '@/lib/homeTod'
import { applyEnvironmentLighting } from '@nuan5-pro/render'

const fogShader = /* glsl */ `
uniform vec3 homeFogLayer;
uniform vec3 homeSecondFogLayer;
uniform vec3 homeFogColor;
uniform vec3 homeSecondFogColor;
uniform float homeFogStart;
varying vec3 homeBackdropPosition;
float homeFogDepth(vec3 layer, vec3 start, vec3 ray) {
  float falloff = layer.y * .001;
  float change = clamp(falloff * ray.z, -80., 80.);
  float integral = abs(change) < .001 ? .69314718 : (1. - exp2(-change)) / change;
  float origin = exp2(clamp(-falloff * (start.z - layer.z), -80., 80.));
  return max(0., layer.x * .001 * origin * integral * length(ray));
}
`

/** Source distant geometry, excluded from selection, shadows and sky capture.
 * Height fog is analytic two-layer absorption; native aerial/volumetric fog is
 * not reproduced. LOD0 uses its own rock layer, never the unrelated LOD2 atlas. */
export function createHomeMountains() {
  const root = new Group()
  root.name = 'home-distant-mountains'
  root.userData.excludeFromHomeCapture = true
  root.visible = false
  const uniforms = {
    homeFogLayer: { value: new Vector3() },
    homeSecondFogLayer: { value: new Vector3() },
    homeFogColor: { value: new Vector3() },
    homeSecondFogColor: { value: new Vector3() },
    homeFogStart: { value: 4000 },
  }
  const instances: InstancedMesh[] = []

  // The sky owner keeps shared geometry/material/texture resources alive.
  function setAssets(sources: ReadonlyMap<string, Mesh>) {
    for (const id of new Set(homeMountainPlacements.map((item) => item.mesh))) {
      const source = sources.get(`S_Nature_MountainStone_${id}`)
      if (!source || !(source.material instanceof MeshStandardMaterial))
        throw new Error(`Invalid home mountain ${id}`)
      const material = applyEnvironmentLighting(source.material)
      const compile = material.onBeforeCompile
      material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer)
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = 'varying vec3 homeBackdropPosition;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          /* glsl */ `
          #include <project_vertex>
          vec4 backdrop = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            backdrop = instanceMatrix * backdrop;
          #endif
          homeBackdropPosition = (modelMatrix * backdrop).xyz;
          gl_Position.z = gl_Position.w * .999999;
        `
        )
        shader.fragmentShader = fogShader + shader.fragmentShader
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          vec3 ray = homeBackdropPosition - cameraPosition;
          float startFraction = min(1., homeFogStart / max(length(ray), 1.));
          vec3 origin = cameraPosition + ray * startFraction;
          ray *= 1. - startFraction;
          float fog1 = homeFogDepth(homeFogLayer, origin, ray);
          float fog2 = homeFogDepth(homeSecondFogLayer, origin, ray);
          float fogDepth = fog1 + fog2;
          vec3 fogColor = (homeFogColor * fog1 + homeSecondFogColor * fog2) / max(fogDepth, 1e-6);
          outgoingLight = mix(fogColor, outgoingLight, exp2(-fogDepth));
          #include <opaque_fragment>
        `
        )
      }
      material.customProgramCacheKey = () => 'home-source-mountain-fog-v1'
      const placements = homeMountainPlacements.filter((placement) => placement.mesh === id)
      const mesh = new InstancedMesh(source.geometry, material, placements.length)
      // glTF metre/Y-up -> source centimetre/Z-up. The export swaps Y/Z;
      // the data->world reflection below restores the rendered handedness once.
      const conversion = new Matrix4().set(100, 0, 0, 0, 0, 0, 100, 0, 0, 100, 0, 0, 0, 0, 0, 1)
      placements.forEach((placement, index) => {
        const [roll, pitch, yaw] = placement.rotation.map((value) => (value * Math.PI) / 180)
        const rotation = new Quaternion().setFromEuler(new Euler(-roll!, -pitch!, yaw!, 'ZYX'))
        const transform = new Matrix4().compose(
          new Vector3(...placement.position),
          rotation,
          new Vector3(...placement.scale)
        )
        matrixTransform.applyParentFlipInPlace(transform)
        mesh.setMatrixAt(index, transform.multiply(conversion))
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.frustumCulled = false
      mesh.renderOrder = -9997
      mesh.raycast = () => {}
      root.add(mesh)
      instances.push(mesh)
    }
  }

  return {
    root,
    setAssets,
    update(sample: HomeTodSample) {
      const atmosphere = sample.atmosphere
      uniforms.homeFogLayer.value.fromArray(atmosphere.fog)
      uniforms.homeSecondFogLayer.value.fromArray(atmosphere.secondFog)
      uniforms.homeFogColor.value.fromArray(atmosphere.fogColor)
      uniforms.homeSecondFogColor.value.fromArray(atmosphere.secondFogColor)
      uniforms.homeFogStart.value = atmosphere.fogStart
    },
    dispose() {
      root.removeFromParent()
      instances.forEach((mesh) => mesh.dispose())
      instances.length = 0
    },
  }
}

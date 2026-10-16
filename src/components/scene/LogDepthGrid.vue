<script setup lang="ts">
import { markRaw, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { useLoop } from '@tresjs/core'
import {
  Color,
  DoubleSide,
  Mesh,
  Plane,
  ShaderMaterial,
  Vector3,
  type ColorRepresentation,
  type Side,
} from 'three'

interface Props {
  args?: [number, number]
  cellSize?: number
  sectionSize?: number
  fadeDistance?: number
  fadeStrength?: number
  fadeFrom?: number
  cellThickness?: number
  sectionThickness?: number
  cellColor?: ColorRepresentation
  sectionColor?: ColorRepresentation
  infiniteGrid?: boolean
  followCamera?: boolean
  side?: Side
}

interface GridUniforms {
  cellSize: { value: number }
  sectionSize: { value: number }
  fadeDistance: { value: number }
  fadeStrength: { value: number }
  fadeFrom: { value: number }
  cellThickness: { value: number }
  sectionThickness: { value: number }
  cellColor: { value: Color }
  sectionColor: { value: Color }
  infiniteGrid: { value: boolean }
  followCamera: { value: boolean }
  worldCamProjPosition: { value: Vector3 }
  worldPlanePosition: { value: Vector3 }
}

const props = withDefaults(defineProps<Props>(), {
  args: () => [1, 1] as [number, number],
  cellSize: 0.5,
  sectionSize: 1,
  fadeDistance: 100,
  fadeStrength: 1,
  fadeFrom: 1,
  cellThickness: 0.5,
  sectionThickness: 1,
  cellColor: '#000000',
  sectionColor: '#000000',
  infiniteGrid: false,
  followCamera: false,
  side: DoubleSide,
})

const meshRef = ref<any | null>(null)
const plane = new Plane()
const upVector = new Vector3(0, 1, 0)
const zeroVector = new Vector3(0, 0, 0)
const scratchProjectedCamera = new Vector3()
const scratchPlanePosition = new Vector3()
const scratchCellColor = new Color()
const scratchSectionColor = new Color()

const uniforms: GridUniforms = {
  cellSize: { value: props.cellSize },
  sectionSize: { value: props.sectionSize },
  fadeDistance: { value: props.fadeDistance },
  fadeStrength: { value: props.fadeStrength },
  fadeFrom: { value: props.fadeFrom },
  cellThickness: { value: props.cellThickness },
  sectionThickness: { value: props.sectionThickness },
  cellColor: { value: new Color(props.cellColor) },
  sectionColor: { value: new Color(props.sectionColor) },
  infiniteGrid: { value: props.infiniteGrid },
  followCamera: { value: props.followCamera },
  worldCamProjPosition: { value: new Vector3() },
  worldPlanePosition: { value: new Vector3() },
}

const material = markRaw(
  new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>

        varying vec3 localPosition;
        varying vec4 worldPosition;

        uniform vec3 worldCamProjPosition;
        uniform vec3 worldPlanePosition;
        uniform float fadeDistance;
        uniform bool infiniteGrid;
        uniform bool followCamera;

        void main() {
          localPosition = position.xzy;
          if (infiniteGrid) localPosition *= 1.0 + fadeDistance;

          worldPosition = modelMatrix * vec4(localPosition, 1.0);
          if (followCamera) {
            worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
            localPosition = (inverse(modelMatrix) * worldPosition).xyz;
          }

          gl_Position = projectionMatrix * viewMatrix * worldPosition;
          #include <logdepthbuf_vertex>
        }
      `,
    fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>

        varying vec3 localPosition;
        varying vec4 worldPosition;

        uniform vec3 worldCamProjPosition;
        uniform float cellSize;
        uniform float sectionSize;
        uniform vec3 cellColor;
        uniform vec3 sectionColor;
        uniform float fadeDistance;
        uniform float fadeStrength;
        uniform float fadeFrom;
        uniform float cellThickness;
        uniform float sectionThickness;

        float getGrid(float size, float thickness) {
          vec2 r = localPosition.xz / size;
          vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
          float line = min(grid.x, grid.y) + 1.0 - thickness;
          return 1.0 - min(line, 1.0);
        }

        void main() {
          float g1 = getGrid(cellSize, cellThickness);
          float g2 = getGrid(sectionSize, sectionThickness);

          vec3 from = worldCamProjPosition * vec3(fadeFrom);
          float dist = distance(from, worldPosition.xyz);
          float d = 1.0 - min(dist / fadeDistance, 1.0);
          vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));

          gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
          gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
          if (gl_FragColor.a <= 0.0) discard;

          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <logdepthbuf_fragment>
        }
    `,
    transparent: true,
    depthTest: true,
    // Ground annotation is blended before furniture transparency; it must not
    // become a sparse depth occluder for surfaces below the reference plane.
    depthWrite: false,
    side: props.side,
  })
) as ShaderMaterial & { uniforms: GridUniforms }

function getMeshInstance(raw: any): Mesh | null {
  if (!raw) return null
  return (raw.instance || raw.value || raw) as Mesh
}

watchEffect(() => {
  const nextUniforms = material.uniforms
  nextUniforms.cellSize.value = props.cellSize
  nextUniforms.sectionSize.value = props.sectionSize
  nextUniforms.fadeDistance.value = props.fadeDistance
  nextUniforms.fadeStrength.value = props.fadeStrength
  nextUniforms.fadeFrom.value = props.fadeFrom
  nextUniforms.cellThickness.value = props.cellThickness
  nextUniforms.sectionThickness.value = props.sectionThickness
  nextUniforms.infiniteGrid.value = props.infiniteGrid
  nextUniforms.followCamera.value = props.followCamera
  material.side = props.side
})

watch(
  () => props.cellColor,
  (color) => {
    material.uniforms.cellColor.value.copy(scratchCellColor.set(color))
  },
  { immediate: true }
)

watch(
  () => props.sectionColor,
  (color) => {
    material.uniforms.sectionColor.value.copy(scratchSectionColor.set(color))
  },
  { immediate: true }
)

const { onBeforeRender } = useLoop()
onBeforeRender(({ camera }) => {
  const mesh = getMeshInstance(meshRef.value)
  const activeCamera = camera.value
  if (!mesh || !activeCamera) return

  plane.setFromNormalAndCoplanarPoint(upVector, zeroVector).applyMatrix4(mesh.matrixWorld)
  plane.projectPoint(activeCamera.position, scratchProjectedCamera)
  scratchPlanePosition.set(0, 0, 0).applyMatrix4(mesh.matrixWorld)

  const uniforms = material.uniforms
  uniforms.worldCamProjPosition.value.copy(scratchProjectedCamera)
  uniforms.worldPlanePosition.value.copy(scratchPlanePosition)
})

onBeforeUnmount(() => {
  material.dispose()
})
</script>

<template>
  <TresMesh ref="meshRef" :frustum-culled="false" :render-order="-1">
    <TresPlaneGeometry :args="args" />
    <primitive :object="material" attach="material" />
  </TresMesh>
</template>

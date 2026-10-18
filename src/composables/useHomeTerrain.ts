import { onUnmounted, shallowRef, watch, type Ref } from 'vue'
import { Box3, Mesh, Texture, type BufferGeometry, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { applyEnvironmentLighting } from '@nuan5-pro/render'
import terrainUrl from '@/assets/terrain/home-terrain.glb?url'
import { invalidateScene } from './useSceneInvalidate'
import { useSettingsStore } from '@/stores/settingsStore'
import { installHomeTerrainWater } from './renderer/homeTerrainWater'

function disposeTerrain(root: Object3D) {
  const geometry = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometry.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
  })
  const images = new Set<unknown>()
  for (const texture of textures) {
    images.add(texture.source.data)
    texture.dispose()
  }
  for (const image of images)
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
  materials.forEach((material) => material.dispose())
  geometry.forEach((value) => value.dispose())
}

/** An independent, immutable scene asset. It never enters furniture registries,
 * item selection, save files, or the editable item transform hierarchy. */
export function useHomeTerrain(enabled: Ref<boolean>) {
  const settings = useSettingsStore()
  const object = shallowRef<Object3D | null>(null)
  const bounds = shallowRef<Box3 | null>(null)
  const error = shallowRef<string | null>(null)
  const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/')
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
  let controller: AbortController | null = null
  let generation = 0

  watch(
    enabled,
    async (active) => {
      const request = ++generation
      controller?.abort()
      controller = null
      if (!active || object.value) return
      const signal = (controller = new AbortController()).signal
      error.value = null
      try {
        const resource = await fetch(terrainUrl, { signal })
        if (!resource.ok) throw new Error(`Terrain GLB HTTP ${resource.status}`)
        const bytes = await resource.arrayBuffer()
        if (request !== generation) return
        const gltf = await loader.parseAsync(bytes, '')
        if (request !== generation) {
          disposeTerrain(gltf.scene)
          return
        }
        gltf.scene.name = 'home-terrain'
        installHomeTerrainWater(gltf.scene, () => ({
          mode: settings.settings.lightingMode,
          minute: settings.settings.todMinute,
        }))
        gltf.scene.traverse((node) => {
          if (!(node instanceof Mesh)) return
          node.receiveShadow = true
          // Island geometry receives the world-space furniture shadow map, but
          // does not itself become an additional terrain caster.
          node.castShadow = false
          for (const material of Array.isArray(node.material) ? node.material : [node.material])
            applyEnvironmentLighting(material)
        })
        gltf.scene.updateMatrixWorld(true)
        bounds.value = new Box3().setFromObject(gltf.scene)
        object.value = gltf.scene
        invalidateScene()
      } catch (cause) {
        if (request !== generation || signal.aborted) return
        error.value = cause instanceof Error ? cause.message : String(cause)
        console.error('[HomeTerrain]', cause)
        invalidateScene()
      }
    },
    { immediate: true }
  )

  onUnmounted(() => {
    generation++
    controller?.abort()
    draco.dispose()
    if (object.value) disposeTerrain(object.value)
    object.value = null
    bounds.value = null
  })
  return { object, bounds, error }
}

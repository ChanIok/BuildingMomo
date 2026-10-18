import { Vector3 } from 'three'
import { furnitureRender, readyFurnitureRender } from './useFurnitureRender'

/** Editor geometry queries share the active viewport's package-owned resources. */
const modelQueries = {
  getModelBoundingBox(id: number) {
    return furnitureRender.value?.getModelBounds(id) ?? null
  },
  getUnloadedModels(ids: number[]) {
    return ids.filter((id) => !furnitureRender.value?.getModelBounds(id))
  },
  async preloadModels(
    ids: number[],
    onProgress?: (completed: number, total: number, failed: number) => void,
    isStale?: () => boolean
  ) {
    if (isStale?.()) return
    const layer = await readyFurnitureRender()
    await layer.load(ids, {
      onProgress: ({ phase, completed, total }) => {
        if (phase === 'preparing' && !isStale?.()) onProgress?.(completed, total, 0)
      },
    })
  },
  getStats() {
    const count = furnitureRender.value?.batches.size ?? 0
    return { activeMeshes: count, cachedGeometries: count, cachedColoredMaterials: 0 }
  },
  getModelDebugInfo(id: number) {
    const mesh = furnitureRender.value?.batches.get(id)
    if (!mesh) return null
    const geometry = mesh.geometry
    const box = geometry.boundingBox!
    const size = box.getSize(new Vector3())
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return {
      vertexCount: geometry.getAttribute('position').count,
      triangleCount: (geometry.index?.count ?? geometry.getAttribute('position').count) / 3,
      boundingBox: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
      textureReferences: materials.reduce(
        (sum, material) =>
          sum +
          Object.values(material.userData.textureInputs ?? {}).reduce<number>(
            (count, input: any) => count + input.images.length,
            0
          ),
        0
      ),
      meshMaterialCounts:
        furnitureRender.value?.getConfig(id)?.meshes.map((mesh) => mesh.slots.length) ?? [],
    }
  },
}

export type ThreeModelManager = typeof modelQueries
export function getThreeModelManager(): ThreeModelManager {
  return modelQueries
}

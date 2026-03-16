import {
  Matrix4,
  Mesh,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { getGLBCacheEntry, putGLBCacheEntry } from '@/lib/glbCache'
import type { ModelAssetProfile } from '@/types/furniture'
import {
  buildMaterialRegistryFromGLTF,
  disposeMaterialRegistry,
  resolveMaterialBaseName,
  type MaterialRegistry,
} from './materialPipeline'

/** 单个 Mesh 节点的原始资产快照（从 GLTF scene 中提取，供 item 复用） */
export interface MeshAssetEntry {
  geometry: BufferGeometry
  material: Material
  localMatrix: Matrix4
  baseName: string | null
}

/**
 * 单个 GLB 文件解析出的共享资产包。
 * 多个 furniture item 可共享同一份 MeshAssetData（通过 meshAssetCache）。
 * dispose() 释放原始 GLB 资产，但不影响各 item clone 出来的几何体。
 */
export interface MeshAssetData {
  meshEntries: MeshAssetEntry[]
  materialRegistry: MaterialRegistry
  dispose: () => void
}

/** 共享 mesh 资产的缓存键：profile + meshPath + hash，确保不同版本的同名 GLB 不互相污染 */
export function buildMeshAssetCacheKey(
  profile: ModelAssetProfile,
  meshPath: string,
  hash?: string
): string {
  return `${profile}:${meshPath}:${hash ?? 'nohash'}`
}

/** 收集材质上所有已挂载的贴图，用于 dispose 时统一释放 */
function collectMaterialTextures(material: Material): Texture[] {
  const textures: Texture[] = []
  const candidateKeys = [
    'map',
    'alphaMap',
    'aoMap',
    'bumpMap',
    'displacementMap',
    'emissiveMap',
    'envMap',
    'lightMap',
    'metalnessMap',
    'normalMap',
    'roughnessMap',
  ] as const

  for (const key of candidateKeys) {
    const value = (material as unknown as Record<string, unknown>)[key]
    if ((value as Texture | undefined)?.isTexture) {
      textures.push(value as Texture)
    }
  }

  return textures
}

/**
 * 从已解析的 GLTF 对象提取共享 mesh 资产包（MeshAssetData）。
 * 遍历场景树收集所有 Mesh 节点，建立材质注册表，并挂载 dispose 方法。
 * 注意：geometry/material/texture 均为 GLB 原始对象，item 使用时需 clone。
 */
export function createMeshAssetData(
  result: GLTF,
  meshPath: string,
  profile: ModelAssetProfile,
  resolveExternalTextureUrl?: (meshPath: string, textureName: string) => string | null
): MeshAssetData {
  const meshEntries: MeshAssetEntry[] = []
  const sourceGeometries = new Set<BufferGeometry>()
  const sourceMaterials = new Set<Material>()
  const sourceTextures = new Set<Texture>()

  result.scene.traverse((child: Object3D) => {
    if (!(child as any).isMesh) return

    const mesh = child as Mesh
    const material = mesh.material as Material
    sourceGeometries.add(mesh.geometry)
    sourceMaterials.add(material)

    for (const texture of collectMaterialTextures(material)) {
      sourceTextures.add(texture)
    }

    meshEntries.push({
      geometry: mesh.geometry,
      material,
      localMatrix: mesh.matrix.clone(),
      baseName: resolveMaterialBaseName(material),
    })
  })

  const materialRegistry = buildMaterialRegistryFromGLTF(
    result,
    meshPath,
    profile,
    resolveExternalTextureUrl
  )

  return {
    meshEntries,
    materialRegistry,
    dispose: () => {
      for (const geometry of sourceGeometries) geometry.dispose()
      for (const material of sourceMaterials) material.dispose()
      for (const texture of sourceTextures) texture.dispose()
      disposeMaterialRegistry(materialRegistry)
    },
  }
}

export async function loadGLBModel(
  gltfLoader: GLTFLoader,
  profile: ModelAssetProfile,
  modelBaseUrl: string,
  meshPath: string,
  hash?: string
): Promise<GLTF | null> {
  const fileName = meshPath.endsWith('.glb') ? meshPath : `${meshPath}.glb`
  const url = `${modelBaseUrl}${fileName}`

  try {
    if (hash) {
      const entry = await getGLBCacheEntry(profile, meshPath)
      if (entry?.hash === hash) {
        return (await gltfLoader.parseAsync(entry.buffer, url)) as GLTF
      }
    }

    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()

    if (hash) putGLBCacheEntry(profile, meshPath, hash, buffer).catch(() => {})

    return (await gltfLoader.parseAsync(buffer, url)) as GLTF
  } catch (error) {
    console.warn(`[ModelManager] Failed to load GLB: ${meshPath}`, error)
    return null
  }
}

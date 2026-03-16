import { DynamicDrawUsage, InstancedMesh, type Material, Box3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { MAX_RENDER_INSTANCES } from '@/types/constants'
import type { ModelDyePlan } from '@/lib/modelDye'
import type { ModelAssetProfile } from '@/types/furniture'
import {
  buildMeshAssetCacheKey,
  createMeshAssetData,
  loadGLBModel,
  type MeshAssetData,
} from './modelManager/assetPipeline'
import { processGeometryForItem, type GeometryData } from './modelManager/geometryPipeline'
import {
  buildDyedMaterials,
  summarizeRegistryTextureSources,
} from './modelManager/materialPipeline'

/** GLB 文件并发加载上限（过高会阻塞带宽，过低会拖慢首屏） */
const MESH_ASSET_LOAD_CONCURRENCY = 6
/** 几何体构建（clone + 变换 + merge）并发上限，防止主线程长时间卡顿 */
const GEOMETRY_BUILD_CONCURRENCY = 4

interface ModelManagerStats {
  activeMeshes: number
  cachedGeometries: number
  cachedColoredMaterials: number
}

interface ModelDebugInfo {
  vertexCount: number
  triangleCount: number
  boundingBox: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
  }
  attributes: string[]
  materials: Array<{ name: string; baseName: string | null }>
  meshMaterialCounts: number[]
  registryBaseNames: string[]
  textureSourceMode: 'external' | 'embedded' | 'mixed' | 'unknown'
  externalTextureRefs: number
  embeddedTextureRefs: number
}

interface DisposeMeshOptions {
  evictColoredMaterial?: boolean
}

export interface ThreeModelManager {
  createInstancedMesh(
    itemId: number,
    cacheKey: string,
    instanceCount: number,
    dyePlan: ModelDyePlan
  ): Promise<InstancedMesh | null>
  getModelBoundingBox(itemId: number): Box3 | null
  getUnloadedModels(itemIds: number[]): number[]
  preloadModels(
    itemIds: number[],
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<void>
  disposeMesh(cacheKey: string, options?: DisposeMeshOptions): void
  dispose(): void
  getStats(): ModelManagerStats
  getModelDebugInfo(itemId: number): ModelDebugInfo | null
}

/**
 * 并发任务限制器：同时运行不超过 maxConcurrent 个 task，
 * 超出的请求排队等待，先进先出。
 */
function createTaskLimiter(maxConcurrent: number) {
  let activeCount = 0
  const queue: Array<() => void> = []

  const scheduleNext = () => {
    const next = queue.shift()
    if (next) next()
  }

  return async function runWithLimit<T>(task: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrent) {
      // 排队等待，直到有槽位空闲
      await new Promise<void>((resolve) => queue.push(resolve))
    }

    activeCount++
    try {
      return await task()
    } finally {
      activeCount--
      scheduleNext()
    }
  }
}

function getModelBaseUrl(profile: ModelAssetProfile): string {
  return import.meta.env.BASE_URL + `assets/furniture-model-${profile}/`
}

export function useThreeModelManager(profile: ModelAssetProfile): ThreeModelManager {
  const gameDataStore = useGameDataStore()

  const gltfLoader = new GLTFLoader()
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(import.meta.env.BASE_URL + 'draco/')
  gltfLoader.setDRACOLoader(dracoLoader)

  const modelBaseUrl = getModelBaseUrl(profile)

  /**
   * 资源所有权说明：
   * - `resolvedMeshAssets`: 拥有原始 GLB 几何体 / 材质 / 贴图
   * - `geometryCache`: 拥有 item 级合并几何体和默认 plain 材质，也是同步包围盒查询的数据来源
   * - `coloredMaterialCache`: 拥有按 `cacheKey` 生成的染色材质，可跨 mesh 重建复用
   * - `meshMap`: 仅保存 InstancedMesh 外壳，本身借用 geometry/material cache 中的资源
   *
   * 释放顺序必须先 `geometryCache`，再 `resolvedMeshAssets`，否则 plain fallback 可能悬挂到已释放贴图。
   */
  /** cacheKey（通常为 itemId + dyePlan）→ InstancedMesh */
  const meshMap = new Map<string, InstancedMesh>()

  /** itemId → 几何体数据，按 itemId 共享；染色按 dyePlan 分缓存在 coloredMaterialCache */
  const geometryCache = new Map<number, GeometryData>()

  /** itemId → 正在构建中的 GeometryData Promise，避免并发重复构建 */
  const geometryLoadingCache = new Map<number, Promise<GeometryData | null>>()

  /** profile + meshPath + hash → 共享 mesh 资产 Promise，避免同一 GLB 重复 parse */
  const meshAssetCache = new Map<string, Promise<MeshAssetData | null>>()

  /** 已完成解析的共享 mesh 资产，用于 dispose 时统一释放 */
  const resolvedMeshAssets = new Map<string, MeshAssetData>()

  /** cacheKey → 染色材质（与 meshMap 生命周期一致） */
  const coloredMaterialCache = new Map<string, Material | Material[]>()

  /** GLB 文件加载并发限制器 */
  const runAssetLoadTask = createTaskLimiter(MESH_ASSET_LOAD_CONCURRENCY)
  /** 几何体构建并发限制器（clone + 变换 + merge） */
  const runGeometryBuildTask = createTaskLimiter(GEOMETRY_BUILD_CONCURRENCY)

  /** Lite 模式贴图清单的加载 Promise（实例级缓存，避免多次请求） */
  let liteTextureManifestPromise: Promise<Map<string, string> | null> | null = null

  /** 确保 Lite 模式下的外链贴图清单已加载，非 Lite 模式下直接返回 */
  async function ensureLiteTextureManifestLoaded(): Promise<void> {
    if (profile !== 'lite') return

    if (!liteTextureManifestPromise) {
      liteTextureManifestPromise = gameDataStore.loadLiteTextureManifest()
    }

    await liteTextureManifestPromise
  }

  /**
   * 按需获取/加载共享 mesh 资产包（MeshAssetData）。
   * 内部处理并发排队和 settles 状态管理。
   */
  async function getMeshAsset(meshPath: string, hash?: string): Promise<MeshAssetData | null> {
    const cacheKey = buildMeshAssetCacheKey(profile, meshPath, hash)
    const cached = meshAssetCache.get(cacheKey)
    if (cached) return cached

    const pending = runAssetLoadTask(async () => {
      const result = await loadGLBModel(gltfLoader, profile, modelBaseUrl, meshPath, hash)
      if (!result) return null

      return createMeshAssetData(result, meshPath, profile, (candidateMeshPath, textureName) =>
        gameDataStore.getLiteTextureUrl(candidateMeshPath, textureName)
      )
    })

    // 统一在 settled 阶段管理两个 Map，避免写入逻辑分散到 task 内部
    const settled = pending
      .then((asset) => {
        if (asset) {
          resolvedMeshAssets.set(cacheKey, asset)
        } else {
          meshAssetCache.delete(cacheKey)
        }

        return asset
      })
      .catch((error) => {
        meshAssetCache.delete(cacheKey)
        throw error
      })

    meshAssetCache.set(cacheKey, settled)
    return settled
  }

  /**
   * 确保几何体数据已加载。若未加载，则启动构建流水线（几何体合并、变换、默认材质构建等）。
   */
  async function ensureGeometryData(itemId: number): Promise<GeometryData | null> {
    const cached = geometryCache.get(itemId)
    if (cached) return cached

    const pending = geometryLoadingCache.get(itemId)
    if (pending) return pending

    // manifest 加载放在 limiter 之外：它是网络请求，不应占用 geometry build 并发槽位
    await ensureLiteTextureManifestLoaded()

    const buildPromise = runGeometryBuildTask(async () => {
      const config = gameDataStore.getFurnitureModelConfig(itemId)
      if (!config || !config.meshes?.length) {
        console.warn(`[ModelManager] No model config for itemId: ${itemId}`)
        return null
      }

      const geomData = await processGeometryForItem(itemId, config, profile, getMeshAsset)
      if (geomData) {
        geometryCache.set(itemId, geomData)
      }

      return geomData ?? null
    }).finally(() => {
      geometryLoadingCache.delete(itemId)
    })

    geometryLoadingCache.set(itemId, buildPromise)
    return buildPromise
  }

  /**
   * 为指定家具创建 InstancedMesh。
   * 自动分配容量、构建/复用染色材质，并管理 InstancedMesh 实例。
   */
  async function createInstancedMesh(
    itemId: number,
    cacheKey: string,
    instanceCount: number,
    dyePlan: ModelDyePlan
  ): Promise<InstancedMesh | null> {
    if (meshMap.has(cacheKey)) {
      const existing = meshMap.get(cacheKey)!
      if (existing.instanceMatrix.count >= instanceCount) {
        return existing
      }

      console.log(
        `[ModelManager] 容量不足 ${cacheKey}: 需 ${instanceCount}, 当前 ${existing.instanceMatrix.count} → 重建`
      )
      // 内部重建时不 evict coloredMaterial：如果 dyePlan 没变，后续会从 coloredMaterialCache 复用
      disposeMesh(cacheKey)
    }

    const geomData = await ensureGeometryData(itemId)
    if (!geomData) return null

    let material: Material | Material[]
    if (dyePlan.mode === 'plain') {
      material = geomData.mergedMaterial
    } else {
      let coloredMat = coloredMaterialCache.get(cacheKey)
      if (!coloredMat) {
        coloredMat = await buildDyedMaterials(
          geomData.plainMaterials,
          geomData.meshBaseNames,
          geomData.slotMeshIndices,
          geomData.materialRegistry,
          dyePlan.dyeMap,
          `itemId=${itemId} cacheKey=${cacheKey}`
        )
        coloredMaterialCache.set(cacheKey, coloredMat)
      }

      material = coloredMat
    }

    // 容量分配：缓冲 +16，预留 *1.5，最小 32，上限 MAX_RENDER_INSTANCES
    const allocatedCapacity = Math.min(
      Math.max(instanceCount + 16, Math.floor(instanceCount * 1.5), 32),
      MAX_RENDER_INSTANCES
    )

    const instancedMesh = new InstancedMesh(geomData.geometry, material, allocatedCapacity)
    instancedMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    instancedMesh.count = 0

    meshMap.set(cacheKey, instancedMesh)
    return instancedMesh
  }

  /** 获取尚未加载模型数据的 itemId 列表 */
  function getUnloadedModels(itemIds: number[]): number[] {
    return Array.from(new Set(itemIds)).filter(
      (id) => !geometryCache.has(id) && !geometryLoadingCache.has(id)
    )
  }

  /**
   * 同步读取当前已预热的包围盒；若模型尚未进入 `geometryCache`，返回 `null`。
   */
  function getModelBoundingBox(itemId: number): Box3 | null {
    return geometryCache.get(itemId)?.boundingBox ?? null
  }

  /**
   * 预载指定的家具模型。
   * @param itemIds 家具 ID 列表
   * @param onProgress 进度回调 (current, total, failed)
   */
  async function preloadModels(
    itemIds: number[],
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<void> {
    const unloadedIds = Array.from(new Set(itemIds)).filter((id) => !geometryCache.has(id))

    if (unloadedIds.length === 0) {
      onProgress?.(0, 0, 0)
      return
    }

    console.log(`[ModelManager] Preloading ${unloadedIds.length} furniture models...`)
    let completed = 0
    let failed = 0

    await Promise.all(
      unloadedIds.map(async (itemId) => {
        try {
          const geomData = await ensureGeometryData(itemId)
          if (!geomData) failed++
        } catch (err) {
          console.error(`[ModelManager] Error processing itemId ${itemId}:`, err)
          failed++
        }

        completed++
        onProgress?.(completed, unloadedIds.length, failed)
      })
    )

    console.log(`[ModelManager] Complete: ${completed - failed}/${unloadedIds.length} models`)
  }

  /** 释放单个或数组形式的缓存材质 */
  function disposeCachedMaterial(material: Material | Material[]): void {
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else {
      material.dispose()
    }
  }

  /** 从缓存中移除并释放特定 cacheKey 对应的染色材质 */
  function evictColoredMaterial(cacheKey: string): void {
    const material = coloredMaterialCache.get(cacheKey)
    if (!material) return

    disposeCachedMaterial(material)
    coloredMaterialCache.delete(cacheKey)
  }

  /**
   * 移除 InstancedMesh 引用。
   * @param cacheKey 缓存键
   * @param options 是否顺便释放染色材质
   */
  function disposeMesh(cacheKey: string, options?: DisposeMeshOptions): void {
    meshMap.delete(cacheKey)

    if (options?.evictColoredMaterial) {
      evictColoredMaterial(cacheKey)
    }
  }

  /**
   * 释放 ModelManager 实例管理的所有资源。
   * 包括 InstancedMesh、几何体缓存、共享 GLB 资产和所有染色材质。
   */
  function dispose(): void {
    console.log('[ModelManager] Disposing resources...')
    meshMap.clear()
    geometryLoadingCache.clear()
    meshAssetCache.clear()

    // NOTE: geometryCache 必须先于 resolvedMeshAssets 释放。
    // 当 buildDefaultPlainMaterial 走 fallback 路径（无 registry 命中）时，
    // plainMaterials 持有的是 cloneSourceMaterialForItem 克隆体，其贴图引用自 GLB 原始材质。
    // 若先释放 resolvedMeshAssets（含原始贴图），geometryCache 的材质贴图会立即失效。
    for (const { geometry, mergedMaterial } of geometryCache.values()) {
      geometry.dispose()
      if (Array.isArray(mergedMaterial)) {
        mergedMaterial.forEach((mat) => mat.dispose())
      } else {
        mergedMaterial.dispose()
      }
    }
    geometryCache.clear()

    for (const asset of resolvedMeshAssets.values()) {
      asset.dispose()
    }
    resolvedMeshAssets.clear()

    for (const mat of coloredMaterialCache.values()) {
      disposeCachedMaterial(mat)
    }
    coloredMaterialCache.clear()
    liteTextureManifestPromise = null

    console.log('[ModelManager] Resources disposed')
  }

  /** 获取当前管理器的统计数据 */
  function getStats(): ModelManagerStats {
    return {
      activeMeshes: meshMap.size,
      cachedGeometries: geometryCache.size,
      cachedColoredMaterials: coloredMaterialCache.size,
    }
  }

  /**
   * 获取家具模型的详细调试信息。
   * 仅在模型已加载到几何体缓存时有效。
   */
  function getModelDebugInfo(itemId: number): ModelDebugInfo | null {
    const data = geometryCache.get(itemId)
    if (!data) return null

    const {
      geometry,
      plainMaterials,
      meshBaseNames,
      boundingBox,
      meshMaterialCounts,
      materialRegistry,
    } = data

    const vertexCount = geometry.attributes.position?.count ?? 0
    const indexCount = geometry.index?.count ?? 0
    const triangleCount = Math.floor(indexCount > 0 ? indexCount / 3 : vertexCount / 3)
    const sizeX = boundingBox.max.x - boundingBox.min.x
    const sizeY = boundingBox.max.y - boundingBox.min.y
    const sizeZ = boundingBox.max.z - boundingBox.min.z
    const { textureSourceMode, externalTextureRefs, embeddedTextureRefs } =
      summarizeRegistryTextureSources(materialRegistry)

    return {
      vertexCount,
      triangleCount,
      boundingBox: {
        min: [boundingBox.min.x, boundingBox.min.y, boundingBox.min.z] as [number, number, number],
        max: [boundingBox.max.x, boundingBox.max.y, boundingBox.max.z] as [number, number, number],
        size: [sizeX, sizeY, sizeZ] as [number, number, number],
      },
      attributes: Object.keys(geometry.attributes),
      materials: plainMaterials.map(({ name }, index) => ({
        name: name || '(unnamed)',
        baseName: meshBaseNames[index] ?? null,
      })),
      meshMaterialCounts,
      registryBaseNames: Array.from(materialRegistry.keys()),
      textureSourceMode,
      externalTextureRefs,
      embeddedTextureRefs,
    }
  }

  return {
    createInstancedMesh,
    getModelBoundingBox,
    getUnloadedModels,
    preloadModels,
    disposeMesh,
    dispose,
    getStats,
    getModelDebugInfo,
  }
}

let managerInstance: ThreeModelManager | null = null
let managerProfile: ModelAssetProfile | null = null

export function getThreeModelManager(): ThreeModelManager {
  const settingsStore = useSettingsStore()
  const desiredProfile = settingsStore.settings.modelAssetProfile

  if (!managerInstance || managerProfile !== desiredProfile) {
    if (managerInstance) {
      console.log(`[ModelManager] 资源档位切换 ${managerProfile} -> ${desiredProfile}`)
      managerInstance.dispose()
    }

    managerInstance = useThreeModelManager(desiredProfile)
    managerProfile = desiredProfile
    console.log(`[ModelManager] 创建新实例 (${desiredProfile})`)
  }

  return managerInstance
}

export function disposeThreeModelManager(): void {
  if (managerInstance) {
    console.log('[ModelManager] 清理资源')
    managerInstance.dispose()
    managerInstance = null
    managerProfile = null
  }
}

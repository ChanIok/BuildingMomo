import {
  InstancedMesh,
  DynamicDrawUsage,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Color,
  Matrix4,
  Quaternion,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getModelLoader } from './useModelLoader'
import { useGameDataStore } from '@/stores/gameDataStore'
import { MAX_RENDER_INSTANCES } from '@/types/constants'

/**
 * 标准化几何体属性，确保所有几何体具有兼容的属性集
 * 策略：如果某个属性不是所有几何体都有，则从所有几何体中删除该属性
 *
 * @param geometries 要标准化的几何体数组
 */
function normalizeGeometryAttributes(geometries: BufferGeometry[]): void {
  if (geometries.length <= 1) return

  // 1. 收集所有几何体的属性名称
  const attributeSets = geometries.map((geom) => new Set(Object.keys(geom.attributes)))

  // 2. 找出所有几何体共有的属性（交集）
  const commonAttributes = new Set(attributeSets[0])
  for (let i = 1; i < attributeSets.length; i++) {
    const currentSet = attributeSets[i]!
    for (const attr of commonAttributes) {
      if (!currentSet.has(attr)) {
        commonAttributes.delete(attr)
      }
    }
  }

  // 3. 删除不是所有几何体都有的属性
  for (let i = 0; i < geometries.length; i++) {
    const geom = geometries[i]!
    const attrs = Object.keys(geom.attributes)

    for (const attr of attrs) {
      if (!commonAttributes.has(attr)) {
        geom.deleteAttribute(attr)
      }
    }
  }

  console.log(
    `[ModelManager] 标准化完成，保留的共同属性: ${Array.from(commonAttributes).join(', ')}`
  )
}

/**
 * 处理家具几何体：加载、变换、合并、优化
 * @param itemId 家具 ID
 * @param config 家具模型配置
 * @param modelLoader 模型加载器实例
 * @param useCache 是否使用缓存（true=getModel, false=loadModel）
 * @returns {geometry, material} 或 undefined
 */
async function processGeometryForItem(
  itemId: number,
  config: any,
  modelLoader: ReturnType<typeof getModelLoader>,
  useCache: boolean = false
): Promise<{ geometry: BufferGeometry; material: Material | Material[] } | undefined> {
  // 加载所有 mesh 文件
  const allGeometries: BufferGeometry[] = []
  const materials: Material[] = []
  const tempMatrix = new Matrix4()
  const tempQuat = new Quaternion()
  const tempScale = new Vector3()
  const tempTrans = new Vector3()

  for (const meshConfig of config.meshes) {
    // 根据 useCache 参数选择加载方式
    const model = useCache
      ? modelLoader.getModel(meshConfig.path)
      : await modelLoader.loadModel(meshConfig.path)

    if (!model) {
      console.warn(
        `[ModelManager] Failed to ${useCache ? 'get cached' : 'load'} mesh: ${meshConfig.path}`
      )
      continue
    }

    // 提取此 mesh 的所有几何体
    model.traverse((child) => {
      if ((child as any).isMesh) {
        const mesh = child as Mesh
        const geom = mesh.geometry.clone()

        // 1. 应用 mesh 自身的局部变换
        geom.applyMatrix4(mesh.matrix)

        // 2. 应用配置中的 transform
        // 构建变换矩阵：Scale → Rotation → Translation
        // scale 坐标系转换：Y-Up → Z-Up（交换 Y 和 Z 分量，与 rotation/trans 保持一致）
        tempScale.set(
          meshConfig.scale.x, // X 保持
          meshConfig.scale.z, // Y ← Z
          meshConfig.scale.y // Z ← Y
        )
        // 四元数坐标系转换：Y-Up → Z-Up（交换 Y 和 Z 分量）
        tempQuat.set(
          meshConfig.rotation.x,
          meshConfig.rotation.z, // Y ← Z
          meshConfig.rotation.y, // Z ← Y
          meshConfig.rotation.w
        )
        // trans 坐标系转换：Y-Up → Z-Up（交换 Y 和 Z，Y 取反，并除以100补偿缩放）
        tempTrans.set(
          meshConfig.trans.x / 100, // X 保持
          meshConfig.trans.z / 100, // Y ← Z
          -meshConfig.trans.y / 100 // Z ← -Y
        )

        tempMatrix.compose(tempTrans, tempQuat, tempScale)
        geom.applyMatrix4(tempMatrix)

        allGeometries.push(geom)

        // 收集所有材质（每个 mesh 都可能有不同的材质）
        materials.push(mesh.material as Material)
      }
    })
  }

  if (allGeometries.length === 0) {
    console.warn(`[ModelManager] No geometries loaded for itemId: ${itemId}`)
    return undefined
  }

  // 标准化几何体属性（确保属性一致性，避免合并失败）
  if (allGeometries.length > 1) {
    normalizeGeometryAttributes(allGeometries)
  }

  // 合并所有几何体（启用材质分组以保留多材质信息）
  let geometry: BufferGeometry
  if (allGeometries.length === 1) {
    geometry = allGeometries[0]!
  } else {
    const merged = mergeGeometries(allGeometries, true)
    if (!merged) {
      console.warn(`[ModelManager] Failed to merge geometries for itemId: ${itemId}`)
      return undefined
    }
    geometry = merged
  }

  // 3. 应用 root_offset（坐标系转换）
  const offset = config.root_offset
  geometry.translate(offset.y / 100, offset.z / 100, offset.x / 100)

  // 3.5. 单位转换：米 → 厘米（x100）
  geometry.scale(100, 100, 100)

  // 优化材质：保留原始纹理，轻微增亮
  let material: Material | Material[]
  if (materials.length > 0) {
    // 对每个材质进行优化
    for (const mat of materials) {
      if ((mat as any).isMeshStandardMaterial) {
        const stdMat = mat as MeshStandardMaterial
        stdMat.roughness = Math.min(stdMat.roughness, 0.6)
        stdMat.metalness = Math.min(stdMat.metalness, 0.2)
        if (!stdMat.emissive || stdMat.emissive.getHex() === 0) {
          stdMat.emissive = new Color(0x222222)
        }
        stdMat.emissiveIntensity = Math.max(stdMat.emissiveIntensity, 0.15)
      }
    }
    // 返回材质数组（如果只有一个材质，也保持数组形式以支持材质分组）
    material = materials.length > 1 ? materials : materials[0]!
  } else {
    material = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x222222,
      emissiveIntensity: 0.15,
      roughness: 0.6,
      metalness: 0.2,
    })
  }

  // 4. 坐标系转换：GLTF (右手系 Y-Up) → 场景 (左手系 Z-Up)
  // 步骤 1：镜像 X 轴（右手系 → 左手系）
  geometry.scale(-1, 1, 1)

  // 步骤 2：旋转到 Z-Up
  geometry.rotateY(Math.PI / 2)
  geometry.rotateX(Math.PI / 2)

  // 注意：保留模型在 Blender 中设置的原点位置，不进行额外的对齐操作

  return { geometry, material }
}

/**
 * Three.js 模型管理器 (Instanced Rendering for Models)
 *
 * 职责：
 * 1. 管理多个 InstancedMesh（每种模型一个）
 * 2. 负责模型的加载和 InstancedMesh 的创建
 * 3. 支持多 mesh 家具的加载和合并
 *
 * 特性：
 * - 按 itemId 分组渲染
 * - 动态创建和销毁 InstancedMesh
 * - 单例模式管理
 */
export function useThreeModelManager() {
  const modelLoader = getModelLoader()
  const gameDataStore = useGameDataStore()

  // itemId -> InstancedMesh 的映射
  const meshMap = new Map<number, InstancedMesh>()

  // itemId -> 几何体和材质的缓存（用于创建 InstancedMesh）
  const geometryCache = new Map<
    number,
    { geometry: BufferGeometry; material: Material | Material[] }
  >()

  /**
   * 为指定家具创建 InstancedMesh
   * @param itemId 家具 ItemID
   * @param instanceCount 实例数量
   * @returns Promise<InstancedMesh | null> 成功返回 InstancedMesh，失败返回 null
   */
  async function createInstancedMesh(
    itemId: number,
    instanceCount: number
  ): Promise<InstancedMesh | null> {
    // 检查是否已存在
    if (meshMap.has(itemId)) {
      const existingMesh = meshMap.get(itemId)!
      // 如果实例数量足够，直接返回
      if (existingMesh.count >= instanceCount) {
        return existingMesh
      }
      // 否则需要重建（实例数量不能动态扩展）
      disposeMesh(itemId)
    }

    // 尝试从缓存获取几何体和材质
    let geometryData = geometryCache.get(itemId)

    if (!geometryData) {
      // 从 furniture_db 获取配置
      const config = gameDataStore.getFurnitureModelConfig(itemId)
      if (!config || !config.meshes || config.meshes.length === 0) {
        console.warn(`[ModelManager] No model config found for itemId: ${itemId}`)
        return null
      }

      // 使用共享函数处理几何体
      const result = await processGeometryForItem(itemId, config, modelLoader, false)
      if (!result) {
        return null
      }
      geometryData = result

      // 缓存几何体和材质
      geometryCache.set(itemId, geometryData)
    }

    // 创建 InstancedMesh
    const instancedMesh = new InstancedMesh(
      geometryData.geometry,
      geometryData.material,
      Math.min(instanceCount, MAX_RENDER_INSTANCES)
    )

    // 关闭视锥体剔除（与现有代码保持一致）
    instancedMesh.frustumCulled = false
    // 确保 Raycaster 始终检测实例
    instancedMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    instancedMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    instancedMesh.count = 0 // 初始不显示任何实例

    // 缓存
    meshMap.set(itemId, instancedMesh)

    return instancedMesh
  }

  /**
   * 获取指定家具的 InstancedMesh
   * @param itemId 家具 ItemID
   * @returns InstancedMesh | null
   */
  function getMesh(itemId: number): InstancedMesh | null {
    return meshMap.get(itemId) || null
  }

  /**
   * 获取所有 InstancedMesh
   * @returns InstancedMesh[]
   */
  function getAllMeshes(): InstancedMesh[] {
    return Array.from(meshMap.values())
  }

  /**
   * 批量预加载家具模型
   * @param itemIds 家具 ItemID 列表
   */
  async function preloadModels(itemIds: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(itemIds)) // 去重

    // 过滤出未加载的家具
    const unloadedIds = uniqueIds.filter((id) => !geometryCache.has(id))

    if (unloadedIds.length === 0) {
      return // 所有模型已加载
    }

    console.log(`[ModelManager] Preloading ${unloadedIds.length} furniture models...`)

    // 收集所有需要加载的 mesh 文件路径
    const meshPaths: string[] = []
    for (const itemId of unloadedIds) {
      const config = gameDataStore.getFurnitureModelConfig(itemId)
      if (config && config.meshes) {
        for (const mesh of config.meshes) {
          meshPaths.push(mesh.path)
        }
      }
    }

    // 并行加载所有 mesh 文件
    await modelLoader.preloadModels(meshPaths)

    // 提取几何体和材质并缓存
    for (const itemId of unloadedIds) {
      const config = gameDataStore.getFurnitureModelConfig(itemId)
      if (!config || !config.meshes || config.meshes.length === 0) {
        continue
      }

      // 使用共享函数处理几何体（从缓存加载）
      const geometryData = await processGeometryForItem(itemId, config, modelLoader, true)
      if (!geometryData) {
        continue
      }

      geometryCache.set(itemId, geometryData)
    }

    console.log(`[ModelManager] Preload complete`)
  }

  /**
   * 销毁指定家具的 InstancedMesh
   * @param itemId 家具 ItemID
   */
  function disposeMesh(itemId: number): void {
    const mesh = meshMap.get(itemId)
    if (mesh) {
      // 注意：不销毁几何体和材质（它们在 geometryCache 中被复用）
      meshMap.delete(itemId)
      console.log(`[ModelManager] Disposed InstancedMesh for itemId ${itemId}`)
    }
  }

  /**
   * 清理所有资源
   */
  function dispose(): void {
    console.log('[ModelManager] Disposing resources...')

    // 清空 InstancedMesh 映射（不销毁几何体和材质）
    meshMap.clear()

    // 销毁几何体和材质缓存
    for (const [, { geometry, material }] of geometryCache.entries()) {
      geometry.dispose()
      if (Array.isArray(material)) {
        material.forEach((m) => m.dispose())
      } else {
        material.dispose()
      }
    }
    geometryCache.clear()

    // 清理加载器缓存
    modelLoader.clearCache()

    console.log('[ModelManager] Resources disposed')
  }

  /**
   * 获取统计信息
   */
  function getStats() {
    return {
      activeMeshes: meshMap.size,
      cachedGeometries: geometryCache.size,
      loaderStats: modelLoader.getCacheStats(),
    }
  }

  return {
    createInstancedMesh,
    getMesh,
    getAllMeshes,
    preloadModels,
    disposeMesh,
    dispose,
    getStats,
  }
}

// 创建单例实例（带引用计数）
let managerInstance: ReturnType<typeof useThreeModelManager> | null = null
let refCount = 0

/**
 * 获取模型管理器单例（增加引用计数）
 * 每次调用都会增加引用计数，使用完毕后必须调用 releaseThreeModelManager() 释放
 */
export function getThreeModelManager(): ReturnType<typeof useThreeModelManager> {
  if (!managerInstance) {
    managerInstance = useThreeModelManager()
    console.log('[ModelManager] 创建新实例')
  }
  refCount++
  console.log(`[ModelManager] 引用计数: ${refCount}`)
  return managerInstance
}

/**
 * 释放模型管理器单例的引用（减少引用计数）
 * 当引用计数归零时，自动清理资源
 */
export function releaseThreeModelManager(): void {
  if (refCount <= 0) {
    console.warn('[ModelManager] 引用计数已为0，无需释放')
    return
  }

  refCount--
  console.log(`[ModelManager] 引用计数: ${refCount}`)

  // 当引用计数归零时，清理实例
  if (refCount === 0 && managerInstance) {
    console.log('[ModelManager] 引用计数归零，清理资源')
    managerInstance.dispose()
    managerInstance = null
  }
}

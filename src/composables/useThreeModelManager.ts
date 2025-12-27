import {
  InstancedMesh,
  DynamicDrawUsage,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { getModelLoader } from './useModelLoader'
import { MAX_RENDER_INSTANCES } from '@/types/constants'

/**
 * Three.js 模型管理器 (Instanced Rendering for Models)
 *
 * 职责：
 * 1. 管理多个 InstancedMesh（每种模型一个）
 * 2. 负责模型的加载和 InstancedMesh 的创建
 * 3. 提供懒加载和批量预加载
 *
 * 特性：
 * - 按模型名分组渲染
 * - 动态创建和销毁 InstancedMesh
 * - 单例模式管理
 */
export function useThreeModelManager() {
  const modelLoader = getModelLoader()

  // 模型名 -> InstancedMesh 的映射
  const meshMap = new Map<string, InstancedMesh>()

  // 模型名 -> 几何体和材质的缓存（用于创建 InstancedMesh）
  const geometryCache = new Map<string, { geometry: BufferGeometry; material: Material }>()

  /**
   * 为指定模型创建 InstancedMesh
   * @param modelName 模型名称
   * @param instanceCount 实例数量
   * @returns Promise<InstancedMesh | null> 成功返回 InstancedMesh，失败返回 null
   */
  async function createInstancedMesh(
    modelName: string,
    instanceCount: number
  ): Promise<InstancedMesh | null> {
    // 检查是否已存在
    if (meshMap.has(modelName)) {
      const existingMesh = meshMap.get(modelName)!
      // 如果实例数量足够，直接返回
      if (existingMesh.count >= instanceCount) {
        return existingMesh
      }
      // 否则需要重建（实例数量不能动态扩展）
      disposeMesh(modelName)
    }

    // 尝试从缓存获取几何体和材质
    let geometryData = geometryCache.get(modelName)

    if (!geometryData) {
      // 加载模型
      const model = await modelLoader.loadModel(modelName)

      if (!model) {
        console.warn(`[ModelManager] Failed to load model: ${modelName}`)
        return null
      }

      // 提取第一个 Mesh 的几何体和材质
      let geometry: BufferGeometry | null = null
      let material: Material | null = null

      model.traverse((child) => {
        if (!geometry && (child as any).isMesh) {
          const mesh = child as any
          geometry = mesh.geometry
          material = mesh.material
        }
      })

      if (!geometry || !material) {
        console.warn(`[ModelManager] Model has no geometry or material: ${modelName}`)
        return null
      }

      // 自动居中对齐：将几何体移动到底部中心对齐 (0,0,0)
      // 这与 BoxGeometry.translate(0, 0, 0.5) 的逻辑一致（Box的原点也是底部中心）
      // 注意：GLTF 是 Y-Up，所以高度方向是 Y
      geometry.computeBoundingBox()
      const box = geometry.boundingBox
      if (box) {
        const center = new Vector3()
        box.getCenter(center)

        // Offset = -CenterX, -MinY, -CenterZ
        const offsetX = -center.x
        const offsetY = -box.min.y // 对齐到底部，而不是中心
        const offsetZ = -center.z

        geometry.translate(offsetX, offsetY, offsetZ)
      }

      // 缓存几何体和材质
      geometryData = { geometry, material }
      geometryCache.set(modelName, geometryData)
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
    meshMap.set(modelName, instancedMesh)

    console.log(
      `[ModelManager] Created InstancedMesh for ${modelName}, capacity: ${instancedMesh.count}`
    )

    return instancedMesh
  }

  /**
   * 获取指定模型的 InstancedMesh
   * @param modelName 模型名称
   * @returns InstancedMesh | null
   */
  function getMesh(modelName: string): InstancedMesh | null {
    return meshMap.get(modelName) || null
  }

  /**
   * 获取所有 InstancedMesh
   * @returns InstancedMesh[]
   */
  function getAllMeshes(): InstancedMesh[] {
    return Array.from(meshMap.values())
  }

  /**
   * 批量预加载模型并创建 InstancedMesh
   * @param modelNames 模型名称列表
   */
  async function preloadModels(modelNames: string[]): Promise<void> {
    const uniqueNames = Array.from(new Set(modelNames)) // 去重

    // 过滤出未加载的模型
    const unloadedNames = uniqueNames.filter((name) => !geometryCache.has(name))

    if (unloadedNames.length === 0) {
      return // 所有模型已加载
    }

    console.log(`[ModelManager] Preloading ${unloadedNames.length} models...`)

    // 并行加载
    await modelLoader.preloadModels(unloadedNames)

    // 提取几何体和材质并缓存
    for (const name of unloadedNames) {
      const model = modelLoader.getModel(name)
      if (model) {
        let geometry: BufferGeometry | null = null
        let material: Material | null = null

        model.traverse((child) => {
          if (!geometry && (child as any).isMesh) {
            const mesh = child as any
            geometry = mesh.geometry
            material = mesh.material
          }
        })

        if (geometry && material) {
          // 自动居中对齐（同上）
          geometry.computeBoundingBox()
          const box = geometry.boundingBox
          if (box) {
            const center = new Vector3()
            box.getCenter(center)
            geometry.translate(-center.x, -box.min.y, -center.z)
          }

          geometryCache.set(name, { geometry, material })
        }
      }
    }

    console.log(`[ModelManager] Preload complete`)
  }

  /**
   * 销毁指定模型的 InstancedMesh
   * @param modelName 模型名称
   */
  function disposeMesh(modelName: string): void {
    const mesh = meshMap.get(modelName)
    if (mesh) {
      // 注意：不销毁几何体和材质（它们在 geometryCache 中被复用）
      meshMap.delete(modelName)
      console.log(`[ModelManager] Disposed InstancedMesh for ${modelName}`)
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

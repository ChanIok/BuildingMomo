// @ts-ignore - GLTFLoader 类型声明可能不完整
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import type { Object3D } from 'three'

// GLTF 类型定义
interface GLTF {
  scene: Object3D
  scenes: Object3D[]
  cameras: any[]
  asset: any
  parser: any
  userData: any
}

/**
 * 模型加载管理器
 * 负责加载、缓存和管理家具 GLB 模型
 *
 * 职责：
 * - 加载 GLB 文件
 * - 缓存已加载的模型
 * - 提供去重和并发控制
 */
export function useModelLoader() {
  const loader = new GLTFLoader()

  // 模型基础路径
  const MODEL_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-model/'

  // 模型缓存 Map: ModelName -> Object3D
  const modelCache = new Map<string, Object3D | null>()

  // 正在加载的模型 Promise，避免重复请求
  const loadingPromises = new Map<string, Promise<Object3D | null>>()

  /**
   * 加载单个 GLB 模型
   * @param modelName 模型名称（不含扩展名）
   * @returns Promise<Object3D | null> 成功返回模型根节点，失败返回 null
   */
  function loadModel(modelName: string): Promise<Object3D | null> {
    // 1. 检查缓存
    if (modelCache.has(modelName)) {
      const cached = modelCache.get(modelName)
      return Promise.resolve(cached ? cached.clone() : null)
    }

    // 2. 检查是否正在加载
    if (loadingPromises.has(modelName)) {
      return loadingPromises.get(modelName)!
    }

    // 3. 开始加载
    const promise = new Promise<Object3D | null>((resolve) => {
      const modelUrl = `${MODEL_BASE_URL}${modelName}.glb`

      loader.load(
        modelUrl,
        // 成功回调
        (gltf: GLTF) => {
          const model = gltf.scene

          // 缓存原始模型
          modelCache.set(modelName, model)
          loadingPromises.delete(modelName)

          // 返回克隆（避免共享状态）
          resolve(model.clone())
        },
        // 进度回调
        undefined,
        // 错误回调
        (error: unknown) => {
          console.warn(`[ModelLoader] Failed to load model: ${modelName}`, error)

          // 缓存失败结果（避免重复尝试）
          modelCache.set(modelName, null)
          loadingPromises.delete(modelName)

          resolve(null)
        }
      )
    })

    loadingPromises.set(modelName, promise)
    return promise
  }

  /**
   * 批量预加载模型
   * @param modelNames 模型名称列表
   */
  async function preloadModels(modelNames: string[]): Promise<void> {
    const uniqueNames = Array.from(new Set(modelNames)) // 去重
    const promises = uniqueNames.map((name) => loadModel(name))
    await Promise.allSettled(promises)
  }

  /**
   * 同步获取模型（仅返回已缓存的）
   * @param modelName 模型名称
   * @returns Object3D | null
   */
  function getModel(modelName: string): Object3D | null {
    const cached = modelCache.get(modelName)
    return cached ? cached.clone() : null
  }

  /**
   * 检查模型是否已加载
   * @param modelName 模型名称
   */
  function isModelLoaded(modelName: string): boolean {
    return modelCache.has(modelName) && modelCache.get(modelName) !== null
  }

  /**
   * 清除缓存
   */
  function clearCache(): void {
    // 释放几何体和材质资源
    for (const [, model] of modelCache.entries()) {
      if (model) {
        model.traverse((child) => {
          if ((child as any).geometry) {
            ;(child as any).geometry.dispose()
          }
          if ((child as any).material) {
            const material = (child as any).material
            if (Array.isArray(material)) {
              material.forEach((m) => m.dispose())
            } else {
              material.dispose()
            }
          }
        })
      }
    }

    modelCache.clear()
    loadingPromises.clear()
  }

  /**
   * 获取缓存统计信息
   */
  function getCacheStats() {
    return {
      cachedCount: modelCache.size,
      loadingCount: loadingPromises.size,
      loadedCount: Array.from(modelCache.values()).filter((m) => m !== null).length,
    }
  }

  return {
    loadModel,
    preloadModels,
    getModel,
    isModelLoaded,
    clearCache,
    getCacheStats,
  }
}

// 创建单例实例
let modelLoaderInstance: ReturnType<typeof useModelLoader> | null = null

/**
 * 获取模型加载器单例
 */
export function getModelLoader(): ReturnType<typeof useModelLoader> {
  if (!modelLoaderInstance) {
    modelLoaderInstance = useModelLoader()
  }
  return modelLoaderInstance
}

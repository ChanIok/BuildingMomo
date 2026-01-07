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
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { useGameDataStore } from '@/stores/gameDataStore'
import { MAX_RENDER_INSTANCES } from '@/types/constants'

/**
 * 标准化几何体属性，确保所有几何体具有兼容的属性集
 * 改进策略：
 * - 对关键属性（position, normal, uv）求交集，缺失则删除
 * - 对顶点色属性（color, color_1 等）求并集，缺失则补充默认白色
 * - 对其他非关键属性求交集，缺失则删除
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

  // 3. 找出所有顶点色属性（需要补充而非删除）
  const colorAttributes = new Set<string>()
  for (const attrSet of attributeSets) {
    for (const attr of attrSet) {
      if (attr === 'color' || attr.startsWith('color_')) {
        colorAttributes.add(attr)
      }
    }
  }

  // 4. 处理每个几何体的属性
  for (let i = 0; i < geometries.length; i++) {
    const geom = geometries[i]!
    const attrs = Object.keys(geom.attributes)

    // 4.1 删除不是所有几何体都有的非颜色属性
    for (const attr of attrs) {
      if (!commonAttributes.has(attr) && !colorAttributes.has(attr)) {
        geom.deleteAttribute(attr)
      }
    }

    // 4.2 为缺失的顶点色属性补充默认白色
    for (const colorAttr of colorAttributes) {
      if (!geom.attributes[colorAttr]) {
        const vertexCount = geom.attributes.position?.count

        // 如果几何体没有 position 属性，跳过
        if (!vertexCount) continue

        // 找到已有该属性的几何体，复制其类型和尺寸
        let referenceAttr = null
        for (const refGeom of geometries) {
          if (refGeom.attributes[colorAttr]) {
            referenceAttr = refGeom.attributes[colorAttr]
            break
          }
        }

        if (referenceAttr) {
          // 匹配引用属性的类型、尺寸和 normalized 标志
          const itemSize = referenceAttr.itemSize
          const normalized = referenceAttr.normalized
          const ArrayType = referenceAttr.array.constructor as any
          const colorArray = new ArrayType(vertexCount * itemSize)

          // 填充白色（根据数据类型使用不同的值）
          const whiteValue = ArrayType === Float32Array ? 1.0 : 255
          for (let j = 0; j < colorArray.length; j++) {
            colorArray[j] = whiteValue
          }

          const BufferAttrType = referenceAttr.constructor as any
          const newAttr = new BufferAttrType(colorArray, itemSize, normalized)
          geom.setAttribute(colorAttr, newAttr)
        }
      }
    }
  }
}

/**
 * 处理家具几何体：加载、变换、合并、优化
 * @param itemId 家具 ID
 * @param config 家具模型配置
 * @param modelLoader 模型加载器实例
 * @param useCache 是否使用缓存（true=getModel, false=loadModel）
 * @returns {geometry, material} 或 undefined
 */
/**
 * 加载单个 GLB 模型文件
 * @param meshPath 模型路径（例如："chair_01.glb"）
 * @returns Promise<Object3D | null>
 */
async function loadGLBModel(
  gltfLoader: GLTFLoader,
  MODEL_BASE_URL: string,
  meshPath: string
): Promise<Object3D | null> {
  try {
    // 智能处理扩展名
    const fileName = meshPath.endsWith('.glb') ? meshPath : `${meshPath}.glb`
    const modelUrl = `${MODEL_BASE_URL}${fileName}`

    // 使用 loadAsync（Promise风格）
    const gltf = await gltfLoader.loadAsync(modelUrl)
    return gltf.scene
  } catch (error) {
    console.warn(`[ModelManager] Failed to load GLB: ${meshPath}`, error)
    return null
  }
}

/**
 * 处理家具几何体：加载、变换、合并、优化
 * @param itemId 家具 ID
 * @param config 家具模型配置
 * @param gltfLoader GLTF加载器实例
 * @param MODEL_BASE_URL 模型基础路径
 * @returns {geometry, material} 或 undefined
 */
async function processGeometryForItem(
  itemId: number,
  config: any,
  gltfLoader: GLTFLoader,
  MODEL_BASE_URL: string
): Promise<{ geometry: BufferGeometry; material: Material | Material[] } | undefined> {
  // 加载所有 mesh 文件
  const allGeometries: BufferGeometry[] = []
  const materials: Material[] = []
  const tempMatrix = new Matrix4()
  const tempQuat = new Quaternion()
  const tempScale = new Vector3()
  const tempTrans = new Vector3()

  for (const meshConfig of config.meshes) {
    // 直接加载GLB模型
    const model = await loadGLBModel(gltfLoader, MODEL_BASE_URL, meshConfig.path)

    if (!model) {
      console.warn(`[ModelManager] Failed to load mesh: ${meshConfig.path}`)
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

  // ✨ 关键修复：重新计算法线向量
  // scale(-1,1,1) 会翻转法线方向，导致光照计算错误（模型显示为黑色）
  // 必须在镜像后重新计算法线，确保它们指向外部
  geometry.computeVertexNormals()

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
  const gameDataStore = useGameDataStore()

  // 创建 GLTF Loader
  const gltfLoader = new GLTFLoader()
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(import.meta.env.BASE_URL + 'draco/')
  gltfLoader.setDRACOLoader(dracoLoader)

  // 模型基础路径
  const MODEL_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-model/'

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

      // 检查当前容量（instanceMatrix.count 是实际分配的 Buffer 大小）
      const currentCapacity = existingMesh.instanceMatrix.count

      // 如果容量足够，直接返回复用
      if (currentCapacity >= instanceCount) {
        return existingMesh
      }

      // 容量不足，需要扩容（销毁旧的，下面会创建新的）
      console.log(
        `[ModelManager] 容量不足 itemId=${itemId}: 需 ${instanceCount}, 当前 ${currentCapacity} -> 重建`
      )
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
      const result = await processGeometryForItem(itemId, config, gltfLoader, MODEL_BASE_URL)
      if (!result) {
        return null
      }
      geometryData = result

      // 缓存几何体和材质
      geometryCache.set(itemId, geometryData)
    }

    // 计算分配容量（Headroom 策略：预留空间以减少频繁重建）
    // 策略：实际需求 + 缓冲，且至少分配 32 个，或者按 1.5 倍增长
    // 同时不超过最大限制
    const minCapacity = 32
    const growthFactor = 1.5
    const headRoom = 16

    let allocatedCapacity = Math.max(
      instanceCount + headRoom,
      Math.floor(instanceCount * growthFactor),
      minCapacity
    )
    allocatedCapacity = Math.min(allocatedCapacity, MAX_RENDER_INSTANCES)

    // 如果请求量本身就很大，直接给够
    if (instanceCount > allocatedCapacity) {
      allocatedCapacity = instanceCount
    }

    // 创建 InstancedMesh
    const instancedMesh = new InstancedMesh(
      geometryData.geometry,
      geometryData.material,
      allocatedCapacity
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
   * 获取未加载的模型列表
   * @param itemIds 家具 ItemID 列表
   * @returns 未加载的家具 ItemID 列表
   */
  function getUnloadedModels(itemIds: number[]): number[] {
    const uniqueIds = Array.from(new Set(itemIds)) // 去重
    return uniqueIds.filter((id) => !geometryCache.has(id))
  }

  /**
   * 批量预加载家具模型（完全并发）
   * @param itemIds 家具 ItemID 列表
   * @param onProgress 进度回调：(current, total, failed) => void
   */
  async function preloadModels(
    itemIds: number[],
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<void> {
    const uniqueIds = Array.from(new Set(itemIds)) // 去重

    // 过滤出未加载的家具
    const unloadedIds = uniqueIds.filter((id) => !geometryCache.has(id))

    if (unloadedIds.length === 0) {
      // 所有模型已加载，立即报告完成（避免进度条卡死）
      onProgress?.(0, 0, 0) // 传递 (0, 0, 0) 表示无需加载
      return
    }

    console.log(`[ModelManager] Preloading ${unloadedIds.length} furniture models...`)

    let completed = 0
    let failed = 0

    // 🔥 完全并发：所有任务立即开始
    const promises = unloadedIds.map(async (itemId) => {
      try {
        const config = gameDataStore.getFurnitureModelConfig(itemId)
        if (!config || !config.meshes || config.meshes.length === 0) {
          console.warn(`[ModelManager] No config for itemId: ${itemId}`)
          failed++
          completed++
          onProgress?.(completed, unloadedIds.length, failed)
          return
        }

        // 下载并处理模型
        const geometryData = await processGeometryForItem(
          itemId,
          config,
          gltfLoader,
          MODEL_BASE_URL
        )

        if (!geometryData) {
          failed++
        } else {
          geometryCache.set(itemId, geometryData)
        }

        // ✅ 原子更新：JavaScript 单线程，completed++ 天然原子
        completed++
        onProgress?.(completed, unloadedIds.length, failed)
      } catch (error) {
        console.error(`[ModelManager] Error processing itemId ${itemId}:`, error)
        failed++
        completed++
        onProgress?.(completed, unloadedIds.length, failed)
      }
    })

    await Promise.all(promises)
    console.log(`[ModelManager] Complete: ${completed - failed}/${unloadedIds.length} models`)
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

    console.log('[ModelManager] Resources disposed')
  }

  /**
   * 获取统计信息
   */
  function getStats() {
    return {
      activeMeshes: meshMap.size,
      cachedGeometries: geometryCache.size,
    }
  }

  return {
    createInstancedMesh,
    getMesh,
    getAllMeshes,
    getUnloadedModels,
    preloadModels,
    disposeMesh,
    dispose,
    getStats,
  }
}

// 创建单例实例
let managerInstance: ReturnType<typeof useThreeModelManager> | null = null

/**
 * 获取模型管理器单例
 * 如果实例不存在则创建，否则返回现有实例
 */
export function getThreeModelManager(): ReturnType<typeof useThreeModelManager> {
  if (!managerInstance) {
    managerInstance = useThreeModelManager()
    console.log('[ModelManager] 创建新实例')
  }
  return managerInstance
}

/**
 * 清理模型管理器单例
 * 释放所有资源并重置实例
 */
export function disposeThreeModelManager(): void {
  if (managerInstance) {
    console.log('[ModelManager] 清理资源')
    managerInstance.dispose()
    managerInstance = null
  }
}

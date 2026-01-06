import { ref, markRaw, computed } from 'vue'
import { InstancedMesh, BoxGeometry, Sphere, Vector3, DynamicDrawUsage } from 'three'
import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { coordinates3D } from '@/lib/coordinates'
import { getThreeModelManager, releaseThreeModelManager } from '@/composables/useThreeModelManager'
import { createBoxMaterial } from '../shared/materials'
import {
  scratchMatrix,
  scratchPosition,
  scratchEuler,
  scratchQuaternion,
  scratchScale,
  scratchColor,
} from '../shared/scratchObjects'
import { MAX_RENDER_INSTANCES as MAX_INSTANCES } from '@/types/constants'

// 当缺少尺寸信息时使用的默认尺寸（游戏坐标：X=长, Y=宽, Z=高）
const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

/**
 * Model 渲染模式
 *
 * 3D 模型实例化渲染（按 itemId 分组管理多个 InstancedMesh）
 * 对无模型或加载失败的物品自动回退到 Box 渲染
 */
export function useModelMode() {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()
  const modelManager = getThreeModelManager()

  // 模型 InstancedMesh 映射：itemId -> InstancedMesh
  const modelMeshMap = ref(new Map<number, InstancedMesh>())

  // 模型索引映射：用于拾取和选择（跨所有模型 mesh 的全局索引）
  const modelIndexToIdMap = ref(new Map<number, string>())
  const modelIdToIndexMap = ref(new Map<string, number>())

  // 局部索引映射：用于射线检测（Mesh -> 局部索引 -> internalId）
  const meshToLocalIndexMap = ref(new Map<InstancedMesh, Map<number, string>>())

  // 反向索引映射：用于描边高亮（internalId -> { itemId, localIndex }）
  const internalIdToMeshInfo = ref(new Map<string, { itemId: number; localIndex: number }>())

  // 回退渲染用的 Box mesh（专门用于 Model 模式的回退）
  let fallbackGeometry: BoxGeometry | null = null
  let fallbackMesh: InstancedMesh | null = null

  /**
   * 确保回退渲染资源已初始化
   */
  function ensureFallbackResources() {
    if (fallbackMesh) return

    fallbackGeometry = new BoxGeometry(1, 1, 1)
    fallbackGeometry.translate(0, 0, 0.5)
    const fallbackMaterial = createBoxMaterial(0.9)
    fallbackMesh = new InstancedMesh(fallbackGeometry, fallbackMaterial, MAX_INSTANCES)
    fallbackMesh.frustumCulled = false
    fallbackMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    fallbackMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    fallbackMesh.count = 0
  }

  /**
   * 渲染回退物品（使用 Box）
   */
  function renderFallbackItems(
    items: AppItem[],
    startIndex: number,
    indexToIdMap: Map<number, string>,
    idToIndexMap: Map<string, number>,
    localIndexMap: Map<number, string>
  ) {
    ensureFallbackResources()
    if (!fallbackMesh) return

    // fallbackMesh 使用局部索引（0, 1, 2...），而不是全局索引
    // 确保有足够容量
    if (fallbackMesh.count < items.length) {
      fallbackMesh.count = Math.min(items.length, MAX_INSTANCES)
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue

      // fallbackMesh 使用局部索引 i，全局索引用于全局映射
      const globalIndex = startIndex + i

      // 位置
      coordinates3D.setThreeFromGame(scratchPosition, { x: item.x, y: item.y, z: item.z })

      // 旋转
      const Rotation = item.rotation
      scratchEuler.set(
        (-Rotation.x * Math.PI) / 180,
        (-Rotation.y * Math.PI) / 180,
        (Rotation.z * Math.PI) / 180,
        'ZYX'
      )
      scratchQuaternion.setFromEuler(scratchEuler)

      // 缩放（使用家具尺寸）
      const Scale = item.extra.Scale
      const furnitureSize = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      const [sizeX, sizeY, sizeZ] = furnitureSize
      // 注意：游戏坐标系中 X/Y 与 Three.js 交换
      scratchScale.set((Scale.Y || 1) * sizeX, (Scale.X || 1) * sizeY, (Scale.Z || 1) * sizeZ)

      // 组合矩阵（使用局部索引 i）
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      fallbackMesh.setMatrixAt(i, scratchMatrix)

      // 颜色设置为白色（不影响贴图原色，因为白色 × 任何颜色 = 原颜色）
      scratchColor.setHex(0xffffff)
      fallbackMesh.setColorAt(i, scratchColor)

      // 全局索引映射（用于颜色/矩阵更新）
      indexToIdMap.set(globalIndex, item.internalId)
      idToIndexMap.set(item.internalId, globalIndex)

      // 局部索引映射（用于射线检测）
      localIndexMap.set(i, item.internalId)
    }

    fallbackMesh.instanceMatrix.needsUpdate = true
    if (fallbackMesh.instanceColor) fallbackMesh.instanceColor.needsUpdate = true
  }

  /**
   * 重建所有模型实例
   */
  async function rebuild() {
    const items = editorStore.activeScheme?.items.value ?? []
    const instanceCount = Math.min(items.length, MAX_INSTANCES)

    if (items.length > MAX_INSTANCES) {
      console.warn(
        `[ModelMode] 当前可见物品数量 (${items.length}) 超过上限 ${MAX_INSTANCES}，仅渲染前 ${MAX_INSTANCES} 个`
      )
    }

    // 1. 按 itemId 分组（包含回退项）
    const groups = new Map<number, AppItem[]>()
    const fallbackKey = -1 // 特殊键，用于存放没有模型或加载失败的物品

    for (let i = 0; i < instanceCount; i++) {
      const item = items[i]
      if (!item) continue

      const config = gameDataStore.getFurnitureModelConfig(item.gameId)
      const key = config ? item.gameId : fallbackKey

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(item)
    }

    console.log(
      `[ModelMode] Model groups: ${groups.size - (groups.has(fallbackKey) ? 1 : 0)} furniture + ${groups.get(fallbackKey)?.length || 0} fallback`
    )

    // 2. 清理旧的 InstancedMesh（在新一轮渲染后不再需要的）
    const activeItemIds = new Set(Array.from(groups.keys()).filter((k) => k !== fallbackKey))
    for (const [itemId] of modelMeshMap.value.entries()) {
      if (!activeItemIds.has(itemId)) {
        // 模型不再需要，清理
        modelManager.disposeMesh(itemId)
        modelMeshMap.value.delete(itemId)
      }
    }

    // 重置 fallbackMesh（每次重建时都重新开始）
    ensureFallbackResources()
    if (fallbackMesh) {
      fallbackMesh.count = 0
    }

    // 3. 为每个家具创建或更新 InstancedMesh
    let globalIndex = 0
    const newIndexToIdMap = new Map<number, string>()
    const newIdToIndexMap = new Map<string, number>()
    const newMeshToLocalIndexMap = new Map<InstancedMesh, Map<number, string>>()
    const newInternalIdToMeshInfo = new Map<string, { itemId: number; localIndex: number }>()

    // 辅助函数：处理回退物品
    function handleFallbackItems(items: AppItem[]) {
      if (!fallbackMesh) return
      const localIndexMap = new Map<number, string>()
      renderFallbackItems(items, globalIndex, newIndexToIdMap, newIdToIndexMap, localIndexMap)
      newMeshToLocalIndexMap.set(fallbackMesh, localIndexMap)

      // 更新反向索引（fallback 使用 itemId = -1）
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        newInternalIdToMeshInfo.set(item.internalId, { itemId: -1, localIndex: i })
      }

      globalIndex += items.length
    }

    for (const [itemId, itemsOfModel] of groups.entries()) {
      if (itemId === fallbackKey) {
        // 回退物品：使用 Box 渲染
        handleFallbackItems(itemsOfModel)
        continue
      }

      // 创建或获取 InstancedMesh
      // 即使本地已存在，也必须调用 createInstancedMesh 以确保容量足够（Manager 内部会检查并决定是否复用）
      const existingMesh = modelMeshMap.value.get(itemId)
      const mesh = await modelManager.createInstancedMesh(itemId, itemsOfModel.length)

      if (!mesh) {
        // 加载失败，回退到 Box
        console.warn(`[ModelMode] Failed to create mesh for itemId ${itemId}, using fallback`)
        handleFallbackItems(itemsOfModel)
        continue
      }

      // 更新引用（createInstancedMesh 可能会返回新的实例）
      if (existingMesh !== mesh) {
        modelMeshMap.value.set(itemId, markRaw(mesh))
      }

      // 更新实例数量
      mesh.count = itemsOfModel.length

      // 为当前 mesh 创建局部索引映射
      const localIndexMap = new Map<number, string>()

      // 设置每个实例的矩阵和颜色
      for (let i = 0; i < itemsOfModel.length; i++) {
        const item = itemsOfModel[i]
        if (!item) continue

        // 位置
        coordinates3D.setThreeFromGame(scratchPosition, { x: item.x, y: item.y, z: item.z })

        // 旋转（与 Box 模式完全相同，模型已在导入时完成坐标系转换）
        const Rotation = item.rotation
        scratchEuler.set(
          (-Rotation.x * Math.PI) / 180,
          (-Rotation.y * Math.PI) / 180,
          (Rotation.z * Math.PI) / 180,
          'ZYX'
        )
        scratchQuaternion.setFromEuler(scratchEuler)

        // 缩放：仅使用用户的 Scale 参数，不再使用 furnitureSize
        // 模型已包含实际尺寸，直接应用用户缩放即可
        const Scale = item.extra.Scale
        // 注意：游戏坐标系中 X/Y 与 Three.js 交换（游戏X→Three.js Y，游戏Y→Three.js X）
        scratchScale.set(Scale.Y || 1, Scale.X || 1, Scale.Z || 1)

        // 组合矩阵
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        mesh.setMatrixAt(i, scratchMatrix)

        // 颜色设置为白色（不影响贴图原色，Model 模式使用描边系统表示状态）
        scratchColor.setHex(0xffffff)
        mesh.setColorAt(i, scratchColor)

        // 全局索引映射（用于颜色/矩阵更新）
        newIndexToIdMap.set(globalIndex + i, item.internalId)
        newIdToIndexMap.set(item.internalId, globalIndex + i)

        // 局部索引映射（用于射线检测）
        localIndexMap.set(i, item.internalId)

        // 反向索引映射（用于描边高亮）
        newInternalIdToMeshInfo.set(item.internalId, { itemId, localIndex: i })
      }

      // 将当前 mesh 的局部索引映射存储起来
      newMeshToLocalIndexMap.set(mesh, localIndexMap)

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

      // 构建 BVH 加速结构（仅对新创建的 mesh）
      if (!existingMesh && mesh.geometry) {
        mesh.geometry.computeBoundsTree({
          setBoundingBox: true,
        })
        console.log(`[ModelMode] BVH built for itemId ${itemId}, instances: ${itemsOfModel.length}`)
      }

      globalIndex += itemsOfModel.length
    }

    // 为 fallbackMesh 构建 BVH（如果有新的回退物品）
    if (fallbackMesh && fallbackMesh.count > 0 && fallbackMesh.geometry) {
      if (!fallbackMesh.geometry.boundsTree) {
        fallbackMesh.geometry.computeBoundsTree({
          setBoundingBox: true,
        })
        console.log(`[ModelMode] BVH built for fallbackMesh, instances: ${fallbackMesh.count}`)
      }
    }

    // 更新索引映射
    modelIndexToIdMap.value = newIndexToIdMap
    modelIdToIndexMap.value = newIdToIndexMap
    meshToLocalIndexMap.value = newMeshToLocalIndexMap
    internalIdToMeshInfo.value = newInternalIdToMeshInfo

    console.log(`[ModelMode] Model mode rebuild complete: ${globalIndex} instances`)
  }

  /**
   * 清理资源
   */
  function dispose() {
    // 清理模型 Mesh
    for (const [, mesh] of modelMeshMap.value.entries()) {
      if (mesh.geometry?.boundsTree) {
        mesh.geometry.disposeBoundsTree()
      }
      mesh.geometry = null as any
      mesh.material = null as any
    }
    modelMeshMap.value.clear()

    // 清理回退 Mesh
    if (fallbackMesh) {
      if (fallbackMesh.geometry?.boundsTree) {
        fallbackMesh.geometry.disposeBoundsTree()
      }
      fallbackMesh.geometry = null as any
      fallbackMesh.material = null as any
      fallbackMesh = null
    }
    if (fallbackGeometry) {
      if (fallbackGeometry.boundsTree) {
        fallbackGeometry.disposeBoundsTree()
      }
      fallbackGeometry.dispose()
      fallbackGeometry = null
    }

    releaseThreeModelManager()
  }

  return {
    meshMap: modelMeshMap,
    // 全局索引映射（用于颜色/矩阵更新）
    indexToIdMap: modelIndexToIdMap,
    idToIndexMap: modelIdToIndexMap,
    // 局部索引映射（用于射线检测）
    meshToLocalIndexMap: meshToLocalIndexMap,
    // 反向索引映射（用于描边高亮）
    internalIdToMeshInfo: internalIdToMeshInfo,
    // 回退 mesh 引用（用于射线检测）
    fallbackMesh: computed(() => fallbackMesh),
    rebuild,
    dispose,
  }
}

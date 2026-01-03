import { ref, markRaw } from 'vue'
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
    idToIndexMap: Map<string, number>
  ) {
    ensureFallbackResources()
    if (!fallbackMesh) return

    // 确保 Box mesh 有足够容量
    const requiredCount = startIndex + items.length
    if (fallbackMesh.count < requiredCount) {
      fallbackMesh.count = Math.min(requiredCount, MAX_INSTANCES)
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue

      const instanceIndex = startIndex + i

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

      // 组合矩阵
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      fallbackMesh.setMatrixAt(instanceIndex, scratchMatrix)

      // 颜色占位
      scratchColor.setHex(0x94a3b8)
      fallbackMesh.setColorAt(instanceIndex, scratchColor)

      // 索引映射
      indexToIdMap.set(instanceIndex, item.internalId)
      idToIndexMap.set(item.internalId, instanceIndex)
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

    // 3. 为每个家具创建或更新 InstancedMesh
    let globalIndex = 0
    const newIndexToIdMap = new Map<number, string>()
    const newIdToIndexMap = new Map<string, number>()

    for (const [itemId, itemsOfModel] of groups.entries()) {
      if (itemId === fallbackKey) {
        // 回退物品：使用 Box 渲染
        renderFallbackItems(itemsOfModel, globalIndex, newIndexToIdMap, newIdToIndexMap)
        globalIndex += itemsOfModel.length
        continue
      }

      // 创建或获取 InstancedMesh
      const existingMesh = modelMeshMap.value.get(itemId)
      let mesh: InstancedMesh | null = existingMesh || null
      if (!mesh) {
        const newMesh = await modelManager.createInstancedMesh(itemId, itemsOfModel.length)

        if (!newMesh) {
          // 加载失败，回退到 Box
          console.warn(`[ModelMode] Failed to create mesh for itemId ${itemId}, using fallback`)
          renderFallbackItems(itemsOfModel, globalIndex, newIndexToIdMap, newIdToIndexMap)
          globalIndex += itemsOfModel.length
          continue
        }

        mesh = markRaw(newMesh)
        modelMeshMap.value.set(itemId, mesh)
      }

      // 更新实例数量
      mesh.count = itemsOfModel.length

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

        // 颜色占位
        scratchColor.setHex(0x94a3b8)
        mesh.setColorAt(i, scratchColor)

        // 索引映射
        newIndexToIdMap.set(globalIndex + i, item.internalId)
        newIdToIndexMap.set(item.internalId, globalIndex + i)
      }

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

      globalIndex += itemsOfModel.length
    }

    // 更新索引映射
    modelIndexToIdMap.value = newIndexToIdMap
    modelIdToIndexMap.value = newIdToIndexMap

    console.log(`[ModelMode] Model mode rebuild complete: ${globalIndex} instances`)
  }

  /**
   * 清理资源
   */
  function dispose() {
    // 清理模型 Mesh
    for (const [, mesh] of modelMeshMap.value.entries()) {
      mesh.geometry = null as any
      mesh.material = null as any
    }
    modelMeshMap.value.clear()

    // 清理回退 Mesh
    if (fallbackMesh) {
      fallbackMesh.geometry = null as any
      fallbackMesh.material = null as any
      fallbackMesh = null
    }
    if (fallbackGeometry) {
      fallbackGeometry.dispose()
      fallbackGeometry = null
    }

    releaseThreeModelManager()
  }

  return {
    meshMap: modelMeshMap,
    indexToIdMap: modelIndexToIdMap,
    idToIndexMap: modelIdToIndexMap,
    rebuild,
    dispose,
  }
}

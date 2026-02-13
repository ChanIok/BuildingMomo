import { ref, markRaw, shallowRef } from 'vue'
import { InstancedMesh, BoxGeometry, Sphere, Vector3, DynamicDrawUsage } from 'three'
import type { AppItem } from '@/types/editor'
import type { DyePreset } from '@/types/furniture'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { getThreeModelManager, disposeThreeModelManager } from '@/composables/useThreeModelManager'
import { parseColorIndex, parseColorMapSlots } from '@/lib/colorMap'
import {
  loadArrayTexture,
  loadDiffuseTexture,
  isArrayTextureCached,
  isDiffuseTextureCached,
} from '@/lib/colorMap'
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

/** 分组元数据：旧系统（单槽染色） */
interface LegacyGroupMeta {
  type: 'legacy'
  gameId: number
  colorIndex: number
}

/** 分组元数据：新系统（多槽染色预设） */
interface PresetGroupMeta {
  type: 'preset'
  gameId: number
  preset: DyePreset
  slotValues: number[]
}

type GroupMeta = LegacyGroupMeta | PresetGroupMeta

/** 贴图加载描述 */
interface TextureToLoad {
  type: 'array' | 'diffuse'
  fileName: string
}

/**
 * 从预设分组元数据中收集所有需要的贴图文件名
 * 仅处理 preset 类型（新系统），legacy 类型的 array 贴图极小（平均 ~134B），无需预加载
 */
function collectPresetTextures(groupMeta: Map<string, GroupMeta>): TextureToLoad[] {
  const textures: TextureToLoad[] = []
  const seen = new Set<string>()

  for (const meta of groupMeta.values()) {
    if (meta.type !== 'preset') continue

    for (let slotIndex = 0; slotIndex < meta.preset.slots.length; slotIndex++) {
      const slot = meta.preset.slots[slotIndex]!
      const variantIndex = meta.slotValues[slotIndex] ?? 0
      const safeVariantIndex = variantIndex < slot.variants.length ? variantIndex : 0
      const variant = slot.variants[safeVariantIndex]
      if (!variant) continue

      if (!seen.has(variant.color)) {
        seen.add(variant.color)
        textures.push({ type: 'array', fileName: variant.color })
      }
      if (variant.diffuse && !seen.has(variant.diffuse)) {
        seen.add(variant.diffuse)
        textures.push({ type: 'diffuse', fileName: variant.diffuse })
      }
    }
  }

  return textures
}

/**
 * 批量并发预加载贴图
 */
async function preloadTexturesBatch(
  textures: TextureToLoad[],
  onProgress?: (completed: number) => void
): Promise<void> {
  let completed = 0
  await Promise.all(
    textures.map(async ({ type, fileName }) => {
      try {
        if (type === 'array') {
          await loadArrayTexture(fileName)
        } else {
          await loadDiffuseTexture(fileName)
        }
      } catch (e) {
        console.warn(`[ModelMode] 贴图预加载失败: ${fileName}`, e)
      }
      completed++
      onProgress?.(completed)
    })
  )
}

/**
 * Model 渲染模式
 *
 * 3D 模型实例化渲染（按 (gameId, dyeKey) 分组管理多个 InstancedMesh）
 * 支持旧系统（单槽染色）和新系统（多槽染色预设）
 * 对无模型或加载失败的物品自动回退到 Box 渲染
 */
export function useModelMode() {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()
  const settingsStore = useSettingsStore()
  const loadingStore = useLoadingStore()
  const modelManager = getThreeModelManager()

  // 追踪上一次的 scheme 引用，用于检测方案切换
  let lastSchemeRef: any = null

  // 模型 InstancedMesh 映射：meshKey -> InstancedMesh
  // meshKey 格式：旧系统 `${gameId}_${colorIndex}`，新系统 `${gameId}_${slotValues.join('_')}`
  const modelMeshMap = ref(new Map<string, InstancedMesh>())

  // 模型索引映射：用于拾取和选择（跨所有模型 mesh 的全局索引）
  const modelIndexToIdMap = ref(new Map<number, string>())
  const modelIdToIndexMap = ref(new Map<string, number>())

  // 局部索引映射：用于射线检测（Mesh -> 局部索引 -> internalId）
  const meshToLocalIndexMap = ref(new Map<InstancedMesh, Map<number, string>>())

  // 反向索引映射：用于描边高亮（internalId -> { meshKey, localIndex }）
  const internalIdToMeshInfo = ref(new Map<string, { meshKey: string; localIndex: number }>())

  // 回退渲染用的 Box mesh（专门用于 Model 模式的回退）
  // 🔧 修复：markRaw + shallowRef 组合，保持响应式同时避免深度代理
  const fallbackGeometry = shallowRef<BoxGeometry | null>(null)
  const fallbackMesh = shallowRef<InstancedMesh | null>(null)

  /**
   * 确保回退渲染资源已初始化
   */
  function ensureFallbackResources() {
    if (fallbackMesh.value) return

    fallbackGeometry.value = new BoxGeometry(1, 1, 1)
    fallbackGeometry.value.translate(0, 0, 0.5)
    const fallbackMaterial = createBoxMaterial(0.9)
    fallbackMesh.value = markRaw(
      new InstancedMesh(fallbackGeometry.value, fallbackMaterial, MAX_INSTANCES)
    )
    fallbackMesh.value.frustumCulled = false
    fallbackMesh.value.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    fallbackMesh.value.instanceMatrix.setUsage(DynamicDrawUsage)
    fallbackMesh.value.count = 0
  }

  /**
   * 渲染回退物品（使用 Box）
   */
  function renderFallbackItems(
    items: AppItem[],
    globalStartIndex: number,
    indexToIdMap: Map<number, string>,
    idToIndexMap: Map<string, number>,
    localIndexMap: Map<number, string>
  ) {
    ensureFallbackResources()
    if (!fallbackMesh.value) {
      console.error('[ModelMode] ❌ fallbackMesh 初始化失败！')
      return
    }

    // fallbackMesh 使用局部索引（0, 1, 2...），而不是全局索引
    // 设置当前需要渲染的实例数量
    const count = Math.min(items.length, MAX_INSTANCES)
    fallbackMesh.value.count = count

    for (let i = 0; i < count; i++) {
      const item = items[i]
      if (!item) continue

      // fallbackMesh 使用局部索引 i，全局索引用于全局映射
      const globalIndex = globalStartIndex + i

      // 位置
      scratchPosition.set(item.x, item.y, item.z)

      // 缩放参数和尺寸
      const Scale = item.extra.Scale
      const furnitureSize = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      const [sizeX, sizeY, sizeZ] = furnitureSize

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
      // 注意：游戏坐标系中 X/Y 与 Three.js 交换
      scratchScale.set((Scale.Y || 1) * sizeX, (Scale.X || 1) * sizeY, (Scale.Z || 1) * sizeZ)

      // 组合矩阵（使用局部索引 i）
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      fallbackMesh.value.setMatrixAt(i, scratchMatrix)

      // 颜色设置为白色（不影响贴图原色，因为白色 × 任何颜色 = 原颜色）
      scratchColor.setHex(0xffffff)
      fallbackMesh.value.setColorAt(i, scratchColor)

      // 全局索引映射（用于颜色/矩阵更新）
      indexToIdMap.set(globalIndex, item.internalId)
      idToIndexMap.set(item.internalId, globalIndex)

      // 局部索引映射（用于射线检测）
      localIndexMap.set(i, item.internalId)
    }

    fallbackMesh.value.instanceMatrix.needsUpdate = true
    if (fallbackMesh.value.instanceColor) fallbackMesh.value.instanceColor.needsUpdate = true
  }

  /**
   * 重建所有模型实例
   */
  async function rebuild() {
    // ✅ 检查点 1：捕获当前 scheme 引用，用于后续验证
    const currentScheme = editorStore.activeScheme
    const items = currentScheme?.items.value ?? []
    const instanceCount = Math.min(items.length, MAX_INSTANCES)

    if (items.length > MAX_INSTANCES) {
      console.warn(
        `[ModelMode] 当前可见物品数量 (${items.length}) 超过上限 ${MAX_INSTANCES}，仅渲染前 ${MAX_INSTANCES} 个`
      )
    }

    // 检测是否是方案切换（引用变化）
    const isSchemeSwitch = currentScheme !== lastSchemeRef
    lastSchemeRef = currentScheme

    // 0. 🔥 仅在方案切换时立即清理旧场景（避免内容更新时闪烁，但避免方案切换时残留）
    if (isSchemeSwitch) {
      // 将所有现有的 mesh 计数设为 0，使其立即从场景中消失
      for (const mesh of modelMeshMap.value.values()) {
        mesh.count = 0
      }
      if (fallbackMesh.value) {
        fallbackMesh.value.count = 0
      }
    }

    // 1. 按 (gameId, dyeKey) 分组（包含回退项）
    // dyeKey: 旧系统 `${gameId}_${colorIndex}`，新系统 `${gameId}_${slotValues.join('_')}`
    // 当 enableModelDye 关闭时，统一按 `${gameId}_0` 分组，跳过染色逻辑
    const enableDye = settingsStore.settings.enableModelDye
    const groups = new Map<string, AppItem[]>()
    const groupMeta = new Map<string, GroupMeta>()
    const fallbackKey = '-1' // 特殊键，用于存放没有模型或加载失败的物品

    for (let i = 0; i < instanceCount; i++) {
      const item = items[i]
      if (!item) continue

      const config = gameDataStore.getFurnitureModelConfig(item.gameId)
      const hasValidConfig = config && config.meshes && config.meshes.length > 0

      let key: string
      if (hasValidConfig) {
        if (enableDye) {
          // 启用染色：按染色参数分组
          // 检查是否有染色预设（新系统）
          const dyeResult = gameDataStore.getDyePreset(item.gameId)

          if (dyeResult) {
            // 新系统：多槽染色
            const { preset, slotIds } = dyeResult
            const slotValues = parseColorMapSlots(item.extra.ColorMap, slotIds)
            key = `${item.gameId}_${slotValues.join('_')}`
            if (!groupMeta.has(key)) {
              groupMeta.set(key, {
                type: 'preset',
                gameId: item.gameId,
                preset,
                slotValues,
              })
            }
          } else {
            // 旧系统：单槽染色
            const ci = parseColorIndex(item.extra.ColorMap) ?? 0
            key = `${item.gameId}_${ci}`
            if (!groupMeta.has(key)) {
              groupMeta.set(key, {
                type: 'legacy',
                gameId: item.gameId,
                colorIndex: ci,
              })
            }
          }
        } else {
          // 禁用染色：统一按 gameId 分组，跳过颜色解析
          key = `${item.gameId}_0`
          if (!groupMeta.has(key)) {
            groupMeta.set(key, {
              type: 'legacy',
              gameId: item.gameId,
              colorIndex: 0,
            })
          }
        }
      } else {
        key = fallbackKey
      }

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(item)
    }

    // 2. 预加载所有模型和染色贴图 + 追踪 mesh 创建进度（统一进度条）
    const modelItemIds = Array.from(new Set(Array.from(groupMeta.values()).map((m) => m.gameId)))
    const unloadedIds = modelItemIds.length > 0 ? modelManager.getUnloadedModels(modelItemIds) : []

    // 收集预设系统需要的贴图（仅在启用染色时）
    const presetTextures = enableDye ? collectPresetTextures(groupMeta) : []
    const uncachedTextures = presetTextures.filter((t) =>
      t.type === 'array' ? !isArrayTextureCached(t.fileName) : !isDiffuseTextureCached(t.fileName)
    )

    const groupsToProcess = Array.from(groups.keys()).filter((k) => k !== fallbackKey).length
    const resourceTasks = unloadedIds.length + uncachedTextures.length
    // 仅当存在真实资源加载时，才把 mesh 处理纳入全局进度（避免纯重建也弹进度条）
    const trackMeshProcessing = resourceTasks > 0
    const totalTasks = resourceTasks + (trackMeshProcessing ? groupsToProcess : 0)

    // 进度追踪变量（跨阶段共享）
    let glbCompleted = 0
    let textureCompleted = 0
    let meshCompleted = 0
    let glbFailed = 0

    const updateCombinedProgress = () => {
      if (totalTasks > 0) {
        loadingStore.updateProgress(
          glbCompleted + textureCompleted + (trackMeshProcessing ? meshCompleted : 0),
          glbFailed
        )
      }
    }

    if (totalTasks > 0) {
      loadingStore.startLoading('model', totalTasks, 'simple', {
        showDelayMs: 200,
        completeHoldMs: 500,
      })
    }

    const markMeshProcessed = () => {
      if (!trackMeshProcessing) return
      meshCompleted++
      updateCombinedProgress()
    }

    // 阶段 2a：并发预加载 GLB + 贴图
    if (unloadedIds.length > 0 || uncachedTextures.length > 0) {
      const loadPromises: Promise<void>[] = []

      if (unloadedIds.length > 0) {
        loadPromises.push(
          modelManager
            .preloadModels(unloadedIds, (current, _total, failed) => {
              glbCompleted = current
              glbFailed = failed
              updateCombinedProgress()
            })
            .catch((err) => {
              console.warn('[ModelMode] 模型预加载失败:', err)
            })
        )
      }

      if (uncachedTextures.length > 0) {
        loadPromises.push(
          preloadTexturesBatch(uncachedTextures, (current) => {
            textureCompleted = current
            updateCombinedProgress()
          })
        )
      }

      await Promise.all(loadPromises)

      // ✅ 检查点 2：异步加载完成后，检查 scheme 是否仍然有效
      if (editorStore.activeScheme !== currentScheme) {
        console.log('[ModelMode] 检测到方案切换，中断旧的 rebuild')
        loadingStore.cancelLoading()
        return // 立即中断，避免渲染错误的方案物品
      }
    }

    // 3. 标记需要清理的旧 InstancedMesh（延迟到新 mesh 就绪后再删除，避免闪烁）
    const activeMeshKeys = new Set(Array.from(groups.keys()).filter((k) => k !== fallbackKey))
    const meshKeysToRemove: string[] = []
    for (const [meshKey] of modelMeshMap.value.entries()) {
      if (!activeMeshKeys.has(meshKey)) {
        meshKeysToRemove.push(meshKey)
      }
    }

    // 确保 fallbackMesh 资源已初始化（但不重置 count，由后续逻辑决定）
    ensureFallbackResources()

    // 4. 为每个家具创建或更新 InstancedMesh（暂不设置 count，延迟到原子切换阶段）
    let globalIndex = 0
    const newIndexToIdMap = new Map<number, string>()
    const newIdToIndexMap = new Map<string, number>()
    const newMeshToLocalIndexMap = new Map<InstancedMesh, Map<number, string>>()
    const newInternalIdToMeshInfo = new Map<string, { meshKey: string; localIndex: number }>()

    // 收集所有需要回退的 items
    let allFallbackItems: AppItem[] = []
    if (groups.has(fallbackKey)) {
      allFallbackItems.push(...groups.get(fallbackKey)!)
    }

    // 收集新建/更新的 mesh 及其目标 count（用于原子切换）
    const pendingMeshUpdates: { mesh: InstancedMesh; count: number }[] = []

    // 遍历处理正常模型组
    for (const [meshKey, itemsOfModel] of groups.entries()) {
      if (meshKey === fallbackKey) continue

      const meta = groupMeta.get(meshKey)!

      // 创建或获取 InstancedMesh
      const existingMesh = modelMeshMap.value.get(meshKey)
      const mesh = await modelManager.createInstancedMesh(
        meta.gameId,
        meshKey,
        itemsOfModel.length,
        meta.type === 'preset'
          ? { type: 'preset', preset: meta.preset, slotValues: meta.slotValues }
          : { type: 'legacy', colorIndex: meta.colorIndex },
        !enableDye
      )

      if (!mesh) {
        // 加载失败，加入回退列表
        console.warn(`[ModelMode] Failed to create mesh for ${meshKey}, using fallback`)
        allFallbackItems.push(...itemsOfModel)
        markMeshProcessed()
        continue
      }

      // 更新引用（createInstancedMesh 可能会返回新的实例）
      if (existingMesh !== mesh) {
        modelMeshMap.value.set(meshKey, markRaw(mesh))
      }

      // ⚠️ 不在此处设置 mesh.count，延迟到原子切换阶段
      // 记录目标 count
      pendingMeshUpdates.push({ mesh, count: itemsOfModel.length })

      // 为当前 mesh 创建局部索引映射
      const localIndexMap = new Map<number, string>()

      // 设置每个实例的矩阵和颜色（此时 count=0 或旧值，不影响矩阵写入）
      for (let i = 0; i < itemsOfModel.length; i++) {
        const item = itemsOfModel[i]
        if (!item) continue

        // 位置
        scratchPosition.set(item.x, item.y, item.z)

        // 缩放参数
        const Scale = item.extra.Scale

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
        newInternalIdToMeshInfo.set(item.internalId, { meshKey, localIndex: i })
      }

      // 将当前 mesh 的局部索引映射存储起来
      newMeshToLocalIndexMap.set(mesh, localIndexMap)

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

      // 构建 BVH 加速结构：若当前几何体尚未构建 boundsTree，则进行一次构建
      if (mesh.geometry && !(mesh.geometry as any).boundsTree) {
        mesh.geometry.computeBoundsTree({
          setBoundingBox: true,
        })
      }

      globalIndex += itemsOfModel.length
      markMeshProcessed()
    }

    // 5. 集中处理所有回退物品
    let pendingFallbackCount = 0
    if (allFallbackItems.length > 0) {
      if (fallbackMesh.value) {
        const localIndexMap = new Map<number, string>()
        renderFallbackItems(
          allFallbackItems,
          globalIndex,
          newIndexToIdMap,
          newIdToIndexMap,
          localIndexMap
        )
        newMeshToLocalIndexMap.set(fallbackMesh.value, localIndexMap)

        // 更新反向索引（fallback 使用 itemId = -1）
        for (let i = 0; i < allFallbackItems.length; i++) {
          const item = allFallbackItems[i]
          if (!item) continue
          newInternalIdToMeshInfo.set(item.internalId, { meshKey: '-1', localIndex: i })
        }
        pendingFallbackCount = allFallbackItems.length
      }
    }

    // 为 fallbackMesh 构建 BVH（如果有新的回退物品）
    if (fallbackMesh.value && pendingFallbackCount > 0 && fallbackMesh.value.geometry) {
      if (!fallbackMesh.value.geometry.boundsTree) {
        fallbackMesh.value.geometry.computeBoundsTree({
          setBoundingBox: true,
        })
      }
    }

    // ✅ 检查点 3：渲染完成前最终检查（双保险）
    if (editorStore.activeScheme !== currentScheme) {
      console.log('[ModelMode] 渲染前检测到方案切换，跳过索引映射更新')
      return
    }

    // 6. 🔥 原子切换：同步设置所有新 mesh 的 count + 删除所有旧 mesh
    //    整个代码块是同步的，浏览器不会在中间插入渲染帧
    //    效果：旧场景 → 新场景，单帧切换，无闪烁

    // 6a. 设置所有新 mesh 的 count（使其可见）
    for (const { mesh, count } of pendingMeshUpdates) {
      mesh.count = count
    }

    // 6b. 设置 fallbackMesh 的 count
    if (fallbackMesh.value) {
      fallbackMesh.value.count = pendingFallbackCount
    }

    // 6c. 删除所有不再需要的旧 mesh
    for (const meshKey of meshKeysToRemove) {
      modelManager.disposeMesh(meshKey)
      modelMeshMap.value.delete(meshKey)
    }

    // 6d. 更新索引映射
    modelIndexToIdMap.value = newIndexToIdMap
    modelIdToIndexMap.value = newIdToIndexMap
    meshToLocalIndexMap.value = newMeshToLocalIndexMap
    internalIdToMeshInfo.value = newInternalIdToMeshInfo
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
    if (fallbackMesh.value) {
      if (fallbackMesh.value.geometry?.boundsTree) {
        fallbackMesh.value.geometry.disposeBoundsTree()
      }
      fallbackMesh.value.geometry = null as any
      fallbackMesh.value.material = null as any
      fallbackMesh.value = null
    }
    if (fallbackGeometry.value) {
      if (fallbackGeometry.value.boundsTree) {
        fallbackGeometry.value.disposeBoundsTree()
      }
      fallbackGeometry.value.dispose()
      fallbackGeometry.value = null
    }

    disposeThreeModelManager()
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
    fallbackMesh: fallbackMesh,
    rebuild,
    dispose,
  }
}

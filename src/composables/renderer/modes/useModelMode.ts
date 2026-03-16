import { ref, markRaw, shallowRef } from 'vue'
import { InstancedMesh, BoxGeometry, DynamicDrawUsage } from 'three'
import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThreeModelManager, disposeThreeModelManager } from '@/composables/useThreeModelManager'
import { createTimeSlicer } from '@/lib/cooperativeTask'
import { type ModelDyePlan, resolveModelDyePlan, buildModelMeshKey } from '@/lib/modelDye'
import { invalidateScene } from '@/composables/useSceneInvalidate'
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
import type { ModelAssetProfile } from '@/types/furniture'

// 当缺少尺寸信息时使用的默认尺寸（游戏坐标：X=长, Y=宽, Z=高）
const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]
// 每处理多少个模型组就提交一次到渲染层（值越小，显示越“渐进”，但提交更频繁）
const PROGRESSIVE_GROUPS_PER_COMMIT = 4
// 渐进构建时每轮给主线程预留的时间预算（ms）
const PROGRESSIVE_REBUILD_BUDGET_MS = 8

/** 模型分组元数据 */
interface GroupMeta {
  gameId: number
  dyePlan: ModelDyePlan
}

interface ModelRebuildOptions {
  isStale?: () => boolean
}

/**
 * Model 渲染模式
 *
 * 3D 模型实例化渲染（按 gameId + 染色计划分组管理多个 InstancedMesh）
 * 染色策略由 `resolveModelDyePlan` 统一决策：
 * - 无 colors 配置或 ColorMap 无有效条目 → plain
 * - colors 配置 + 有效 ColorMap 条目 → dyed（D×T multiply + N法线 + ORM）
 * 对无模型或加载失败的物品自动回退到 Box 渲染
 */
export function useModelMode() {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()
  const loadingStore = useLoadingStore()
  const settingsStore = useSettingsStore()
  let activeAssetProfile: ModelAssetProfile | null = null

  // 模型 InstancedMesh 映射：meshKey -> InstancedMesh
  // meshKey 格式示例：
  // - plain: `${gameId}|plain`
  // - dyed:  `${gameId}|dyed|0:1,2;1:0,0`
  // - preset: `${gameId}|preset|slots=${slotValues.join('_')}`
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

  function clearRenderedModelState() {
    for (const [, mesh] of modelMeshMap.value.entries()) {
      if (mesh.geometry?.boundsTree) {
        mesh.geometry.disposeBoundsTree()
      }
      mesh.count = 0
      mesh.geometry = null as any
      mesh.material = null as any
    }
    modelMeshMap.value.clear()
    modelIndexToIdMap.value.clear()
    modelIdToIndexMap.value.clear()
    meshToLocalIndexMap.value.clear()
    internalIdToMeshInfo.value.clear()
  }

  function syncAssetProfile(profile: ModelAssetProfile) {
    if (activeAssetProfile === profile) return
    clearRenderedModelState()
    if (fallbackMesh.value) {
      fallbackMesh.value.count = 0
    }
    disposeThreeModelManager()
    activeAssetProfile = profile
  }

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
    fallbackMesh.value.instanceMatrix.setUsage(DynamicDrawUsage)
    fallbackMesh.value.count = 0
  }

  /**
   * 重建所有模型实例
   */
  async function rebuild(options?: ModelRebuildOptions): Promise<boolean> {
    // 记录本次 rebuild 对应的方案和资源档位，用来判断“是否已经过期”
    const currentScheme = editorStore.activeScheme
    const assetProfile = settingsStore.settings.modelAssetProfile
    syncAssetProfile(assetProfile)
    const modelManager = getThreeModelManager()
    const items = currentScheme?.items.value ?? []
    const instanceCount = Math.min(items.length, MAX_INSTANCES)
    // isStale=true 表示这次构建结果不该再提交（例如用户切方案了）
    const isStale = () =>
      options?.isStale?.() === true ||
      editorStore.activeScheme !== currentScheme ||
      settingsStore.settings.modelAssetProfile !== assetProfile
    // 统一中断出口：取消 loading，返回 false 让上层跳过提交
    const abort = () => {
      loadingStore.cancelLoading()
      return false
    }

    if (items.length > MAX_INSTANCES) {
      console.warn(
        `[ModelMode] 当前可见物品数量 (${items.length}) 超过上限 ${MAX_INSTANCES}，仅渲染前 ${MAX_INSTANCES} 个`
      )
    }
    if (isStale()) return false

    // 1) 先把物品按“同 gameId + 同染色方案”分组
    // 这样每组可以共用一个 InstancedMesh，减少 draw call
    const groups = new Map<string, AppItem[]>()
    const groupMeta = new Map<string, GroupMeta>()
    // 特殊组：无模型配置的物品，后面只在必要时才走 fallback
    const fallbackKey = '-1'

    for (let i = 0; i < instanceCount; i++) {
      const item = items[i]
      if (!item) continue

      const config = gameDataStore.getFurnitureModelConfig(item.gameId)
      const hasValidConfig = config && config.meshes && config.meshes.length > 0

      let key: string
      if (hasValidConfig) {
        const dyePlan = resolveModelDyePlan({
          item,
          colorsConfig: config.colors,
        })
        key = buildModelMeshKey(item.gameId, dyePlan)
        if (!groupMeta.has(key)) {
          groupMeta.set(key, { gameId: item.gameId, dyePlan })
        }
      } else {
        key = fallbackKey
      }

      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }

    const modelGroupEntries = Array.from(groups.entries()).filter(
      ([meshKey]) => meshKey !== fallbackKey
    )
    // 静态 fallback：配置本身缺失（不是加载失败）
    const staticFallbackItems = groups.get(fallbackKey) ?? []
    const modelItemIds = Array.from(new Set(Array.from(groupMeta.values()).map((m) => m.gameId)))
    const unloadedIds = modelItemIds.length > 0 ? modelManager.getUnloadedModels(modelItemIds) : []

    const groupsToProcess = modelGroupEntries.length
    const trackMeshProcessing = unloadedIds.length > 0
    const totalTasks = unloadedIds.length + (trackMeshProcessing ? groupsToProcess : 0)

    let glbCompleted = 0
    let meshCompleted = 0
    let glbFailed = 0

    // 进度 = GLB 预载进度 + 分组处理进度
    const updateCombinedProgress = () => {
      if (totalTasks > 0) {
        loadingStore.updateProgress(
          glbCompleted + (trackMeshProcessing ? meshCompleted : 0),
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

    // 2) 先预热未缓存模型，避免后面每组都卡网络/解析
    if (unloadedIds.length > 0) {
      await modelManager
        .preloadModels(unloadedIds, (current, _total, failed) => {
          glbCompleted = current
          glbFailed = failed
          updateCombinedProgress()
        })
        .catch((err) => {
          console.warn('[ModelMode] 模型预加载失败:', err)
        })

      if (isStale()) {
        console.log('[ModelMode] 检测到方案切换，中断旧的 rebuild')
        return abort()
      }
    }

    const previousModelMeshMap = new Map(modelMeshMap.value)
    const hadVisibleModels = previousModelMeshMap.size > 0
    // 当旧场景已有可见模型时，中间批次先不交换映射，避免“先清空再回填”的全体闪烁。
    // 这种场景通常是移动结束/染色后的重建，优先保证画面连续性。
    const deferIntermediateSwap = hadVisibleModels
    // 用于最后清理“这次已不再使用”的旧 mesh
    const activeMeshKeys = new Set<string>()

    // 3) 不再提前清空旧 modelMeshMap，避免出现“空帧”导致整场景闪烁。
    //    fallback 仍在本轮开始时清零：它是单独 mesh，不清零会把旧回退实例追加到新回退实例后面。
    if (fallbackMesh.value) {
      fallbackMesh.value.count = 0
    }

    // 4) 渐进构建阶段使用的“进行中快照”
    // 每次 commitProgress 都会把它们拷贝到对外响应式状态
    const progressiveMeshMap = new Map<string, InstancedMesh>()
    const progressiveIndexToIdMap = new Map<number, string>()
    const progressiveIdToIndexMap = new Map<string, number>()
    const progressiveMeshToLocalIndexMap = new Map<InstancedMesh, Map<number, string>>()
    const progressiveInternalIdToMeshInfo = new Map<
      string,
      { meshKey: string; localIndex: number }
    >()
    let globalIndex = 0
    let groupsSinceLastCommit = 0
    let processedGroups = 0
    let fallbackLocalIndexMap: Map<number, string> | null = null
    // 时间切片：每处理一组都检查一次预算，超时就让出主线程
    const groupSlicer = createTimeSlicer({
      budgetMs: PROGRESSIVE_REBUILD_BUDGET_MS,
      checkEvery: 1,
    })
    groupSlicer.reset()

    // 把“当前已完成部分”提交到渲染层，让用户看到模型一批批出现
    const commitProgress = (forceFinal = false) => {
      // 若旧画面已存在，则中间批次不交换，直到最后一次提交，避免全体闪烁。
      if (deferIntermediateSwap && !forceFinal) return

      modelMeshMap.value = new Map(progressiveMeshMap)
      modelIndexToIdMap.value = new Map(progressiveIndexToIdMap)
      modelIdToIndexMap.value = new Map(progressiveIdToIndexMap)
      meshToLocalIndexMap.value = new Map(progressiveMeshToLocalIndexMap)
      internalIdToMeshInfo.value = new Map(progressiveInternalIdToMeshInfo)
      invalidateScene()
    }

    // 仅在“确实无模型可用”时才追加 fallback 物品
    // - 无配置：静态 fallback
    // - createInstancedMesh 失败：动态 fallback
    const appendFallbackItem = (item: AppItem) => {
      ensureFallbackResources()
      if (!fallbackMesh.value) return

      const mesh = fallbackMesh.value
      const localIndex = mesh.count
      // fallback 走固定容量，保险起见做越界保护
      if (localIndex >= mesh.instanceMatrix.count) {
        console.warn('[ModelMode] fallbackMesh 容量不足，跳过部分回退物品')
        return
      }

      scratchPosition.set(item.x, item.y, item.z)
      const Scale = item.extra.Scale
      const furnitureSize = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      const [sizeX, sizeY, sizeZ] = furnitureSize

      const Rotation = item.rotation
      scratchEuler.set(
        (-Rotation.x * Math.PI) / 180,
        (-Rotation.y * Math.PI) / 180,
        (Rotation.z * Math.PI) / 180,
        'ZYX'
      )
      scratchQuaternion.setFromEuler(scratchEuler)

      scratchScale.set((Scale.Y || 1) * sizeX, (Scale.X || 1) * sizeY, (Scale.Z || 1) * sizeZ)
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      mesh.setMatrixAt(localIndex, scratchMatrix)
      scratchColor.setHex(0xffffff)
      mesh.setColorAt(localIndex, scratchColor)

      mesh.count = localIndex + 1
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

      if (!fallbackLocalIndexMap) {
        fallbackLocalIndexMap = new Map<number, string>()
      }
      fallbackLocalIndexMap.set(localIndex, item.internalId)
      progressiveMeshToLocalIndexMap.set(mesh, fallbackLocalIndexMap)

      progressiveIndexToIdMap.set(globalIndex, item.internalId)
      progressiveIdToIndexMap.set(item.internalId, globalIndex)
      progressiveInternalIdToMeshInfo.set(item.internalId, { meshKey: '-1', localIndex })
      globalIndex++
    }

    // 先处理“配置缺失”的 fallback（这些不依赖模型加载结果）
    for (const item of staticFallbackItems) {
      if (isStale()) return abort()
      appendFallbackItem(item)
    }

    if (staticFallbackItems.length > 0) {
      groupsSinceLastCommit++
      commitProgress()
    }

    for (const [meshKey, itemsOfModel] of modelGroupEntries) {
      if (!(await groupSlicer.checkpoint(processedGroups))) return abort()
      if (isStale()) return abort()
      processedGroups++

      const meta = groupMeta.get(meshKey)
      if (!meta) continue

      const mesh = await modelManager.createInstancedMesh(
        meta.gameId,
        meshKey,
        itemsOfModel.length,
        meta.dyePlan
      )
      if (isStale()) return abort()

      if (!mesh) {
        // 模型创建失败时，这一组才回退到 fallback
        console.warn(`[ModelMode] Failed to create mesh for ${meshKey}, using fallback`)
        for (const item of itemsOfModel) {
          appendFallbackItem(item)
        }
        markMeshProcessed()
        groupsSinceLastCommit++
        if (groupsSinceLastCommit >= PROGRESSIVE_GROUPS_PER_COMMIT) {
          commitProgress()
          groupsSinceLastCommit = 0
        }
        continue
      }

      activeMeshKeys.add(meshKey)
      progressiveMeshMap.set(meshKey, markRaw(mesh))
      const localIndexMap = new Map<number, string>()

      for (let i = 0; i < itemsOfModel.length; i++) {
        const item = itemsOfModel[i]
        if (!item) continue

        scratchPosition.set(item.x, item.y, item.z)
        const Scale = item.extra.Scale
        const Rotation = item.rotation
        scratchEuler.set(
          (-Rotation.x * Math.PI) / 180,
          (-Rotation.y * Math.PI) / 180,
          (Rotation.z * Math.PI) / 180,
          'ZYX'
        )
        scratchQuaternion.setFromEuler(scratchEuler)
        scratchScale.set(Scale.Y || 1, Scale.X || 1, Scale.Z || 1)

        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        mesh.setMatrixAt(i, scratchMatrix)
        scratchColor.setHex(0xffffff)
        mesh.setColorAt(i, scratchColor)

        progressiveIndexToIdMap.set(globalIndex, item.internalId)
        progressiveIdToIndexMap.set(item.internalId, globalIndex)
        localIndexMap.set(i, item.internalId)
        progressiveInternalIdToMeshInfo.set(item.internalId, { meshKey, localIndex: i })
        globalIndex++
      }

      mesh.count = itemsOfModel.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()

      if (mesh.geometry && !(mesh.geometry as any).boundsTree) {
        mesh.geometry.computeBoundsTree({
          setBoundingBox: true,
        })
      }

      progressiveMeshToLocalIndexMap.set(mesh, localIndexMap)
      markMeshProcessed()
      groupsSinceLastCommit++

      if (groupsSinceLastCommit >= PROGRESSIVE_GROUPS_PER_COMMIT) {
        commitProgress()
        groupsSinceLastCommit = 0
      }
    }

    // fallback 也补齐包围球/BVH，保证拾取和后续计算稳定
    if (fallbackMesh.value && fallbackMesh.value.count > 0) {
      fallbackMesh.value.computeBoundingSphere()
      if (fallbackMesh.value.geometry && !fallbackMesh.value.geometry.boundsTree) {
        fallbackMesh.value.geometry.computeBoundsTree({
          setBoundingBox: true,
        })
      }
    }

    for (const [meshKey] of previousModelMeshMap.entries()) {
      if (!activeMeshKeys.has(meshKey)) {
        modelManager.disposeMesh(meshKey, { evictColoredMaterial: true })
      }
    }

    // 最后一轮提交，确保尾批也可见
    if (isStale()) return abort()
    commitProgress(true)
    return true
  }

  /**
   * 清理资源
   */
  function dispose() {
    clearRenderedModelState()

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
    activeAssetProfile = null
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

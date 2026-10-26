import { useRenderItems } from './shared/renderItems'
import { retainInstances } from './shared/retainInstances'
import { ref, watch, onUnmounted, computed, type Ref } from 'vue'
import {
  Matrix4,
  Vector3,
  InstancedBufferAttribute,
  type Camera,
  type Raycaster,
  type InstancedMesh,
} from 'three'
import { ObjectBVH } from 'three-mesh-bvh'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useThrottleFn } from '@vueuse/core'
import type { ViewPreset } from '../useThreeCamera'
import { useBoxMode } from './modes/useBoxMode'
import { useIconMode } from './modes/useIconMode'
import { useSimpleBoxMode } from './modes/useSimpleBoxMode'
import { useModelMode } from './modes/useModelMode'
import { useInstanceColor } from './shared/useInstanceColor'
import { useInstanceMatrix } from './shared/useInstanceMatrix'
import { useSelectionOutline } from './shared/useSelectionOutline'
import { createRaycastTask, cancelTask, raycastInstancedMeshAsync } from './shared/asyncRaycast'
import type {
  InteractionAdapter,
  RaycastHit,
  RaycastTask,
  RegionViewport,
  RegionCenterCandidate,
} from './types'
import { initBVH } from './bvh'
import { initEulerMatrixCache } from '@nuan5-pro/render'
import { requiredInstanceCount } from '@/lib/renderInstanceBudget'
import { invalidateScene } from '@/composables/useSceneInvalidate'
import type { ScreenPoint } from '@/lib/interaction/screenGeometry'

// 全局 BVH 初始化标志（确保只初始化一次）
let bvhInitialized = false

export function useThreeInstancedRenderer(isTransformDragging?: Ref<boolean>) {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()
  const settingsStore = useSettingsStore()
  const uiStore = useUIStore()
  const getRenderItems = useRenderItems()

  // 初始化 BVH 加速（仅执行一次）
  if (!bvhInitialized) {
    initBVH()
    bvhInitialized = true
  }
  initEulerMatrixCache()

  // 初始化各模式 composables
  const boxMode = useBoxMode()
  const iconMode = useIconMode()
  const simpleBoxMode = useSimpleBoxMode()
  const modelMode = useModelMode()

  // 初始化颜色管理器
  const colorManager = useInstanceColor()

  // 初始化矩阵更新器
  const matrixUpdater = useInstanceMatrix()

  // 初始化 Model 模式描边管理器（屏幕空间）
  const selectionOutline = useSelectionOutline()

  // 全局索引映射（用于 box/icon/simple-box 模式）
  const indexToIdMap = ref(new Map<number, string>())
  const idToIndexMap = ref(new Map<string, number>())
  let isDisposed = false
  const interactionReady = ref(false)

  // 重建调度器：保证同一时刻只有一个 rebuild 在执行，后续请求合并到下一轮
  let rebuildPending = false
  let rebuildRunner: Promise<void> | null = null
  let requestedRebuildSeq = 0
  let modelPickBVH: ObjectBVH | null = null
  let modelPickMeshMap: Map<string, InstancedMesh> | null = null
  let modelPickBoundsDirty = false

  function buildSidebarHoveredItemIds(): Set<string> | null {
    const scheme = editorStore.activeScheme
    if (!scheme) return null
    const hoveredGameId = uiStore.sidebarHoveredGameId
    if (hoveredGameId === null) return null

    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return null

    const hoveredIds = new Set<string>()
    for (const id of selectedIds) {
      const item = editorStore.itemsMap.get(id)
      if (item?.gameId === hoveredGameId) {
        hoveredIds.add(item.internalId)
      }
    }
    return hoveredIds.size > 0 ? hoveredIds : null
  }

  function syncSidebarHoveredIds() {
    colorManager.setSidebarHoveredItemIds(buildSidebarHoveredItemIds())
  }

  function getEffectiveHoveredIds(): Set<string> | null {
    const sidebarHovered = colorManager.sidebarHoveredItemIds.value
    if (sidebarHovered && sidebarHovered.size > 0) {
      return sidebarHovered
    }
    if (colorManager.hoveredItemId.value) {
      return new Set([colorManager.hoveredItemId.value])
    }
    return null
  }

  async function rebuildLoop() {
    while (rebuildPending && !isDisposed) {
      rebuildPending = false
      const seq = requestedRebuildSeq
      await rebuildInstances(seq)
    }
  }

  function scheduleRebuild() {
    if (isDisposed) return

    requestedRebuildSeq++
    modelMode.cancelPending()
    rebuildPending = true
    if (rebuildRunner) return

    rebuildRunner = rebuildLoop()
      .catch((error) => {
        console.error('[ThreeInstancedRenderer] rebuild failed:', error)
      })
      .finally(() => {
        rebuildRunner = null
        if (rebuildPending && !isDisposed) {
          scheduleRebuild()
        }
      })
  }

  /**
   * 主重建函数（路由到对应模式）
   */
  async function rebuildInstances(seq: number) {
    if (isDisposed) return

    const mode = settingsStore.settings.threeDisplayMode
    const items = getRenderItems()
    const version = editorStore.sceneVersion
    const isStale = () =>
      isDisposed || seq !== requestedRebuildSeq || editorStore.sceneVersion !== version
    const meshTarget = boxMode.mesh.value
    const iconMeshTarget = iconMode.mesh.value
    const simpleBoxMeshTarget = simpleBoxMode.mesh.value
    syncSidebarHoveredIds()

    // 隐藏其他模式的 mesh
    if (mode !== 'box' && meshTarget) {
      meshTarget.count = 0
    }
    if (mode !== 'icon' && iconMeshTarget) {
      iconMeshTarget.count = 0
    }
    if (mode !== 'simple-box' && simpleBoxMeshTarget) {
      simpleBoxMeshTarget.count = 0
    }
    if (mode !== 'model') {
      modelMode.setVisible(false)
      if (modelMode.fallbackMesh.value) {
        modelMode.fallbackMesh.value.count = 0
      }
      selectionOutline.reconcileMaskMeshes(new Map<string, InstancedMesh>(), null)
    }

    // 执行对应模式的重建
    switch (mode) {
      case 'box':
        boxMode.rebuild(items)
        break
      case 'icon':
        if (!(await iconMode.rebuild(items, isStale))) return
        break
      case 'simple-box':
        simpleBoxMode.rebuild(items)
        break
      case 'model':
        // 若本轮构建被模型模式内部中断（方案切换等），跳过后续提交，等待下一轮
        const committed = await modelMode.rebuild({
          items,
          isStale,
        })
        if (!committed || isDisposed || seq !== requestedRebuildSeq) {
          return
        }

        interactionReady.value = true
        if (!modelMode.structureChanged) {
          colorManager.updateModelItems(
            modelMode.changedItems,
            modelMode.meshMap.value,
            modelMode.internalIdToMeshInfo.value,
            modelMode.fallbackMesh.value
          )
          modelPickBoundsDirty = true
          selectionOutline.updateMatrices(modelMode.meshMap.value, modelMode.fallbackMesh.value)
          invalidateScene()
          return
        }

        rebuildModelPickIndex()

        const fallbackMesh = modelMode.fallbackMesh.value

        // 先对齐 mask mesh 集合，确保不会累积 stale mask
        selectionOutline.reconcileMaskMeshes(modelMode.meshMap.value, fallbackMesh)

        // 更新 mask 状态
        const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
        selectionOutline.updateMasks(
          selectedItemIds,
          getEffectiveHoveredIds(),
          modelMode.meshMap.value,
          modelMode.internalIdToMeshInfo.value,
          fallbackMesh
        )

        // Model 模式使用独立的索引映射，直接返回不更新全局映射
        colorManager.updateInstancesColor(
          mode,
          meshTarget,
          iconMeshTarget,
          simpleBoxMeshTarget,
          modelMode.indexToIdMap.value,
          modelMode.meshMap.value,
          modelMode.internalIdToMeshInfo.value,
          modelMode.fallbackMesh.value
        )

        invalidateScene()
        return
    }

    // 当前构建已过期，直接丢弃结果（下一轮会提交最新状态）
    if (isDisposed || seq !== requestedRebuildSeq) {
      return
    }

    // 非 Model 模式：构建全局索引映射
    const map = new Map<number, string>()
    const instanceCount = requiredInstanceCount(items.length)

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) continue
      map.set(index, item.internalId)
    }

    indexToIdMap.value = map
    const reverseMap = new Map<string, number>()
    for (const [index, id] of map.entries()) {
      reverseMap.set(id, index)
    }
    idToIndexMap.value = reverseMap
    interactionReady.value = true

    // 更新颜色
    // 重新获取 mesh 引用，因为 rebuild 可能重新创建了 mesh（例如首次进入 Icon 模式时）
    colorManager.updateInstancesColor(
      mode,
      boxMode.mesh.value,
      iconMode.mesh.value,
      simpleBoxMode.mesh.value,
      map
    )

    invalidateScene()
  }

  /**
   * 更新选中实例的矩阵（Gizmo 拖拽时调用）
   *
   * @param skipBVHRefit - 是否跳过 BVH 重建（拖拽过程中应传 true 以提升性能）
   */
  function updateSelectedInstancesMatrix(
    idToWorldMatrixMap: Map<string, Matrix4>,
    skipBVHRefit: boolean = false
  ) {
    if (!interactionReady.value) return
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = boxMode.mesh.value
    const iconMeshTarget = iconMode.mesh.value
    const simpleBoxMeshTarget = simpleBoxMode.mesh.value

    // Model 模式使用独立的索引映射
    const currentIdToIndexMap = mode === 'model' ? modelMode.idToIndexMap.value : idToIndexMap.value

    if (mode === 'model') modelMode.updateMatrices(idToWorldMatrixMap)

    const directMatrices =
      mode === 'model'
        ? new Map(
            [...idToWorldMatrixMap].filter(
              ([id]) => modelMode.internalIdToMeshInfo.value.get(id)?.meshKey === '-1'
            )
          )
        : idToWorldMatrixMap
    matrixUpdater.updateSelectedInstancesMatrix(
      directMatrices,
      mode,
      meshTarget,
      iconMeshTarget,
      simpleBoxMeshTarget,
      currentIdToIndexMap,
      iconMode.currentIconNormal.value,
      iconMode.currentIconUp.value,
      // Model 模式额外参数
      modelMode.meshMap.value,
      modelMode.internalIdToMeshInfo.value,
      modelMode.fallbackMesh.value,
      // 性能优化参数
      skipBVHRefit
    )

    // Packed masks have their own matrices, so preview transforms must also
    // update their highlighted subset. Refit picking bounds on the next pick.
    if (mode === 'model') {
      modelPickBoundsDirty = true
    }
    if (mode === 'model' && skipBVHRefit) {
      selectionOutline.updateMatrices(modelMode.meshMap.value, modelMode.fallbackMesh.value)
    } else if (mode === 'model') {
      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
      selectionOutline.updateMasks(
        selectedItemIds,
        getEffectiveHoveredIds(),
        modelMode.meshMap.value,
        modelMode.internalIdToMeshInfo.value,
        modelMode.fallbackMesh.value
      )
    }

    invalidateScene()
  }

  /**
   * 设置 hover 物品 ID（用于高亮显示）
   */
  function setHoveredItemId(id: string | null) {
    if (colorManager.hoveredItemId.value === id && !colorManager.suppressedHoverId.value) return
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = boxMode.mesh.value
    const iconMeshTarget = iconMode.mesh.value
    const simpleBoxMeshTarget = simpleBoxMode.mesh.value

    // Model 模式使用独立的索引映射
    const currentIdToIndexMap = mode === 'model' ? modelMode.idToIndexMap.value : idToIndexMap.value

    if (mode === 'model') {
      // Model 模式：hover 不影响颜色（由描边系统处理），只需更新 mask
      // 注意：参照物颜色由 rebuild/参照物变化 watcher 负责更新，hover 不改变

      // ✅ 新增：hover 抑制逻辑（与 Box 模式保持一致）
      // 如果当前有被抑制的 hover ID，且传入的 ID 依然是它，则忽略（保持选中状态的描边）
      if (colorManager.suppressedHoverId.value && id === colorManager.suppressedHoverId.value) {
        return
      }

      // 如果鼠标移到了其他物体或空处，解除抑制
      if (colorManager.suppressedHoverId.value && id !== colorManager.suppressedHoverId.value) {
        colorManager.suppressedHoverId.value = null
      }

      colorManager.hoveredItemId.value = id

      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
      selectionOutline.updateMasks(
        selectedItemIds,
        getEffectiveHoveredIds(),
        modelMode.meshMap.value,
        modelMode.internalIdToMeshInfo.value,
        modelMode.fallbackMesh.value
      )
    } else {
      // Box/Icon/SimpleBox 模式：使用颜色系统处理 hover 高亮
      colorManager.setHoveredItemId(
        id,
        mode,
        meshTarget,
        iconMeshTarget,
        simpleBoxMeshTarget,
        currentIdToIndexMap
      )
    }

    invalidateScene()
  }

  /**
   * 更新图标朝向（仅 Icon 模式）
   */
  function updateIconFacing(normal: [number, number, number], up?: [number, number, number]) {
    iconMode.updateFacing(normal, up)
    invalidateScene()
  }

  /**
   * 设置图标朝向自动管理
   *
   * 根据相机位置和视图预设自动更新图标朝向
   * - 正交视图：固定朝向（基于视图预设）
   * - 透视视图：图标朝向相机（billboard 效果）
   */
  function setupIconFacing(
    cameraPosition: Ref<[number, number, number]>,
    cameraLookAt: Ref<[number, number, number]>,
    cameraUp: Ref<[number, number, number]>,
    currentViewPreset: Ref<ViewPreset | null>
  ) {
    // 创建节流函数，用于透视视图下的图标朝向更新（避免过于频繁的更新）
    const updateIconFacingThrottled = useThrottleFn(
      (normal: [number, number, number], up?: [number, number, number]) => {
        updateIconFacing(normal, up)
      },
      150
    ) // 每150ms最多更新一次

    // 在视图或模式变化时，更新 Icon 面朝方向（仅图标模式）
    watch(
      [
        () => settingsStore.settings.threeDisplayMode,
        () => currentViewPreset.value,
        () => cameraPosition.value, // 监听相机位置，用于透视视图下的实时跟随
        () => cameraLookAt.value, // 监听相机目标，用于计算朝向
      ],
      ([mode, preset, camPos, camTarget]) => {
        if (mode !== 'icon') {
          return
        }

        let normal: [number, number, number] = [0, 0, 1]

        // 如果是正交视图预设，使用固定朝向
        if (preset && preset !== 'perspective') {
          let up: [number, number, number] = [0, 0, 1]

          switch (preset) {
            case 'top':
              normal = [0, 0, 1] // 顶视图看 XY 平面
              up = [0, 1, 0] // Y轴朝上
              break
            case 'bottom':
              normal = [0, 0, -1]
              up = [0, -1, 0] // 翻转 180 度
              break
            case 'front':
              normal = [0, -1, 0]
              up = [0, 0, 1] // Z轴朝上
              break
            case 'back':
              normal = [0, 1, 0]
              up = [0, 0, 1] // Z轴朝上
              break
            case 'right':
              normal = [1, 0, 0]
              up = [0, 0, 1] // Z轴朝上
              break
            case 'left':
              normal = [-1, 0, 0]
              up = [0, 0, 1] // Z轴朝上
              break
          }
          // 正交视图：立即更新，无需节流（切换频率低）
          updateIconFacing(normal, up)
        } else {
          // 透视视图：计算从目标点指向相机的方向，使图标法线朝向相机（图标面向相机）
          const dirX = camPos[0] - camTarget[0]
          const dirY = camPos[1] - camTarget[1]
          const dirZ = camPos[2] - camTarget[2]

          // 归一化向量
          const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ)
          if (len > 0.0001) {
            normal = [dirX / len, dirY / len, dirZ / len]
          }

          // 透视视图：使用节流更新，并传入 cameraUp 向量防止图标绕法线旋转
          updateIconFacingThrottled(normal, cameraUp.value)
        }
      },
      { immediate: true }
    )
  }

  // 当前活动的异步射线检测任务（用于取消）
  let activeRaycastTask: RaycastTask | null = null
  const geometryCenterCache = new WeakMap<object, Vector3>()
  const scratchRegionInstanceMatrix = new Matrix4()
  const scratchRegionWorldMatrix = new Matrix4()
  const scratchRegionWorldPoint = new Vector3()
  const scratchRegionCameraPoint = new Vector3()
  /** projectionMatrix * matrixWorldInverse，每轮 mesh 遍历前更新 */
  const scratchRegionProjView = new Matrix4()
  /** 相机注视方向（世界空间），与 matrixWorldInverse 第三行约定一致，用于等价于「视图 z>=0」的前方剔除 */
  const scratchCameraForward = new Vector3()
  /** 区域选择 visitor 的 center：仅在 visitor 同步回调执行期间有效 */
  const scratchRegionCenterScreen: ScreenPoint = { x: 0, y: 0 }

  function getActiveInstancedMesh(mode: string): InstancedMesh | null {
    if (mode === 'icon') return iconMode.mesh.value
    if (mode === 'simple-box') return simpleBoxMode.mesh.value
    return boxMode.mesh.value
  }

  function getGeometryLocalCenter(mesh: InstancedMesh): Vector3 | null {
    const geometry = mesh.geometry
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }

    const boundingBox = geometry.boundingBox
    if (!boundingBox) return null

    let cachedCenter = geometryCenterCache.get(geometry)
    if (!cachedCenter) {
      cachedCenter = new Vector3()
      boundingBox.getCenter(cachedCenter)
      geometryCenterCache.set(geometry, cachedCenter)
    }

    return cachedCenter
  }

  /**
   * 将实例几何中心投影到屏幕像素；成功时写入 scratchRegionCenterScreen。
   * 依赖调用方已写入 scratchRegionProjView = P * V 及 scratchCameraForward（每轮 mesh 遍历前）。
   * 与分步「V * world → z 剔除 → P * view」等价：对 world 只做一次 applyMatrix4(P*V)；
   * 前方剔除用 (world - camera.position)·forward <= 0，与默认相机下「视图 z >= 0」同侧。
   */
  function projectMeshInstanceCenter(
    mesh: InstancedMesh,
    instanceId: number,
    camera: Camera,
    viewport: RegionViewport
  ): boolean {
    const localCenter = getGeometryLocalCenter(mesh)
    if (!localCenter) return false

    mesh.getMatrixAt(instanceId, scratchRegionInstanceMatrix)
    scratchRegionWorldMatrix.multiplyMatrices(mesh.matrixWorld, scratchRegionInstanceMatrix)

    scratchRegionWorldPoint.copy(localCenter).applyMatrix4(scratchRegionWorldMatrix)

    scratchRegionCameraPoint.subVectors(scratchRegionWorldPoint, camera.position)
    if (scratchRegionCameraPoint.dot(scratchCameraForward) <= 0) {
      return false
    }

    scratchRegionWorldPoint.applyMatrix4(scratchRegionProjView)
    if (
      !Number.isFinite(scratchRegionWorldPoint.x) ||
      !Number.isFinite(scratchRegionWorldPoint.y)
    ) {
      return false
    }

    // NDC [-1,1] 转换为像素坐标
    scratchRegionCenterScreen.x = (scratchRegionWorldPoint.x + 1) * 0.5 * viewport.width
    scratchRegionCenterScreen.y = (-scratchRegionWorldPoint.y + 1) * 0.5 * viewport.height
    return true
  }

  function forEachMeshRegionCenterCandidate(
    mesh: InstancedMesh | null,
    idMap: ReadonlyMap<number, string>,
    camera: Camera,
    viewport: RegionViewport,
    seenIds: Set<string>,
    visitor: (candidate: RegionCenterCandidate) => void
  ) {
    if (!mesh || mesh.count === 0 || idMap.size === 0) return

    mesh.updateWorldMatrix(true, false)

    scratchRegionProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    camera.getWorldDirection(scratchCameraForward)

    for (let instanceId = 0; instanceId < mesh.count; instanceId++) {
      const internalId = idMap.get(instanceId)
      if (!internalId) continue
      // seenIds 用于 model 模式：防止同一物品出现在多个 mesh 中时被重复计入
      if (seenIds.has(internalId)) continue

      if (!projectMeshInstanceCenter(mesh, instanceId, camera, viewport)) continue

      seenIds.add(internalId)
      visitor({ internalId, center: scratchRegionCenterScreen })
    }
  }

  /**
   * 返回 model 模式下所有可遍历的 mesh 及其局部索引映射（含 fallbackMesh）。
   * 拾取索引和区域选择共用这份模型 / fallback 遍历。
   */
  function getModelMeshesWithIndexMap(): Array<{
    mesh: InstancedMesh
    indexMap: ReadonlyMap<number, string>
  }> {
    const result: Array<{ mesh: InstancedMesh; indexMap: ReadonlyMap<number, string> }> = []

    for (const mesh of modelMode.meshMap.value.values()) {
      const indexMap = modelMode.meshToLocalIndexMap.value.get(mesh)
      if (mesh && indexMap) result.push({ mesh, indexMap })
    }

    const fallbackMesh = modelMode.fallbackMesh.value
    if (fallbackMesh) {
      const indexMap = modelMode.meshToLocalIndexMap.value.get(fallbackMesh)
      if (indexMap) result.push({ mesh: fallbackMesh, indexMap })
    }

    return result
  }

  function rebuildModelPickIndex() {
    const meshes = getModelMeshesWithIndexMap()
      .filter(({ mesh }) => mesh.count > 0)
      .map(({ mesh }) => mesh)
    for (const mesh of meshes) mesh.updateWorldMatrix(true, false)
    modelPickBVH = meshes.length > 0 ? new ObjectBVH(meshes) : null
    modelPickMeshMap = modelMode.meshMap.value
    modelPickBoundsDirty = false
  }

  function pickModel(raycaster: Raycaster): RaycastHit | null {
    // Progressive loading also commits new mesh-map snapshots before the
    // final rebuild completes; never pick against an older instance topology.
    if (!modelPickBVH || modelPickMeshMap !== modelMode.meshMap.value) rebuildModelPickIndex()
    if (!modelPickBVH) return null
    if (modelPickBoundsDirty) {
      modelPickBVH.refit()
      modelPickBoundsDirty = false
    }

    const firstHitOnly = raycaster.firstHitOnly
    raycaster.firstHitOnly = true
    try {
      const hit = modelPickBVH.raycast(raycaster)[0]
      if (!hit || hit.instanceId === undefined) return null
      const internalId = modelMode.meshToLocalIndexMap.value
        .get(hit.object as InstancedMesh)
        ?.get(hit.instanceId)
      return internalId ? { instanceId: hit.instanceId, internalId, distance: hit.distance } : null
    } finally {
      raycaster.firstHitOnly = firstHitOnly
    }
  }

  /**
   * 获取当前模式的交互适配器（统一点击 / hover / 区域选择接口）
   */
  const interactionAdapter = computed<InteractionAdapter>(() => {
    const mode = settingsStore.settings.threeDisplayMode

    return {
      // 同步射线检测（用于点击等需要立即结果的场景）
      pick: (raycaster: Raycaster) => {
        if (!interactionReady.value) return null
        if (mode === 'model') {
          return pickModel(raycaster)
        } else {
          // Box/Icon/SimpleBox 模式：单 mesh 检测
          const targetMesh = getActiveInstancedMesh(mode)
          if (!targetMesh || targetMesh.count === 0) return null

          const intersects = raycaster.intersectObject(targetMesh, false)
          const hit = intersects[0]
          if (!hit || hit.instanceId === undefined) return null

          const internalId = indexToIdMap.value.get(hit.instanceId)
          return internalId
            ? { instanceId: hit.instanceId, internalId, distance: hit.distance }
            : null
        }
      },

      // 异步时间切片射线检测（用于 tooltip 等可接受延迟的场景）
      pickAsync: async (raycaster: Raycaster) => {
        if (!interactionReady.value) return null
        // 取消上一次未完成的检测，避免旧任务的结果覆盖最新的 hover 状态
        cancelTask(activeRaycastTask)

        const task = createRaycastTask()
        activeRaycastTask = task

        if (mode === 'model') {
          const hit = pickModel(raycaster)
          // Preserve cancellation across the async adapter boundary.
          await Promise.resolve()
          return task.cancelled ? null : hit
        } else {
          // Box/Icon/SimpleBox 模式：单 mesh，也使用可中断检测（实例数多时同样会卡）
          const targetMesh = getActiveInstancedMesh(mode)
          if (!targetMesh || targetMesh.count === 0) return null

          return await raycastInstancedMeshAsync(
            targetMesh,
            raycaster,
            task,
            indexToIdMap.value,
            500
          )
        }
      },

      // 取消当前进行中的异步检测
      cancelPick: () => {
        cancelTask(activeRaycastTask)
        activeRaycastTask = null
      },

      // 枚举当前模式下可参与区域选择的中心点候选（框选 / 套索的核心数据来源）
      forEachRegionCenterCandidate: (camera, viewport, visitor) => {
        if (!interactionReady.value) return
        // seenIds 防止 model 模式下同一物品出现在多个 mesh 时被重复访问
        const seenIds = new Set<string>()

        if (mode === 'model') {
          for (const { mesh, indexMap } of getModelMeshesWithIndexMap()) {
            forEachMeshRegionCenterCandidate(mesh, indexMap, camera, viewport, seenIds, visitor)
          }
          return
        }

        forEachMeshRegionCenterCandidate(
          getActiveInstancedMesh(mode),
          indexToIdMap.value,
          camera,
          viewport,
          seenIds,
          visitor
        )
      },
    }
  })

  // Interaction and visibility have separate lifetimes during asynchronous preparation.
  function suspendInteraction() {
    interactionReady.value = false
    cancelTask(activeRaycastTask)
    activeRaycastTask = null
    modelPickBVH = null
    modelPickMeshMap = null
    colorManager.hoveredItemId.value = null
    colorManager.suppressedHoverId.value = null
    colorManager.setSidebarHoveredItemIds(null)
    selectionOutline.reconcileMaskMeshes(new Map(), null)
  }

  function invalidateVisibleInstances() {
    suspendInteraction()
    for (const mesh of [
      boxMode.mesh.value,
      iconMode.mesh.value,
      simpleBoxMode.mesh.value,
      modelMode.fallbackMesh.value,
    ]) {
      if (mesh) mesh.count = 0
    }
    modelMode.hideInstances()
    indexToIdMap.value = new Map()
    idToIndexMap.value = new Map()
    invalidateScene({ shadows: true })
  }

  function retainVisibleInstances() {
    suspendInteraction()
    const items = getRenderItems()
    const mode = settingsStore.settings.threeDisplayMode
    if (mode === 'model') {
      modelMode.retainItems(items)
    } else {
      const mesh = getActiveInstancedMesh(mode)
      if (mesh) {
        const textureIndices = mesh.geometry.getAttribute('textureIndex')
        const retained = retainInstances(
          mesh,
          indexToIdMap.value,
          new Set(items.map((item) => item.internalId)),
          textureIndices instanceof InstancedBufferAttribute ? [textureIndices] : []
        )
        indexToIdMap.value = retained
        idToIndexMap.value = new Map([...retained].map(([index, id]) => [id, index]))
      }
    }
    invalidateScene({ shadows: true })
  }

  watch(
    () => editorStore.renderItemIds,
    () => {
      retainVisibleInstances()
      scheduleRebuild()
    },
    { flush: 'sync' }
  )

  // Watchers
  watch(
    () => editorStore.activeScheme,
    () => {
      // Scheme identity, not sceneVersion: transforms, dyes and camera changes
      // keep their visible meshes. A different scheme must never inherit them.
      requestedRebuildSeq++
      invalidateVisibleInstances()
      modelMode.clearScene()
    },
    { flush: 'sync' }
  )

  watch(
    [
      () => editorStore.activeSchemeId, // 切换方案时重建
      () => editorStore.sceneVersion, // 任何已提交场景变更都触发全量重建
      () => gameDataStore.isInitialized, // 监听游戏数据加载状态（延迟加载支持）
    ],
    ([schemeId], previous) => {
      // 拖拽时不触发全量更新，由 handleGizmoChange 直接更新实例矩阵
      if (isTransformDragging?.value && schemeId === previous?.[0]) {
        return
      }
      scheduleRebuild()
    },
    { deep: false, immediate: true }
  )

  // 监听显示模式变化，立即重建实例
  watch(
    () => settingsStore.settings.threeDisplayMode,
    () => {
      invalidateVisibleInstances()
      scheduleRebuild()
    },
    { flush: 'sync' }
  )

  watch(
    () => [
      settingsStore.settings.modelAssetProfile,
      settingsStore.settings.materialAssetProfile,
      gameDataStore.furnitureDBRevision,
    ],
    () => {
      scheduleRebuild()
    }
  )

  // 监听模型组合配色开关：仅重算实例颜色，不重建模型
  watch(
    () => settingsStore.settings.modelGroupColorTint,
    () => {
      if (settingsStore.settings.threeDisplayMode !== 'model') return

      colorManager.updateInstancesColor(
        'model',
        null,
        null,
        null,
        modelMode.indexToIdMap.value,
        modelMode.meshMap.value,
        modelMode.internalIdToMeshInfo.value,
        modelMode.fallbackMesh.value
      )

      invalidateScene()
    }
  )

  // 监听符号缩放变化：在当前模式下更新实例并触发重渲染
  watch(
    () => settingsStore.settings.threeSymbolScale,
    () => {
      const mode = settingsStore.settings.threeDisplayMode

      // 仅在会受 threeSymbolScale 影响的模式下处理
      if (mode === 'icon') {
        // Icon 模式：复用当前朝向信息，重新应用缩放
        iconMode.updateFacing(
          iconMode.currentIconNormal.value,
          iconMode.currentIconUp.value || undefined
        )
      } else if (mode === 'simple-box') {
        // Simple-box 模式：更新所有实例缩放
        simpleBoxMode.updateScale()
      } else {
        return
      }

      invalidateScene()
    }
  )

  // 监听结构面板 hover 类型变化，联动画布高亮
  watch(
    () => uiStore.sidebarHoveredGameId,
    () => {
      if (!interactionReady.value || isTransformDragging?.value) {
        return
      }

      syncSidebarHoveredIds()

      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
      const mode = settingsStore.settings.threeDisplayMode

      if (mode === 'model') {
        selectionOutline.updateMasks(
          selectedItemIds,
          getEffectiveHoveredIds(),
          modelMode.meshMap.value,
          modelMode.internalIdToMeshInfo.value,
          modelMode.fallbackMesh.value
        )
        // 模型模式的悬停反馈仅使用轮廓，不修改实例颜色。
        invalidateScene()
        return
      }

      colorManager.updateInstancesColor(
        mode,
        boxMode.mesh.value,
        iconMode.mesh.value,
        simpleBoxMode.mesh.value,
        indexToIdMap.value
      )

      invalidateScene()
    }
  )

  // 监听选中状态变化，刷新颜色
  watch(
    [
      () => editorStore.activeScheme?.selectedItemIds.value, // 监听 Set 引用变化（切换方案时）
      () => editorStore.selectionVersion, // 监听版本号（选择变化时）
    ],
    () => {
      if (!interactionReady.value || isTransformDragging?.value) {
        return
      }

      const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()

      // 1. 处理刚刚被选中的情况：抑制 Hover，使其显示选中色
      if (
        colorManager.hoveredItemId.value &&
        selectedItemIds.has(colorManager.hoveredItemId.value)
      ) {
        colorManager.suppressedHoverId.value = colorManager.hoveredItemId.value
        colorManager.hoveredItemId.value = null
      }

      // 2. 处理被抑制的物品不再被选中的情况：解除抑制
      if (
        colorManager.suppressedHoverId.value &&
        !selectedItemIds.has(colorManager.suppressedHoverId.value)
      ) {
        colorManager.suppressedHoverId.value = null
      }
      syncSidebarHoveredIds()

      const mode = settingsStore.settings.threeDisplayMode
      const meshTarget = boxMode.mesh.value
      const iconMeshTarget = iconMode.mesh.value
      const simpleBoxMeshTarget = simpleBoxMode.mesh.value

      // Model 模式使用独立的索引映射
      const currentIndexToIdMap =
        mode === 'model' ? modelMode.indexToIdMap.value : indexToIdMap.value

      if (mode === 'model') {
        // Model 模式：更新 mask
        selectionOutline.updateMasks(
          selectedItemIds,
          getEffectiveHoveredIds(),
          modelMode.meshMap.value,
          modelMode.internalIdToMeshInfo.value,
          modelMode.fallbackMesh.value
        )
      }

      colorManager.updateInstancesColor(
        mode,
        meshTarget,
        iconMeshTarget,
        simpleBoxMeshTarget,
        currentIndexToIdMap,
        mode === 'model' ? modelMode.meshMap.value : undefined,
        mode === 'model' ? modelMode.internalIdToMeshInfo.value : undefined,
        mode === 'model' ? modelMode.fallbackMesh.value : undefined
      )

      invalidateScene()
    }
  )

  // 监听参照物变化，刷新颜色
  watch(
    () => uiStore.alignReferenceItemId,
    (newId, oldId) => {
      if (!interactionReady.value || isTransformDragging?.value) {
        return
      }

      const mode = settingsStore.settings.threeDisplayMode
      const meshTarget = boxMode.mesh.value
      const iconMeshTarget = iconMode.mesh.value
      const simpleBoxMeshTarget = simpleBoxMode.mesh.value

      // Model 模式使用独立的索引映射
      const currentIdToIndexMap =
        mode === 'model' ? modelMode.idToIndexMap.value : idToIndexMap.value

      // 更新旧参照物的颜色（恢复原色）
      if (oldId) {
        if (mode === 'model') {
          // Model 模式：更新 mask（虽然参照物不走 mask，但确保颜色更新）
          const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
          selectionOutline.updateMasks(
            selectedItemIds,
            getEffectiveHoveredIds(),
            modelMode.meshMap.value,
            modelMode.internalIdToMeshInfo.value,
            modelMode.fallbackMesh.value
          )
        }
        colorManager.updateInstanceColorById(
          oldId,
          mode,
          meshTarget,
          iconMeshTarget,
          simpleBoxMeshTarget,
          currentIdToIndexMap,
          mode === 'model' ? modelMode.meshMap.value : undefined,
          mode === 'model' ? modelMode.internalIdToMeshInfo.value : undefined,
          mode === 'model' ? modelMode.fallbackMesh.value : undefined
        )
      }

      // 更新新参照物的颜色（高亮）
      if (newId) {
        if (mode === 'model') {
          const selectedItemIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set()
          selectionOutline.updateMasks(
            selectedItemIds,
            getEffectiveHoveredIds(),
            modelMode.meshMap.value,
            modelMode.internalIdToMeshInfo.value,
            modelMode.fallbackMesh.value
          )
        }
        colorManager.updateInstanceColorById(
          newId,
          mode,
          meshTarget,
          iconMeshTarget,
          simpleBoxMeshTarget,
          currentIdToIndexMap,
          mode === 'model' ? modelMode.meshMap.value : undefined,
          mode === 'model' ? modelMode.internalIdToMeshInfo.value : undefined,
          mode === 'model' ? modelMode.fallbackMesh.value : undefined
        )
      }

      invalidateScene()
    }
  )

  // 资源清理
  onUnmounted(() => {
    isDisposed = true
    rebuildPending = false
    modelPickBVH = null
    modelPickMeshMap = null
    console.log('[ThreeInstancedRenderer] Disposing resources')
    boxMode.dispose()
    iconMode.dispose()
    simpleBoxMode.dispose()
    modelMode.dispose()
    selectionOutline.dispose()
  })

  // 返回统一接口
  return {
    isModelCaptureReady: () =>
      !isDisposed &&
      !rebuildPending &&
      !rebuildRunner &&
      !isTransformDragging?.value &&
      interactionReady.value &&
      settingsStore.settings.threeDisplayMode === 'model' &&
      modelMode.isProjectionCurrent(),
    isInteractionReady: computed(() => interactionReady.value),
    instancedMesh: boxMode.mesh,
    iconInstancedMesh: iconMode.mesh,
    simpleBoxInstancedMesh: simpleBoxMode.mesh,
    modelMeshMap: modelMode.meshMap,
    modelFallbackMesh: modelMode.fallbackMesh,
    updateSelectedInstancesMatrix,
    setHoveredItemId,
    updateIconFacing,
    setupIconFacing,
    interactionAdapter,
    renderSelectionOutlineMaskPass: selectionOutline.renderMaskPass,
    renderSelectionOutlineOverlay: selectionOutline.renderOverlay,
    syncOutlineSceneTransform: selectionOutline.syncSceneTransform,
  }
}

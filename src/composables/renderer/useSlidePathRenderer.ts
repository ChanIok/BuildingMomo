import { selectRenderItems } from './shared/renderItems'
import { computed, markRaw, onUnmounted, ref, watch } from 'vue'
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Sphere,
  SphereGeometry,
  Vector3,
  type Camera,
  type Raycaster,
} from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { invalidateScene } from '@/composables/useSceneInvalidate'
import { matrixTransform } from '@/lib/matrixTransform'
import { nextInstancedPoolCapacity, requiredInstanceCount } from '@/lib/renderInstanceBudget'
import { createBoxMaterial } from '@nuan5-pro/render'
import {
  ALIGN_REFERENCE_ITEM_COLOR,
  convertColorToHex,
  DEFAULT_ITEM_COLOR,
  HOVER_ITEM_COLOR,
  SELECTED_ITEM_COLOR,
} from './shared/interactionColors'
import {
  buildSlidePathSegmentLocalMatrix,
  getSlidePathScenePoints,
  isSlidePathItem,
  shouldRenderAsSlidePath,
  SLIDE_PATH_GAME_ID,
  withSlidePathWorldPoint,
} from '@/lib/slidePath'
import type { AppItem } from '@/types/editor'
import type { InteractionAdapter, RaycastHit, RegionCenterCandidate } from './types'

const POINT_RADIUS = 90
const SEGMENT_OPACITY = 0.9
const POINT_OPACITY = 0.9
// 未选中/未 hover 的节点颜色（浅灰）
const DEFAULT_POINT_COLOR = 0xcbd5e1
// 当前正在编辑的节点颜色（橙色），与侧边栏的 activeSlidePathPoint 联动
const ACTIVE_POINT_COLOR = 0xfb923c

interface SegmentEntry {
  internalId: string
  segmentIndex: number
}

interface PointEntry {
  internalId: string
  pointIndex: number
}

interface PointPreview {
  itemId: string
  pointIndex: number
  worldPoint: Vector3
}

// 初始化 InstancedMesh 的颜色属性 buffer，容量不足时由 ensure*MeshPool 重建
function initializeInstanceColors(mesh: InstancedMesh, capacity: number) {
  const colors = new Float32Array(Math.max(1, capacity) * 3)
  colors.fill(1)
  mesh.instanceColor = new InstancedBufferAttribute(colors, 3)
  mesh.instanceColor.setUsage(DynamicDrawUsage)
}

// 飞花道专用渲染器：独立于标准 instanced renderer，用 segment mesh + point mesh 渲染路径
// 原因：飞花道没有标准家具模型和体型数据，标准 renderer 会 fallback 为白色方块
export function useSlidePathRenderer() {
  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const { getGroupColor } = useEditorGroups()

  const segmentGeometry = markRaw(new BoxGeometry(1, 1, 1))
  const pointGeometry = markRaw(new SphereGeometry(1, 16, 12))
  const segmentMaterial = markRaw(createBoxMaterial(SEGMENT_OPACITY))
  const pointMaterial = markRaw(
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: POINT_OPACITY,
      depthTest: true,
      depthWrite: true,
    })
  )

  const segmentMesh = ref<InstancedMesh | null>(null)
  const pointMesh = ref<InstancedMesh | null>(null)

  let segmentIndexMap = new Map<number, SegmentEntry>()
  let pointIndexMap = new Map<number, PointEntry>()
  let itemPreviewMatrices = new Map<string, Matrix4>()
  let pointPreview: PointPreview | null = null
  let hoveredHit: RaycastHit | null = null
  let isDisposed = false

  const scratchMatrix = new Matrix4()
  const scratchPointMatrix = new Matrix4()
  const scratchQuaternion = new Quaternion()
  const scratchScale = new Vector3()
  const scratchColor = new Color()
  const scratchWorldMatrix = new Matrix4()
  const scratchWorldPoint = new Vector3()
  const scratchCameraForward = new Vector3()
  const scratchCameraDelta = new Vector3()
  const scratchScreenPoint = { x: 0, y: 0 }

  // 按需扩容 segment instanced mesh，容量不够时销毁旧 mesh 并创建新的
  // renderOrder=999 让 segment 在标准 renderer（0-998）之后、point（1001）之前绘制
  function ensureSegmentMeshPool(requiredInstances: number) {
    const current = segmentMesh.value?.instanceMatrix.count ?? 0
    const targetPool = nextInstancedPoolCapacity(requiredInstances, current)
    if (segmentMesh.value && current >= targetPool) return

    const mesh = new InstancedMesh(segmentGeometry, segmentMaterial, targetPool)
    mesh.frustumCulled = false
    mesh.renderOrder = 999
    mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    initializeInstanceColors(mesh, targetPool)
    mesh.count = 0
    segmentMesh.value = markRaw(mesh)
  }

  // 按需扩容 point instanced mesh，renderOrder=1001 确保节点始终绘制在最上层
  function ensurePointMeshPool(requiredInstances: number) {
    const current = pointMesh.value?.instanceMatrix.count ?? 0
    const targetPool = nextInstancedPoolCapacity(requiredInstances, current)
    if (pointMesh.value && current >= targetPool) return

    const mesh = new InstancedMesh(pointGeometry, pointMaterial, targetPool)
    mesh.frustumCulled = false
    mesh.renderOrder = 1001
    mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    initializeInstanceColors(mesh, targetPool)
    mesh.count = 0
    pointMesh.value = markRaw(mesh)
  }

  // 合并 Gizmo 拖拽预览矩阵和节点编辑预览，返回"当前应该渲染的样子"
  // 拖拽时物品整体位移用 itemPreviewMatrices，单节点编辑用 pointPreview
  function getPreviewItem(item: AppItem): AppItem {
    let nextItem = item
    const previewMatrix = itemPreviewMatrices.get(item.internalId)

    if (previewMatrix) {
      const data = matrixTransform.extractItemDataFromWorldMatrix(previewMatrix)
      nextItem = {
        ...nextItem,
        x: data.x,
        y: data.y,
        z: data.z,
        rotation: data.rotation,
      }
    }

    if (pointPreview?.itemId === item.internalId) {
      nextItem =
        withSlidePathWorldPoint(nextItem, pointPreview.pointIndex, pointPreview.worldPoint) ??
        nextItem
    }

    return nextItem
  }

  // 获取 segment 颜色，优先级：hover > 参照物 > 侧边栏 hover > 选中 > 分组 > 默认
  function getItemColor(item: AppItem): number {
    const selectedIds = editorStore.activeScheme?.selectedItemIds.value ?? new Set<string>()
    if (hoveredHit?.internalId === item.internalId) return HOVER_ITEM_COLOR
    if (uiStore.alignReferenceItemId === item.internalId) return ALIGN_REFERENCE_ITEM_COLOR
    if (uiStore.sidebarHoveredGameId === SLIDE_PATH_GAME_ID && selectedIds.has(item.internalId)) {
      return HOVER_ITEM_COLOR
    }
    if (selectedIds.has(item.internalId)) return SELECTED_ITEM_COLOR
    if (item.groupId > 0) return convertColorToHex(getGroupColor(item.groupId))
    return DEFAULT_ITEM_COLOR
  }

  // 节点颜色：正在编辑的节点用橙色，否则继承 segment 颜色或用默认浅灰
  function getPointColor(item: AppItem, pointIndex: number): number {
    const itemColor = getItemColor(item)
    const activePoint = uiStore.activeSlidePathPoint
    if (activePoint?.itemId === item.internalId && activePoint.pointIndex === pointIndex) {
      return ACTIVE_POINT_COLOR
    }
    if (itemColor !== DEFAULT_ITEM_COLOR) return itemColor
    return DEFAULT_POINT_COLOR
  }

  // 全量重建：遍历所有飞花道物品，计算 segment/point 数量，分配 mesh pool，逐实例写入 matrix 和 color
  function rebuild() {
    if (isDisposed) return

    const items = selectRenderItems(
      editorStore.activeScheme?.items.value ?? [],
      editorStore.localEditingItemIds ?? null
    ).filter(shouldRenderAsSlidePath)
    let requiredSegments = 0
    let requiredPoints = 0
    for (const item of items) {
      const pointCount = getSlidePathScenePoints(getPreviewItem(item)).length
      requiredPoints += pointCount
      requiredSegments += Math.max(0, pointCount - 1)
    }

    const segmentCount = requiredInstanceCount(requiredSegments)
    const pointCount = requiredInstanceCount(requiredPoints)
    ensureSegmentMeshPool(segmentCount)
    ensurePointMeshPool(pointCount)

    const currentSegmentMesh = segmentMesh.value
    const currentPointMesh = pointMesh.value
    if (!currentSegmentMesh || !currentPointMesh) return

    segmentIndexMap = new Map()
    pointIndexMap = new Map()
    currentSegmentMesh.count = 0
    currentPointMesh.count = 0

    let segmentRenderIndex = 0
    let pointRenderIndex = 0

    for (const item of items) {
      const renderItem = getPreviewItem(item)
      const points = getSlidePathScenePoints(renderItem)

      for (
        let pointIndex = 0;
        pointIndex < points.length && pointRenderIndex < pointCount;
        pointIndex++
      ) {
        const point = points[pointIndex]!
        scratchScale.set(POINT_RADIUS, POINT_RADIUS, POINT_RADIUS)
        scratchPointMatrix.compose(point, scratchQuaternion.identity(), scratchScale)
        currentPointMesh.setMatrixAt(pointRenderIndex, scratchPointMatrix)
        scratchColor.setHex(getPointColor(item, pointIndex))
        currentPointMesh.setColorAt(pointRenderIndex, scratchColor)
        pointIndexMap.set(pointRenderIndex, { internalId: item.internalId, pointIndex })
        pointRenderIndex++
      }

      for (
        let segmentIndex = 0;
        segmentIndex < points.length - 1 && segmentRenderIndex < segmentCount;
        segmentIndex++
      ) {
        const matrix = buildSlidePathSegmentLocalMatrix(
          points[segmentIndex]!,
          points[segmentIndex + 1]!,
          scratchMatrix
        )
        if (!matrix) continue

        currentSegmentMesh.setMatrixAt(segmentRenderIndex, matrix)
        scratchColor.setHex(getItemColor(item))
        currentSegmentMesh.setColorAt(segmentRenderIndex, scratchColor)
        segmentIndexMap.set(segmentRenderIndex, { internalId: item.internalId, segmentIndex })
        segmentRenderIndex++
      }
    }

    currentSegmentMesh.count = segmentRenderIndex
    currentPointMesh.count = pointRenderIndex
    currentSegmentMesh.instanceMatrix.needsUpdate = true
    currentPointMesh.instanceMatrix.needsUpdate = true
    if (currentSegmentMesh.instanceColor) currentSegmentMesh.instanceColor.needsUpdate = true
    if (currentPointMesh.instanceColor) currentPointMesh.instanceColor.needsUpdate = true

    invalidateScene()
  }

  // 仅更新颜色：选中/hover/sidebar-hover 状态变化时调用，避免全量重建 matrix
  function updateAllColors() {
    if (isDisposed) return

    const itemsMap = editorStore.itemsMap
    const currentSegmentMesh = segmentMesh.value
    const currentPointMesh = pointMesh.value

    if (currentSegmentMesh) {
      for (const [instanceId, entry] of segmentIndexMap.entries()) {
        if (instanceId >= currentSegmentMesh.count) continue
        const item = itemsMap.get(entry.internalId)
        if (!item) continue

        scratchColor.setHex(getItemColor(item))
        currentSegmentMesh.setColorAt(instanceId, scratchColor)
      }
      if (currentSegmentMesh.instanceColor) currentSegmentMesh.instanceColor.needsUpdate = true
    }

    if (currentPointMesh) {
      for (const [instanceId, entry] of pointIndexMap.entries()) {
        if (instanceId >= currentPointMesh.count) continue
        const item = itemsMap.get(entry.internalId)
        if (!item) continue

        scratchColor.setHex(getPointColor(item, entry.pointIndex))
        currentPointMesh.setColorAt(instanceId, scratchColor)
      }
      if (currentPointMesh.instanceColor) currentPointMesh.instanceColor.needsUpdate = true
    }

    invalidateScene()
  }

  // 对单个 instanced mesh 做 raycast，返回最近命中的实例信息
  function findClosestHit(
    raycaster: Raycaster,
    mesh: InstancedMesh | null,
    indexMap: Map<number, SegmentEntry | PointEntry>,
    kind: 'slide-path-segment' | 'slide-path-point'
  ): RaycastHit | null {
    if (!mesh || mesh.count === 0) return null

    mesh.updateWorldMatrix(true, false)
    const intersects = raycaster.intersectObject(mesh, false)
    for (const hit of intersects) {
      if (hit.instanceId === undefined) continue
      const entry = indexMap.get(hit.instanceId)
      if (!entry) continue

      return {
        instanceId: hit.instanceId,
        internalId: entry.internalId,
        distance: hit.distance,
        kind,
        pointIndex: 'pointIndex' in entry ? entry.pointIndex : undefined,
      }
    }

    return null
  }

  // pick 优先命中节点（用户更可能想编辑节点），其次命中 segment
  function pick(raycaster: Raycaster): RaycastHit | null {
    const pointHit = findClosestHit(raycaster, pointMesh.value, pointIndexMap, 'slide-path-point')
    if (pointHit) return pointHit
    return findClosestHit(raycaster, segmentMesh.value, segmentIndexMap, 'slide-path-segment')
  }

  // 将 instanced mesh 的实例中心投影到屏幕坐标，用于框选/套索的 hit test
  // 返回 false 表示实例在相机背面或投影失败
  function projectInstanceCenter(
    mesh: InstancedMesh,
    instanceId: number,
    camera: Camera,
    viewport: { width: number; height: number }
  ): boolean {
    mesh.getMatrixAt(instanceId, scratchMatrix)
    scratchWorldMatrix.multiplyMatrices(mesh.matrixWorld, scratchMatrix)
    scratchWorldPoint.set(0, 0, 0).applyMatrix4(scratchWorldMatrix)

    camera.getWorldDirection(scratchCameraForward)
    scratchCameraDelta.subVectors(scratchWorldPoint, camera.position)
    if (scratchCameraDelta.dot(scratchCameraForward) <= 0) return false

    scratchWorldPoint.project(camera)
    if (!Number.isFinite(scratchWorldPoint.x) || !Number.isFinite(scratchWorldPoint.y)) {
      return false
    }

    scratchScreenPoint.x = (scratchWorldPoint.x + 1) * 0.5 * viewport.width
    scratchScreenPoint.y = (-scratchWorldPoint.y + 1) * 0.5 * viewport.height
    return true
  }

  // 遍历 mesh 所有实例，将屏幕中心点交给 visitor 回调，由 selection 判断是否在选区内
  function visitRegionCandidates(
    mesh: InstancedMesh | null,
    indexMap: Map<number, SegmentEntry | PointEntry>,
    camera: Camera,
    viewport: { width: number; height: number },
    seenIds: Set<string>,
    visitor: (candidate: RegionCenterCandidate) => void
  ) {
    if (!mesh || mesh.count === 0) return
    mesh.updateWorldMatrix(true, false)

    for (let instanceId = 0; instanceId < mesh.count; instanceId++) {
      const entry = indexMap.get(instanceId)
      if (!entry || seenIds.has(entry.internalId)) continue
      if (!projectInstanceCenter(mesh, instanceId, camera, viewport)) continue

      seenIds.add(entry.internalId)
      visitor({ internalId: entry.internalId, center: scratchScreenPoint })
    }
  }

  const interactionAdapter = computed<InteractionAdapter>(() => ({
    pick,
    pickAsync: async (raycaster) => pick(raycaster),
    cancelPick: () => {},
    forEachRegionCenterCandidate: (camera, viewport, visitor) => {
      const seenIds = new Set<string>()
      visitRegionCandidates(pointMesh.value, pointIndexMap, camera, viewport, seenIds, visitor)
      visitRegionCandidates(segmentMesh.value, segmentIndexMap, camera, viewport, seenIds, visitor)
    },
  }))

  // hover 状态变化时更新颜色，相同 hit 不重复刷新
  function setHoveredHit(hit: RaycastHit | null) {
    const same =
      hoveredHit?.internalId === hit?.internalId &&
      hoveredHit?.kind === hit?.kind &&
      hoveredHit?.pointIndex === hit?.pointIndex
    if (same) return

    hoveredHit = hit ? { ...hit } : null
    updateAllColors()
  }

  // Gizmo 拖拽时接收所有物品的新矩阵，过滤出飞花道物品后触发重建
  function updateItemWorldMatrices(idToWorldMatrixMap: Map<string, Matrix4>) {
    const nextMap = new Map<string, Matrix4>()
    for (const [id, matrix] of idToWorldMatrixMap.entries()) {
      const item = editorStore.itemsMap.get(id)
      if (isSlidePathItem(item)) {
        nextMap.set(id, matrix.clone())
      }
    }

    if (nextMap.size === 0 && itemPreviewMatrices.size === 0) return
    itemPreviewMatrices = nextMap
    rebuild()
  }

  // 单节点编辑预览：Gizmo 拖拽过程中实时更新节点位置，松手后由 withSlidePathWorldPoint 写回
  function previewPoint(itemId: string, pointIndex: number, worldPoint: Vector3) {
    pointPreview = { itemId, pointIndex, worldPoint: worldPoint.clone() }
    rebuild()
  }

  // 拖拽结束或切换选区时清除预览状态，恢复到持久化数据
  function clearPreview() {
    if (itemPreviewMatrices.size === 0 && !pointPreview) return
    itemPreviewMatrices = new Map()
    pointPreview = null
    rebuild()
  }

  // 方案切换或场景变更时全量重建；选区/sidebar hover/参照物变化时只刷颜色
  watch(
    [
      () => editorStore.activeSchemeId,
      () => editorStore.sceneVersion,
      () => editorStore.localEditingItemIds,
    ],
    () => {
      hoveredHit = null
      rebuild()
    },
    {
      flush: 'sync',
      immediate: true,
    }
  )

  watch(
    [
      () => editorStore.selectionVersion,
      () => uiStore.activeSlidePathPoint,
      () => uiStore.sidebarHoveredGameId,
      () => uiStore.alignReferenceItemId,
    ],
    () => updateAllColors()
  )

  onUnmounted(() => {
    isDisposed = true
    segmentMesh.value = null
    pointMesh.value = null
    segmentGeometry.dispose()
    pointGeometry.dispose()
    segmentMaterial.dispose()
    pointMaterial.dispose()
  })

  return {
    segmentMesh,
    pointMesh,
    interactionAdapter,
    setHoveredHit,
    updateItemWorldMatrices,
    previewPoint,
    clearPreview,
  }
}

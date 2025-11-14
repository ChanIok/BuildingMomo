import { ref, watch, markRaw, type Ref } from 'vue'
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  EdgesGeometry,
  Euler,
  InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { AppItem } from '@/types/editor'
import { coordinates3D } from '@/lib/coordinates'

const MAX_INSTANCES = 10000

const BASE_BOX_SIZE = {
  width: 100,
  height: 150,
  depth: 100,
} as const

export function useThreeInstancedRenderer(
  editorStore: ReturnType<typeof useEditorStore>,
  isTransformDragging?: Ref<boolean>
) {
  const baseGeometry = new BoxGeometry(1, 1, 1)
  const material = new MeshStandardMaterial({
    transparent: true,
    opacity: 0.7,
  })

  const instancedMesh = ref<InstancedMesh | null>(null)
  const edgesInstancedMesh = ref<InstancedMesh | null>(null)

  const indexToIdMap = ref(new Map<number, string>())
  const idToIndexMap = ref(new Map<string, number>())

  // 初始化主体实例
  const mesh = new InstancedMesh(baseGeometry, material, MAX_INSTANCES)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0

  instancedMesh.value = markRaw(mesh)

  // 初始化边框实例
  const edgesGeometry = new EdgesGeometry(baseGeometry)
  const lineMaterial = new LineBasicMaterial({
    color: 0x000000,
    opacity: 0.3,
    transparent: true,
  })

  const edgesMesh = new InstancedMesh(edgesGeometry, lineMaterial, MAX_INSTANCES)
  edgesMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  edgesMesh.count = 0

  edgesInstancedMesh.value = markRaw(edgesMesh)

  const scratchMatrix = markRaw(new Matrix4())
  const scratchPosition = markRaw(new Vector3())
  const scratchEuler = markRaw(new Euler())
  const scratchQuaternion = markRaw(new Quaternion())
  const scratchScale = markRaw(new Vector3())
  const scratchColor = markRaw(new Color())

  function convertColorToHex(colorStr: string | undefined): number {
    if (!colorStr) return 0x94a3b8
    const matches = colorStr.match(/\d+/g)
    if (!matches || matches.length < 3) return 0x94a3b8
    const r = parseInt(matches[0] ?? '148', 10)
    const g = parseInt(matches[1] ?? '163', 10)
    const b = parseInt(matches[2] ?? '184', 10)
    return (r << 16) | (g << 8) | b
  }

  function getItemColor(item: AppItem): number {
    if (editorStore.selectedItemIds.has(item.internalId)) {
      return 0x3b82f6
    }

    const groupId = item.originalData.GroupID
    if (groupId > 0) {
      return convertColorToHex(editorStore.getGroupColor(groupId))
    }

    return 0x94a3b8
  }

  // 仅更新实例颜色（用于选中状态变化时的轻量刷新）
  function updateInstancesColor() {
    const meshTarget = instancedMesh.value
    if (!meshTarget) return

    const items = editorStore.visibleItems
    const map = indexToIdMap.value

    if (!map || map.size === 0) return

    const itemById = new Map<string, AppItem>()
    for (const item of items) {
      itemById.set(item.internalId, item)
    }

    for (const [index, id] of map.entries()) {
      const item = itemById.get(id)
      if (!item) continue

      const colorHex = getItemColor(item)
      scratchColor.setHex(colorHex)
      meshTarget.setColorAt(index, scratchColor)
    }

    if (meshTarget.instanceColor) {
      meshTarget.instanceColor.needsUpdate = true
    }
  }

  // 完整重建实例几何和索引映射（用于物品集合变化时）
  function rebuildInstances() {
    const meshTarget = instancedMesh.value
    const edgeTarget = edgesInstancedMesh.value
    if (!meshTarget || !edgeTarget) return

    const items = editorStore.visibleItems
    const instanceCount = Math.min(items.length, MAX_INSTANCES)
    if (items.length > MAX_INSTANCES) {
      console.warn(
        `[ThreeInstancedRenderer] 当前可见物品数量 (${items.length}) 超过上限 ${MAX_INSTANCES}，仅渲染前 ${MAX_INSTANCES} 个`
      )
    }

    meshTarget.count = instanceCount
    edgeTarget.count = instanceCount

    const map = new Map<number, string>()

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) {
        continue
      }
      map.set(index, item.internalId)

      coordinates3D.setThreeFromGame(scratchPosition, { x: item.x, y: item.y, z: item.z })

      const { Rotation, Scale } = item.originalData
      scratchEuler.set(
        (Rotation.Roll * Math.PI) / 180,
        (Rotation.Pitch * Math.PI) / 180,
        (Rotation.Yaw * Math.PI) / 180,
        'XYZ'
      )
      scratchQuaternion.setFromEuler(scratchEuler)

      scratchScale.set(
        (Scale.X || 1) * BASE_BOX_SIZE.width,
        (Scale.Z || 1) * BASE_BOX_SIZE.height,
        (Scale.Y || 1) * BASE_BOX_SIZE.depth
      )

      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)

      meshTarget.setMatrixAt(index, scratchMatrix)
      edgeTarget.setMatrixAt(index, scratchMatrix)
    }

    meshTarget.instanceMatrix.needsUpdate = true
    edgeTarget.instanceMatrix.needsUpdate = true

    indexToIdMap.value = map
    // 同时维护反向映射
    const reverseMap = new Map<string, number>()
    for (const [index, id] of map.entries()) {
      reverseMap.set(id, index)
    }
    idToIndexMap.value = reverseMap

    // 几何更新后刷新一次颜色，确保选中高亮正确
    updateInstancesColor()
  }

  // 局部更新选中物品的矩阵（用于拖拽时的视觉更新）
  function updateSelectedInstancesMatrix(selectedIds: Set<string>, deltaPosition: Vector3) {
    const meshTarget = instancedMesh.value
    const edgeTarget = edgesInstancedMesh.value
    if (!meshTarget || !edgeTarget) {
      return
    }

    const reverseMap = idToIndexMap.value

    for (const id of selectedIds) {
      const index = reverseMap.get(id)
      if (index === undefined) continue

      // 读取当前矩阵
      meshTarget.getMatrixAt(index, scratchMatrix)

      // 分解矩阵
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)

      // 应用位置增量
      scratchPosition.add(deltaPosition)

      // 重新组合矩阵
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)

      // 更新两个实例
      meshTarget.setMatrixAt(index, scratchMatrix)
      edgeTarget.setMatrixAt(index, scratchMatrix)
    }

    // 只标记矩阵需要更新，不触发颜色更新
    meshTarget.instanceMatrix.needsUpdate = true
    edgeTarget.instanceMatrix.needsUpdate = true
  }

  // 物品集合变化时重建实例；选中状态变化时仅刷新颜色
  watch(
    () => editorStore.visibleItems,
    () => {
      // 拖拽时不触发全量更新，由 handleGizmoChange 直接更新实例矩阵
      if (isTransformDragging?.value) {
        return
      }

      rebuildInstances()
    },
    { deep: true, immediate: true }
  )

  watch(
    () => editorStore.selectedItemIds.size,
    () => {
      if (isTransformDragging?.value) {
        return
      }

      updateInstancesColor()
    }
  )

  return {
    instancedMesh,
    edgesInstancedMesh,
    indexToIdMap,
    idToIndexMap,
    updateSelectedInstancesMatrix,
  }
}

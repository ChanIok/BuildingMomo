import { ref, watch, markRaw, type Ref } from 'vue'
import {
  BoxGeometry,
  PlaneGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { AppItem } from '@/types/editor'
import { coordinates3D } from '@/lib/coordinates'
import type { useFurnitureStore } from '@/stores/furnitureStore'
import { getThreeIconTextureManager } from './useThreeIconTextureManager'

const MAX_INSTANCES = 10000

// 当缺少尺寸信息时使用的默认尺寸（游戏坐标：X=长, Y=宽, Z=高）
const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

export function useThreeInstancedRenderer(
  editorStore: ReturnType<typeof useEditorStore>,
  furnitureStore: ReturnType<typeof useFurnitureStore>,
  isTransformDragging?: Ref<boolean>
) {
  // === Box 模式（原有） ===
  const baseGeometry = new BoxGeometry(1, 1, 1)
  const material = new MeshStandardMaterial({
    transparent: true,
    opacity: 0.7,
  })

  const instancedMesh = ref<InstancedMesh | null>(null)

  const indexToIdMap = ref(new Map<number, string>())
  const idToIndexMap = ref(new Map<string, number>())

  // 当前 hover 的物品（仅 3D 视图内部使用，不改变全局选中状态）
  const hoveredItemId = ref<string | null>(null)

  // 初始化 Box 实例
  const mesh = new InstancedMesh(baseGeometry, material, MAX_INSTANCES)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0

  instancedMesh.value = markRaw(mesh)

  // === Icon 模式（新增） ===
  const planeGeometry = new PlaneGeometry(180, 180) // 固定大小：180x180 游戏单位
  const textureManager = getThreeIconTextureManager()
  const placeholderTexture = textureManager.createPlaceholderTexture()

  const iconMaterial = new MeshBasicMaterial({
    map: placeholderTexture,
    transparent: true,
    alphaTest: 0.5, // 半透明像素阈值
    depthWrite: true, // 启用深度写入，确保正确的前后遮挡关系
    depthTest: true, // 启用深度测试
  })

  const iconInstancedMesh = ref<InstancedMesh | null>(null)

  // Icon 模式使用相同的索引映射（与 Box 模式共享）

  // 初始化 Icon 实例
  const iconMesh = new InstancedMesh(planeGeometry, iconMaterial, MAX_INSTANCES)
  iconMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  iconMesh.count = 0

  iconInstancedMesh.value = markRaw(iconMesh)

  // 存储当前的图标朝向（默认朝上，适配默认视图）
  const currentIconNormal = ref<[number, number, number]>([0, 1, 0])
  // 存储当前的图标 up 向量（用于约束旋转，防止绕法线旋转）
  const currentIconUp = ref<[number, number, number] | null>(null)

  const scratchMatrix = markRaw(new Matrix4())
  const scratchPosition = markRaw(new Vector3())
  const scratchEuler = markRaw(new Euler())
  const scratchQuaternion = markRaw(new Quaternion())
  const scratchScale = markRaw(new Vector3())
  const scratchColor = markRaw(new Color())
  const scratchTmpVec3 = markRaw(new Vector3(0, 0, 1))
  const scratchDefaultNormal = markRaw(new Vector3(0, 0, 1))
  const scratchUpVec3 = markRaw(new Vector3(0, 1, 0))
  const scratchLookAtTarget = markRaw(new Vector3())

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
    // hover 高亮优先级最高（即使物品已被选中，hover 时也显示为橙色）
    if (hoveredItemId.value === item.internalId) {
      return 0xf97316
    }

    // 其次是选中高亮
    if (editorStore.selectedItemIds.has(item.internalId)) {
      return 0x3b82f6
    }

    const groupId = item.originalData.GroupID
    if (groupId > 0) {
      return convertColorToHex(editorStore.getGroupColor(groupId))
    }

    return 0x94a3b8
  }

  // 仅更新实例颜色（用于选中状态变化或 hover 变化时的刷新）
  function updateInstancesColor() {
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    if (!meshTarget || !iconMeshTarget) return

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

      // 同时更新两个 mesh 的颜色
      meshTarget.setColorAt(index, scratchColor)
      iconMeshTarget.setColorAt(index, scratchColor)
    }

    // 同时标记两个 mesh 的颜色需要更新
    if (meshTarget.instanceColor) {
      meshTarget.instanceColor.needsUpdate = true
    }
    if (iconMeshTarget.instanceColor) {
      iconMeshTarget.instanceColor.needsUpdate = true
    }
  }

  // 局部更新单个物品的颜色（用于 hover 状态变化）
  function updateInstanceColorById(id: string) {
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    if (!meshTarget || !iconMeshTarget) return

    const index = idToIndexMap.value.get(id)
    if (index === undefined) return

    const item = editorStore.visibleItems.find((it) => it.internalId === id)
    if (!item) return

    const colorHex = getItemColor(item)
    scratchColor.setHex(colorHex)

    // 同时更新两个 mesh
    meshTarget.setColorAt(index, scratchColor)
    iconMeshTarget.setColorAt(index, scratchColor)

    if (meshTarget.instanceColor) {
      meshTarget.instanceColor.needsUpdate = true
    }
    if (iconMeshTarget.instanceColor) {
      iconMeshTarget.instanceColor.needsUpdate = true
    }
  }

  // 设置 hover 物品并局部刷新对应实例颜色
  function setHoveredItemId(id: string | null) {
    const prevId = hoveredItemId.value
    hoveredItemId.value = id

    // 先恢复上一个 hover 的颜色，再应用新的 hover 颜色
    if (prevId && prevId !== id) {
      updateInstanceColorById(prevId)
    }

    if (id) {
      updateInstanceColorById(id)
    }
  }

  // 完整重建实例几何和索引映射（用于物品集合变化时）
  function rebuildInstances() {
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    if (!meshTarget || !iconMeshTarget) return

    const items = editorStore.visibleItems
    const instanceCount = Math.min(items.length, MAX_INSTANCES)

    if (items.length > MAX_INSTANCES) {
      console.warn(
        `[ThreeInstancedRenderer] 当前可见物品数量 (${items.length}) 超过上限 ${MAX_INSTANCES}，仅渲染前 ${MAX_INSTANCES} 个`
      )
    }

    // 同时更新两个 mesh 的实例数量
    meshTarget.count = instanceCount
    iconMeshTarget.count = instanceCount

    const map = new Map<number, string>()

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) {
        continue
      }
      map.set(index, item.internalId)

      coordinates3D.setThreeFromGame(scratchPosition, { x: item.x, y: item.y, z: item.z })

      const { Rotation, Scale } = item.originalData

      // === Box 模式：使用真实的旋转和尺寸 ===
      // 旋转轴从游戏坐标系映射到 Three.js：
      // 游戏 Roll(X) -> Three.js X
      // 游戏 Yaw(Z，高度轴) -> Three.js Y
      // 游戏 Pitch(Y，前后轴) -> Three.js Z
      scratchEuler.set(
        (Rotation.Roll * Math.PI) / 180,
        (Rotation.Yaw * Math.PI) / 180,
        (Rotation.Pitch * Math.PI) / 180,
        'XYZ'
      )
      scratchQuaternion.setFromEuler(scratchEuler)

      // 从家具元数据获取真实尺寸（游戏坐标：X=长, Y=宽, Z=高）
      const furnitureSize = furnitureStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      const [sizeX, sizeY, sizeZ] = furnitureSize

      // 应用游戏内缩放并映射到 Three.js 坐标系：
      // 游戏 X -> Three.js X，游戏 Z(高度) -> Three.js Y，游戏 Y -> Three.js Z
      scratchScale.set((Scale.X || 1) * sizeX, (Scale.Z || 1) * sizeZ, (Scale.Y || 1) * sizeY)

      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      meshTarget.setMatrixAt(index, scratchMatrix)

      // === Icon 模式：固定大小，使用当前视图的正确朝向和 up 向量 ===
      // 位置相同，但使用固定尺寸和当前的朝向
      scratchTmpVec3
        .set(currentIconNormal.value[0], currentIconNormal.value[1], currentIconNormal.value[2])
        .normalize()

      // 如果有 up 向量约束，使用 lookAt 方法；否则使用 setFromUnitVectors
      if (currentIconUp.value) {
        scratchUpVec3
          .set(currentIconUp.value[0], currentIconUp.value[1], currentIconUp.value[2])
          .normalize()
        scratchLookAtTarget.set(-scratchTmpVec3.x, -scratchTmpVec3.y, -scratchTmpVec3.z)
        scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)
        scratchQuaternion.setFromRotationMatrix(scratchMatrix)
      } else {
        // 计算从 PlaneGeometry 的默认法线 (+Z) 到目标法线的旋转
        scratchQuaternion.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
      }

      scratchScale.set(1, 1, 1) // 使用 PlaneGeometry 的原始尺寸 (180x180)

      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      iconMeshTarget.setMatrixAt(index, scratchMatrix)
    }

    // 同时更新两个 mesh 的矩阵
    meshTarget.instanceMatrix.needsUpdate = true
    iconMeshTarget.instanceMatrix.needsUpdate = true

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
    const iconMeshTarget = iconInstancedMesh.value
    if (!meshTarget || !iconMeshTarget) {
      return
    }

    const reverseMap = idToIndexMap.value

    for (const id of selectedIds) {
      const index = reverseMap.get(id)
      if (index === undefined) continue

      // === 更新 Box mesh ===
      // 读取当前矩阵
      meshTarget.getMatrixAt(index, scratchMatrix)

      // 分解矩阵
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)

      // 应用位置增量
      scratchPosition.add(deltaPosition)

      // 重新组合矩阵
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)

      // 更新实例
      meshTarget.setMatrixAt(index, scratchMatrix)

      // === 更新 Icon mesh ===
      // Icon mesh 只需更新位置，不改变旋转和缩放
      iconMeshTarget.getMatrixAt(index, scratchMatrix)
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)
      scratchPosition.add(deltaPosition)
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      iconMeshTarget.setMatrixAt(index, scratchMatrix)
    }

    // 同时标记两个 mesh 的矩阵需要更新
    meshTarget.instanceMatrix.needsUpdate = true
    iconMeshTarget.instanceMatrix.needsUpdate = true
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

  // 更新 Icon 平面朝向（使其法线指向给定方向，同时约束up向量防止绕法线旋转）
  function updateIconFacing(normal: [number, number, number], up?: [number, number, number]) {
    // 归一化输入向量，避免存储大数值
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    const normalized: [number, number, number] =
      len > 0.0001 ? [normal[0] / len, normal[1] / len, normal[2] / len] : [0, 0, 1] // 默认朝向

    // 保存归一化后的朝向和 up 向量，确保 rebuildInstances 时使用相同的旋转逻辑
    currentIconNormal.value = normalized
    currentIconUp.value = up || null

    const iconMeshTarget = iconInstancedMesh.value
    if (!iconMeshTarget) return

    const targetQuaternion = markRaw(new Quaternion())

    if (up) {
      // 如果提供了 up 向量，使用 lookAt 方法计算旋转（确保图标边缘平行于屏幕）
      // 构建一个临时的旋转矩阵：Z轴指向法线方向，Y轴尽量对齐up向量
      scratchTmpVec3.set(normalized[0], normalized[1], normalized[2])
      scratchUpVec3.set(up[0], up[1], up[2]).normalize()

      // 使用 Matrix4 的 lookAt 方法：从原点看向法线方向，up 向量约束旋转
      // 注意：lookAt 会让物体的 -Z 轴指向目标，但我们的平面默认法线是 +Z
      // 所以需要先 lookAt 反方向，然后旋转 180 度
      scratchLookAtTarget.set(-normalized[0], -normalized[1], -normalized[2])
      scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)

      // 提取旋转四元数
      targetQuaternion.setFromRotationMatrix(scratchMatrix)
    } else {
      // 如果没有提供 up 向量，使用原有的 setFromUnitVectors 方法（可能产生旋转）
      scratchTmpVec3.set(normalized[0], normalized[1], normalized[2])
      targetQuaternion.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
    }

    const count = iconMeshTarget.count

    for (let index = 0; index < count; index++) {
      // 读取现有矩阵，保留位置和缩放
      iconMeshTarget.getMatrixAt(index, scratchMatrix)
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)

      // 应用新朝向
      scratchMatrix.compose(scratchPosition, targetQuaternion, scratchScale)
      iconMeshTarget.setMatrixAt(index, scratchMatrix)
    }

    iconMeshTarget.instanceMatrix.needsUpdate = true
  }

  watch(
    () => Array.from(editorStore.selectedItemIds),
    () => {
      if (isTransformDragging?.value) {
        return
      }

      updateInstancesColor()
    }
  )

  return {
    instancedMesh,
    iconInstancedMesh,
    indexToIdMap,
    idToIndexMap,
    updateSelectedInstancesMatrix,
    setHoveredItemId,
    updateIconFacing,
  }
}

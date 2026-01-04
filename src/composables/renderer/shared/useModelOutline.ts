import { ref, computed, markRaw } from 'vue'
import {
  InstancedMesh,
  MeshBasicMaterial,
  BackSide,
  Vector3,
  DynamicDrawUsage,
  Sphere,
} from 'three'
import {
  scratchMatrix,
  scratchPosition,
  scratchQuaternion,
  scratchScale,
  scratchColor,
} from './scratchObjects'

/**
 * Model 模式描边高亮管理
 *
 * 为每个模型类型创建对应的描边 InstancedMesh，
 * 根据选中/hover 状态动态更新描边实例。
 */
export function useModelOutline() {
  // itemId -> 描边 InstancedMesh
  const outlineMeshMap = ref(new Map<number, InstancedMesh>())

  // 创建共享材质（使用与现有模式统一的配色）
  const selectedMaterial = markRaw(
    new MeshBasicMaterial({
      color: 0x60a5fa, // 蓝色（选中）- 与 Box/Icon 模式一致
      side: BackSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: true,
    })
  )

  const hoverMaterial = markRaw(
    new MeshBasicMaterial({
      color: 0xf59e0b, // 琥珀色（hover）- 与 Box/Icon 模式一致
      side: BackSide,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      depthTest: true,
    })
  )

  /**
   * 初始化描边 mesh
   *
   * @param itemId - 家具 ItemID（或 fallbackKey）
   * @param originalMesh - 原始的 InstancedMesh
   * @param maxInstances - 最大实例数
   */
  function initOutlineMesh(
    itemId: number,
    originalMesh: InstancedMesh,
    maxInstances: number
  ): InstancedMesh {
    // 检查是否已存在
    if (outlineMeshMap.value.has(itemId)) {
      return outlineMeshMap.value.get(itemId)!
    }

    // 创建描边 mesh（使用相同的几何体，但不同的材质）
    const outlineMesh = new InstancedMesh(
      originalMesh.geometry,
      selectedMaterial, // 默认使用选中材质（后续通过 instanceColor 区分）
      maxInstances
    )

    // 配置 mesh
    outlineMesh.frustumCulled = false
    outlineMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    outlineMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    outlineMesh.count = 0 // 初始无实例

    // 标记为 raw 避免响应式开销
    const rawMesh = markRaw(outlineMesh)
    outlineMeshMap.value.set(itemId, rawMesh)

    return rawMesh
  }

  /**
   * 更新描边状态（核心函数）
   *
   * @param selectedIds - 当前选中的 internalId 集合
   * @param hoveredId - 当前 hover 的 internalId
   * @param meshMap - 原始 mesh 映射（itemId -> InstancedMesh）
   * @param internalIdToMeshInfo - 反向索引映射（internalId -> { itemId, localIndex }）
   * @param fallbackMesh - 回退 mesh（可选）
   */
  function updateOutlines(
    selectedIds: Set<string>,
    hoveredId: string | null,
    meshMap: Map<number, InstancedMesh>,
    internalIdToMeshInfo: Map<string, { itemId: number; localIndex: number }>,
    fallbackMesh: InstancedMesh | null
  ) {
    // 重置所有描边 mesh 的 count
    for (const outlineMesh of outlineMeshMap.value.values()) {
      outlineMesh.count = 0
    }

    // 为每个 itemId 维护当前的描边实例索引
    const outlineIndexMap = new Map<number, number>()

    // 辅助函数：添加一个描边实例
    function addOutlineInstance(internalId: string, isSelected: boolean) {
      // 使用反向索引快速查找
      const meshInfo = internalIdToMeshInfo.get(internalId)
      if (!meshInfo) return

      const { itemId, localIndex } = meshInfo

      // 获取原始 mesh（可能是 modelMesh 或 fallbackMesh）
      let originalMesh: InstancedMesh | null = null
      if (itemId === -1 && fallbackMesh) {
        // fallbackMesh 使用特殊 itemId -1
        originalMesh = fallbackMesh
      } else {
        originalMesh = meshMap.get(itemId) || null
      }

      if (!originalMesh) return

      const outlineMesh = outlineMeshMap.value.get(itemId)
      if (!outlineMesh) return

      // 获取原始实例的矩阵
      originalMesh.getMatrixAt(localIndex, scratchMatrix)

      // 分解矩阵
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)

      // 放大 5%（形成描边效果）
      scratchScale.multiplyScalar(1.05)

      // 重新组合
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)

      // 获取当前描边 mesh 的下一个可用索引
      const outlineIndex = outlineIndexMap.get(itemId) || 0

      // 设置矩阵
      outlineMesh.setMatrixAt(outlineIndex, scratchMatrix)

      // 设置颜色（选中 vs hover）
      if (isSelected) {
        scratchColor.setHex(0x60a5fa) // 蓝色
      } else {
        scratchColor.setHex(0xf59e0b) // 琥珀色
      }
      outlineMesh.setColorAt(outlineIndex, scratchColor)

      // 更新索引
      outlineIndexMap.set(itemId, outlineIndex + 1)
    }

    // 1. 先添加所有选中的实例
    for (const id of selectedIds) {
      addOutlineInstance(id, true)
    }

    // 2. 如果 hover 的实例不在选中列表中，单独添加
    if (hoveredId && !selectedIds.has(hoveredId)) {
      addOutlineInstance(hoveredId, false)
    }

    // 3. 更新所有描边 mesh 的 count 和标记
    for (const [itemId, outlineMesh] of outlineMeshMap.value.entries()) {
      const count = outlineIndexMap.get(itemId) || 0
      outlineMesh.count = count

      if (count > 0) {
        outlineMesh.instanceMatrix.needsUpdate = true
        if (outlineMesh.instanceColor) {
          outlineMesh.instanceColor.needsUpdate = true
        }
      }
    }
  }

  /**
   * 清理指定模型的描边资源
   */
  function disposeOutlineMesh(itemId: number) {
    const mesh = outlineMeshMap.value.get(itemId)
    if (mesh) {
      // 注意：几何体是共享的，不要 dispose
      // 材质也是共享的，不要 dispose
      mesh.geometry = null as any
      mesh.material = null as any
      outlineMeshMap.value.delete(itemId)
    }
  }

  /**
   * 清理所有资源
   */
  function dispose() {
    for (const [itemId] of outlineMeshMap.value.entries()) {
      disposeOutlineMesh(itemId)
    }
    outlineMeshMap.value.clear()

    // 清理共享材质
    selectedMaterial.dispose()
    hoverMaterial.dispose()
  }

  // 返回所有描边 mesh（用于渲染）
  const outlineMeshes = computed(() => {
    return Array.from(outlineMeshMap.value.values())
  })

  return {
    initOutlineMesh,
    updateOutlines,
    disposeOutlineMesh,
    dispose,
    outlineMeshes,
  }
}

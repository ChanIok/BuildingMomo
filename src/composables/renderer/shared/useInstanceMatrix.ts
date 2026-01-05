import type { InstancedMesh, Matrix4 } from 'three'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  scratchMatrix,
  scratchPosition,
  scratchQuaternion,
  scratchScale,
  scratchTmpVec3,
  scratchDefaultNormal,
  scratchUpVec3,
  scratchLookAtTarget,
} from './scratchObjects'
import { Vector3 as ThreeVector3 } from 'three'

/**
 * 实例矩阵更新
 *
 * 负责更新选中实例的世界矩阵（Gizmo 拖拽时）
 */
export function useInstanceMatrix() {
  const settingsStore = useSettingsStore()

  /**
   * 局部更新选中物品的世界矩阵（用于拖拽时的视觉更新）
   */
  function updateSelectedInstancesMatrix(
    idToWorldMatrixMap: Map<string, Matrix4>,
    mode: string,
    meshTarget: InstancedMesh | null,
    iconMeshTarget: InstancedMesh | null,
    simpleBoxMeshTarget: InstancedMesh | null,
    idToIndexMap: Map<string, number>,
    currentIconNormal: [number, number, number],
    currentIconUp: [number, number, number] | null,
    // Model 模式额外参数
    modelMeshMap?: Map<number, InstancedMesh>,
    internalIdToMeshInfo?: Map<string, { itemId: number; localIndex: number }>,
    fallbackMesh?: InstancedMesh | null
  ) {
    for (const [id, worldMatrix] of idToWorldMatrixMap.entries()) {
      let mesh: InstancedMesh | null = null
      let localIndex: number | undefined = undefined

      if (mode === 'model') {
        // Model 模式：使用 internalIdToMeshInfo 获取对应的 mesh 和局部索引
        const meshInfo = internalIdToMeshInfo?.get(id)
        if (!meshInfo) continue

        const { itemId, localIndex: idx } = meshInfo
        localIndex = idx

        // 根据 itemId 获取对应的 mesh（-1 表示 fallback）
        if (itemId === -1) {
          mesh = fallbackMesh || null
        } else {
          mesh = modelMeshMap?.get(itemId) || null
        }

        if (!mesh) continue
      } else {
        // Box/Icon/SimpleBox 模式：使用全局索引
        const index = idToIndexMap.get(id)
        if (index === undefined) continue
        localIndex = index

        if (mode === 'box' && meshTarget) mesh = meshTarget
        else if (mode === 'icon' && iconMeshTarget) mesh = iconMeshTarget
        else if (mode === 'simple-box' && simpleBoxMeshTarget) mesh = simpleBoxMeshTarget

        if (!mesh) continue
      }

      // Local = Inverse(Parent) * World
      // Parent is Scale(1, -1, 1). Its inverse is also Scale(1, -1, 1).

      scratchMatrix.copy(worldMatrix)

      // 手动应用 Scale(1, -1, 1) 的效果到 WorldMatrix 上，得到 LocalMatrix
      // Matrix4 elements are column-major.
      // Row 1 (Index 1, 5, 9, 13) needs to be negated to apply Scale(1, -1, 1)
      const el = scratchMatrix.elements
      el[1] = -el[1]
      el[5] = -el[5]
      el[9] = -el[9]
      el[13] = -el[13]

      // 针对不同模式对矩阵进行后处理
      if (mode === 'box' || mode === 'model') {
        // Box/Model 模式：完全信任 Gizmo 计算的矩阵（包含物理尺寸和旋转）
        mesh.setMatrixAt(localIndex, scratchMatrix)
      } else if (mode === 'simple-box') {
        // Simple Box 模式：保留位置和旋转，但强制重置缩放为 100 * symbolScale
        scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)

        const s = 100 * settingsStore.settings.threeSymbolScale
        scratchScale.set(s, s, s)

        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        mesh.setMatrixAt(localIndex, scratchMatrix)
      } else if (mode === 'icon') {
        // Icon 模式：保留位置，但强制重置缩放和旋转（维持 Billboard 朝向）

        // 1. 提取位置
        scratchPosition.setFromMatrixPosition(scratchMatrix)

        // 2. 重新计算 Billboard 旋转 (逻辑复用自 updateIconFacing)
        // 注意：这里需要重新生成纯旋转矩阵，不带父级翻转修正，因为最后我们会统一应用
        const normal = currentIconNormal
        const up = currentIconUp

        // 构建目标旋转
        if (up) {
          scratchTmpVec3.set(normal[0], normal[1], normal[2])
          scratchUpVec3.set(up[0], up[1], up[2]).normalize()
          scratchLookAtTarget.set(-normal[0], -normal[1], -normal[2])
          // 使用 scratchMatrix 构建旋转
          scratchMatrix.lookAt(new ThreeVector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)
        } else {
          scratchTmpVec3.set(normal[0], normal[1], normal[2])
          scratchQuaternion.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
          scratchMatrix.makeRotationFromQuaternion(scratchQuaternion)
        }

        // 3. 应用父级翻转修正 (因为我们是在 Local Space 构建)
        // 上面的 scratchMatrix 是 "Ideal World Rotation"，转到 Local 需要 Flip Row 1
        const el = scratchMatrix.elements
        el[1] = -el[1]
        el[5] = -el[5]
        el[9] = -el[9]
        // (位移部分是0，不用管)

        // 4. 应用缩放
        const scale = settingsStore.settings.threeSymbolScale
        scratchScale.set(scale, scale, scale)
        scratchMatrix.scale(scratchScale)

        // 5. 应用位置
        scratchMatrix.setPosition(scratchPosition)

        mesh.setMatrixAt(localIndex, scratchMatrix)
      }

      mesh.instanceMatrix.needsUpdate = true
    }

    // 更新完成后，重新适配 BVH（比完全重建快）
    // 根据模式选择要更新的 mesh
    const meshesToRefit: InstancedMesh[] = []
    if (mode === 'box' && meshTarget) meshesToRefit.push(meshTarget)
    else if (mode === 'icon' && iconMeshTarget) meshesToRefit.push(iconMeshTarget)
    else if (mode === 'simple-box' && simpleBoxMeshTarget) meshesToRefit.push(simpleBoxMeshTarget)
    else if (mode === 'model') {
      // Model 模式：需要重新适配所有被修改的 mesh
      if (modelMeshMap) {
        for (const mesh of modelMeshMap.values()) {
          meshesToRefit.push(mesh)
        }
      }
      if (fallbackMesh) meshesToRefit.push(fallbackMesh)
    }

    for (const mesh of meshesToRefit) {
      if (mesh.geometry?.boundsTree) {
        mesh.geometry.boundsTree.refit()
      }
    }
  }

  return {
    updateSelectedInstancesMatrix,
  }
}

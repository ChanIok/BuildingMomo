import { Matrix4, Vector3, Euler } from 'three'
import type { AppItem } from '@/types/editor'
import { matrixTransform } from './matrixTransform'
import type { Position } from './coordinateTransform'

/**
 * 在工作坐标系下旋转物品
 *
 * 核心算法：worldRotation = W × L × W⁻¹
 * - W: 工作坐标系旋转矩阵（三轴）
 * - L: 局部空间（工作坐标系）的组合旋转矩阵（ZYX 欧拉顺序）
 * - W⁻¹: 工作坐标系旋转的逆矩阵
 *
 * @param items 要旋转的物品列表
 * @param rotation 工作坐标系中的相对旋转增量（视觉空间，度）
 * @param center 旋转中心（游戏数据空间坐标）
 * @param workingRotation 工作坐标系的三轴旋转角度（度数）
 * @param useModelScale 是否使用模型缩放（影响矩阵构建）
 * @returns 更新后的物品列表
 */
export function rotateItemsInWorkingCoordinate(
  items: AppItem[],
  rotation: { x?: number; y?: number; z?: number },
  center: { x: number; y: number; z: number },
  workingRotation: { x: number; y: number; z: number },
  useModelScale: boolean = false
): AppItem[] {
  const rotationX = rotation.x ?? 0
  const rotationY = rotation.y ?? 0
  const rotationZ = rotation.z ?? 0

  if (items.length === 0 || (rotationX === 0 && rotationY === 0 && rotationZ === 0)) {
    return items
  }

  // 1. 构建工作坐标系旋转矩阵 W（三轴）
  const gizmoRotationMatrix = new Matrix4()
  const gizmoRotationInverse = new Matrix4()

  const hasRotation = workingRotation.x !== 0 || workingRotation.y !== 0 || workingRotation.z !== 0
  if (hasRotation) {
    // 注意：工作坐标系角度需要取负（Z 轴），以与 Gizmo 的 pivot 旋转一致
    const euler = new Euler(
      (workingRotation.x * Math.PI) / 180,
      (workingRotation.y * Math.PI) / 180,
      -(workingRotation.z * Math.PI) / 180,
      'ZYX'
    )
    gizmoRotationMatrix.makeRotationFromEuler(euler)
    gizmoRotationInverse.copy(gizmoRotationMatrix).invert()
  }
  // 否则保持为单位矩阵

  // 2. 在工作坐标系局部空间构建组合旋转矩阵 L
  const localRotationMatrix = new Matrix4()
  const localEuler = new Euler(
    (rotationX * Math.PI) / 180,
    (rotationY * Math.PI) / 180,
    -(rotationZ * Math.PI) / 180,
    'ZYX'
  )
  localRotationMatrix.makeRotationFromEuler(localEuler)

  // 3. 转换到世界空间：worldRotation = W × L × W⁻¹
  const worldRotationMatrix = new Matrix4()
    .multiplyMatrices(gizmoRotationMatrix, localRotationMatrix)
    .multiply(gizmoRotationInverse)

  // 4. 计算旋转中心的世界坐标
  const centerData = matrixTransform.dataPositionToWorld(center as Position)
  const centerWorld = new Vector3(centerData.x, centerData.y, centerData.z)

  // 5. 对每个物品应用旋转变换
  return items.map((item) => {
    // a. 构建起始世界矩阵
    const startMatrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)

    // b. 提取起始位置
    const startPos = new Vector3().setFromMatrixPosition(startMatrix)

    // c. 计算相对于旋转中心的位置
    const relativePos = startPos.clone().sub(centerWorld)

    // d. 旋转相对位置（公转）
    relativePos.applyMatrix4(worldRotationMatrix)

    // e. 计算新位置
    const newPos = centerWorld.clone().add(relativePos)

    // f. 应用旋转到物品本身（自转）
    const newMatrix = worldRotationMatrix.clone().multiply(startMatrix)
    newMatrix.setPosition(newPos)

    // g. 还原为游戏数据
    const newData = matrixTransform.extractItemDataFromWorldMatrix(newMatrix)

    // h. 返回更新后的物品（保留其他属性）
    return {
      ...item,
      x: newData.x,
      y: newData.y,
      z: newData.z,
      rotation: newData.rotation,
    }
  })
}

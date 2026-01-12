import { Matrix4, Vector3 } from 'three'
import type { AppItem } from '@/types/editor'
import { matrixTransform } from './matrixTransform'

/**
 * 在工作坐标系下旋转物品
 *
 * 核心算法：worldRotation = W × L × W⁻¹
 * - W: 工作坐标系旋转矩阵
 * - L: 局部空间（工作坐标系）的单轴旋转矩阵
 * - W⁻¹: 工作坐标系旋转的逆矩阵
 *
 * @param items 要旋转的物品列表
 * @param axis 旋转轴 ('x' | 'y' | 'z')
 * @param angleDeg 旋转角度（度数），正值为逆时针
 * @param center 旋转中心（游戏数据空间坐标）
 * @param workingAngleDeg 工作坐标系的 Z 轴旋转角度（度数），0 表示禁用工作坐标系
 * @param useModelScale 是否使用模型缩放（影响矩阵构建）
 * @returns 更新后的物品列表
 */
export function rotateItemsInWorkingCoordinate(
  items: AppItem[],
  axis: 'x' | 'y' | 'z',
  angleDeg: number,
  center: { x: number; y: number; z: number },
  workingAngleDeg: number,
  useModelScale: boolean = false
): AppItem[] {
  if (items.length === 0 || angleDeg === 0) {
    return items
  }

  // 1. 构建工作坐标系旋转矩阵 W（如果启用）
  const gizmoRotationMatrix = new Matrix4()
  const gizmoRotationInverse = new Matrix4()

  if (workingAngleDeg !== 0) {
    const angleRad = (workingAngleDeg * Math.PI) / 180
    // 注意：工作坐标系角度需要取负（与 Gizmo 的 pivot.rotation.z = -workingAngle 一致）
    gizmoRotationMatrix.makeRotationZ(-angleRad)
    gizmoRotationInverse.copy(gizmoRotationMatrix).invert()
  }
  // 否则保持为单位矩阵

  // 2. 在工作坐标系局部空间构建单轴旋转矩阵 L
  const localRotationMatrix = new Matrix4()
  const angleRad = (angleDeg * Math.PI) / 180

  if (axis === 'x') {
    localRotationMatrix.makeRotationX(angleRad)
  } else if (axis === 'y') {
    localRotationMatrix.makeRotationY(angleRad)
  } else {
    // axis === 'z'
    localRotationMatrix.makeRotationZ(angleRad)
  }

  // 3. 转换到世界空间：worldRotation = W × L × W⁻¹
  const worldRotationMatrix = new Matrix4()
    .multiplyMatrices(gizmoRotationMatrix, localRotationMatrix)
    .multiply(gizmoRotationInverse)

  // 4. 计算旋转中心的世界坐标（应用 Scale(1, -1, 1) 变换）
  const centerWorld = new Vector3(center.x, -center.y, center.z)

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

/**
 * 从旋转参数对象中提取单轴旋转信息
 *
 * @param rotation 旋转参数对象
 * @returns { axis, angle } 或 null（如果没有旋转）
 */
export function extractSingleAxisRotation(rotation: {
  x?: number
  y?: number
  z?: number
}): { axis: 'x' | 'y' | 'z'; angle: number } | null {
  if (rotation.x !== undefined && rotation.x !== 0) {
    return { axis: 'x', angle: rotation.x }
  }
  if (rotation.y !== undefined && rotation.y !== 0) {
    return { axis: 'y', angle: rotation.y }
  }
  if (rotation.z !== undefined && rotation.z !== 0) {
    return { axis: 'z', angle: rotation.z }
  }
  return null
}

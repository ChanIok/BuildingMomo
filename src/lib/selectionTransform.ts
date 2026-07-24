import type { AppItem } from '@/types/editor'
import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import { matrixTransform } from './matrixTransform'
import { rotateItemsInWorkingCoordinate } from './rotationTransform'
import { scaleItemsAroundPivot, type SelectionScaleFactors } from './selectionScaleTransform'

export interface SelectionTransformFrame {
  pivotData: { x: number; y: number; z: number }
  pivotWorldPosition: Vector3
  pivotWorldQuaternion: Quaternion
  workingRotation: { x: number; y: number; z: number }
}

export interface RelativeSelectionTransform {
  positionDelta: { x: number; y: number; z: number }
  rotationDelta: { x: number; y: number; z: number }
  scaleFactors: SelectionScaleFactors
}

/**
 * 从数据空间 Pivot 和视觉工作坐标系构建一份共享变换基准。
 */
export function createSelectionTransformFrame(
  pivotData: { x: number; y: number; z: number },
  workingRotation: { x: number; y: number; z: number }
): SelectionTransformFrame {
  // 第一步：把存档位置转换为 Three.js 世界位置，统一处理 Y 轴翻转。
  const worldPosition = matrixTransform.dataPositionToWorld(pivotData)
  // 第二步：按项目统一的 ZYX 和 Z 取反约定构建视觉坐标系旋转。
  const pivotWorldQuaternion = new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(workingRotation.x),
      MathUtils.degToRad(workingRotation.y),
      -MathUtils.degToRad(workingRotation.z),
      'ZYX'
    )
  )

  return {
    pivotData: { ...pivotData },
    pivotWorldPosition: new Vector3(worldPosition.x, worldPosition.y, worldPosition.z),
    pivotWorldQuaternion,
    workingRotation: { ...workingRotation },
  }
}

/**
 * 在数据空间中平移一批物品。
 */
export function translateItems(
  items: AppItem[],
  delta: { x: number; y: number; z: number }
): AppItem[] {
  // 零位移直接保留原引用，避免无意义事务和浮点改写。
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) {
    return items
  }

  // 每个变更项都生成新引用，确保引用式历史事务能够识别修改。
  return items.map((item) => ({
    ...item,
    x: item.x + delta.x,
    y: item.y + delta.y,
    z: item.z + delta.z,
  }))
}

/**
 * 对一批物品应用唯一的相对组合变换，固定顺序为 Scale → Rotate → Translate。
 *
 * 这对应常见的 T × R × S 变换语义：先在选定坐标系中整体缩放，
 * 再围绕同一 Pivot 旋转，最后施加数据空间位移。
 */
export function applyRelativeSelectionTransform(
  items: AppItem[],
  transform: RelativeSelectionTransform,
  frame: SelectionTransformFrame
): AppItem[] {
  // 第一步：在共享 Pivot 和工作坐标系中整体缩放位置与物品自身 Scale。
  const hasScale =
    transform.scaleFactors.x !== 1 ||
    transform.scaleFactors.y !== 1 ||
    transform.scaleFactors.z !== 1
  const scaledItems = hasScale
    ? scaleItemsAroundPivot(
        items,
        frame.pivotWorldPosition,
        frame.pivotWorldQuaternion,
        transform.scaleFactors
      )
    : items
  // 第二步：围绕同一 Pivot 应用工作坐标系相对旋转。
  const rotatedItems = rotateItemsInWorkingCoordinate(
    scaledItems,
    transform.rotationDelta,
    frame.pivotData,
    frame.workingRotation,
    false
  )
  // 第三步：最后应用位移，使组合变换的顺序明确且可复用。
  return translateItems(rotatedItems, transform.positionDelta)
}

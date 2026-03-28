import { rotateItemsInWorkingCoordinate, extractSingleAxisRotation } from './rotationTransform'
import type { AppItem, TransformParams } from '@/types/editor'

/**
 * 共享变换上下文。
 *
 * 说明：
 * - `rotationCenter` 控制相对旋转 / 多选相对缩放的锚点。
 * - `positionReferencePoint` 只用于绝对位置模式，计算“目标点 - 当前参考点”的位移。
 * - `effectiveWorkingRotation` 必须与编辑器当前的正式坐标系语义一致，
 *   这样步进复制才能与手动相对变换得到同一结果。
 */
export interface ItemTransformContext {
  rotationCenter: { x: number; y: number; z: number }
  positionReferencePoint: { x: number; y: number; z: number }
  effectiveWorkingRotation: { x: number; y: number; z: number }
  limitScaleValues: boolean
  getScaleRange: (gameId: number) => [number, number] | null
}

function applyPositionOffset(
  item: AppItem,
  positionOffset: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return {
    x: item.x + positionOffset.x,
    y: item.y + positionOffset.y,
    z: item.z + positionOffset.z,
  }
}

/**
 * 对一批物品应用与编辑器一致的变换规则。
 *
 * 设计目标：
 * - 让 Sidebar / Gizmo / 高级粘贴都复用同一套正式变换数学。
 * - 严禁在高级粘贴中再维护一套“近似”的 working-space 欧拉运算。
 * - `repeat = 1` 的步进复制，必须与“复制后手动执行一次相对变换”一致。
 */
export function applyTransformToItems(
  items: AppItem[],
  params: TransformParams,
  context: ItemTransformContext
): AppItem[] {
  if (items.length === 0) {
    return items
  }

  const { mode, position, rotation, scale } = params
  const { rotationCenter, positionReferencePoint, effectiveWorkingRotation } = context

  let positionOffset = { x: 0, y: 0, z: 0 }
  if (mode === 'absolute' && position) {
    positionOffset = {
      x: (position.x ?? positionReferencePoint.x) - positionReferencePoint.x,
      y: (position.y ?? positionReferencePoint.y) - positionReferencePoint.y,
      z: (position.z ?? positionReferencePoint.z) - positionReferencePoint.z,
    }
  } else if (mode === 'relative' && position) {
    positionOffset = {
      x: position.x ?? 0,
      y: position.y ?? 0,
      z: position.z ?? 0,
    }
  }

  const rotationInfo = mode === 'relative' && rotation ? extractSingleAxisRotation(rotation) : null
  const rotatedItemsMap = rotationInfo
    ? new Map(
        rotateItemsInWorkingCoordinate(
          items,
          rotationInfo.axis,
          rotationInfo.angle,
          rotationCenter,
          effectiveWorkingRotation,
          false
        ).map((item) => [item.internalId, item])
      )
    : null

  return items.map((item) => {
    let newScale = item.extra.Scale || { X: 1, Y: 1, Z: 1 }
    let scalePositionOffset = { x: 0, y: 0, z: 0 }

    if (scale) {
      if (mode === 'absolute') {
        newScale = {
          X: scale.x !== undefined ? scale.x : newScale.X,
          Y: scale.y !== undefined ? scale.y : newScale.Y,
          Z: scale.z !== undefined ? scale.z : newScale.Z,
        }
      } else {
        const scaleMultiplier = {
          x: scale.x ?? 1,
          y: scale.y ?? 1,
          z: scale.z ?? 1,
        }

        newScale = {
          X: newScale.X * scaleMultiplier.x,
          Y: newScale.Y * scaleMultiplier.y,
          Z: newScale.Z * scaleMultiplier.z,
        }

        // 多选相对缩放的位移补偿必须与编辑器保持一致。
        // 注意这里沿用既有约定：Scale.X / Scale.Y 与数据空间 XY 存在交叉映射。
        if (items.length > 1) {
          const relativeX = item.x - rotationCenter.x
          const relativeY = item.y - rotationCenter.y
          const relativeZ = item.z - rotationCenter.z

          scalePositionOffset = {
            x: relativeX * (scaleMultiplier.y - 1),
            y: relativeY * (scaleMultiplier.x - 1),
            z: relativeZ * (scaleMultiplier.z - 1),
          }
        }
      }

      if (context.limitScaleValues) {
        const scaleRange = context.getScaleRange(item.gameId)
        if (scaleRange) {
          const [min, max] = scaleRange
          newScale = {
            X: Math.max(min, Math.min(max, newScale.X)),
            Y: Math.max(min, Math.min(max, newScale.Y)),
            Z: Math.max(min, Math.min(max, newScale.Z)),
          }
        }
      }
    }

    if (mode === 'absolute' && rotation) {
      const newRotation = {
        x: rotation.x ?? item.rotation.x ?? 0,
        y: rotation.y ?? item.rotation.y ?? 0,
        z: rotation.z ?? item.rotation.z ?? 0,
      }

      return {
        ...item,
        x: item.x + positionOffset.x + scalePositionOffset.x,
        y: item.y + positionOffset.y + scalePositionOffset.y,
        z: item.z + positionOffset.z + scalePositionOffset.z,
        rotation: newRotation,
        extra: {
          ...item.extra,
          Scale: newScale,
        },
      }
    }

    if (rotatedItemsMap) {
      const rotatedItem = rotatedItemsMap.get(item.internalId)
      if (rotatedItem) {
        return {
          ...rotatedItem,
          x: rotatedItem.x + positionOffset.x + scalePositionOffset.x,
          y: rotatedItem.y + positionOffset.y + scalePositionOffset.y,
          z: rotatedItem.z + positionOffset.z + scalePositionOffset.z,
          extra: {
            ...item.extra,
            Scale: newScale,
          },
        }
      }
    }

    const newPos = applyPositionOffset(item, positionOffset)
    return {
      ...item,
      x: newPos.x + scalePositionOffset.x,
      y: newPos.y + scalePositionOffset.y,
      z: newPos.z + scalePositionOffset.z,
      extra: {
        ...item.extra,
        Scale: newScale,
      },
    }
  })
}

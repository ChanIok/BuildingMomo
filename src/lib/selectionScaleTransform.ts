import { Quaternion, Vector3 } from 'three'
import type { AppItem } from '@/types/editor'
import { matrixTransform } from '@/lib/matrixTransform'

export type SelectionScaleAxis = 'X' | 'Y' | 'Z' | 'XYZ'

export interface SelectionScaleFactors {
  x: number
  y: number
  z: number
}

export type ScaleRangeResolver = (
  item: AppItem,
  dataAxis: 'X' | 'Y' | 'Z'
) => [number, number] | null

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getFactorRange(
  items: AppItem[],
  dataAxis: 'X' | 'Y' | 'Z',
  resolveScaleRange: ScaleRangeResolver
): [number, number] {
  // 第一步：共享数学不内置 Gizmo 或 Input 政策，范围完全由调用方提供。
  let minFactor = -Infinity
  let maxFactor = Infinity

  for (const item of items) {
    // 第二步：没有范围表示该物品在当前调用场景下不参与倍率约束。
    const range = resolveScaleRange(item, dataAxis)
    if (!range) continue

    // 第三步：把家具的绝对缩放上下限换算为相对当前值的倍率上下限。
    const currentScale = item.extra.Scale?.[dataAxis] ?? 1
    if (currentScale <= 0) continue

    // 第四步：对所有选中物品取交集，任一物品到达限制后整体停止。
    minFactor = Math.max(minFactor, range[0] / currentScale)
    maxFactor = Math.min(maxFactor, range[1] / currentScale)
  }

  // 已经超限的旧数据不能在触发缩放时被自动改写；始终允许倍率 1，
  // 但只允许继续向合法范围的方向拖动。
  return [Math.min(1, minFactor), Math.max(1, maxFactor)]
}

export function constrainSelectionScaleFactors(
  requested: SelectionScaleFactors,
  axis: SelectionScaleAxis,
  items: AppItem[],
  resolveScaleRange: ScaleRangeResolver
): SelectionScaleFactors {
  // 未被当前手柄控制的轴保持倍率 1，避免单轴拖拽污染其他数据轴。
  const next = { x: 1, y: 1, z: 1 }

  if (axis === 'XYZ') {
    // 等比缩放必须在三个数据轴和全部选中物品之间寻找同一个合法倍率。
    let minFactor = -Infinity
    let maxFactor = Infinity

    // 分别取得 X/Y/Z 的共同范围，再取三者交集。
    for (const dataAxis of ['X', 'Y', 'Z'] as const) {
      const [axisMin, axisMax] = getFactorRange(items, dataAxis, resolveScaleRange)
      minFactor = Math.max(minFactor, axisMin)
      maxFactor = Math.min(maxFactor, axisMax)
    }

    // Shift 等比缩放会传入三个相同值；取平均可消除极小的浮点差异。
    const requestedUniform = (requested.x + requested.y + requested.z) / 3
    // 将请求倍率裁剪到由最终绝对 Scale 反推得到的共同范围。
    const uniform = clamp(requestedUniform, minFactor, Math.max(minFactor, maxFactor))
    return { x: uniform, y: uniform, z: uniform }
  }

  // 视觉局部 X/Y 与游戏存档 Scale.Y/X 交叉对应，这里按正式轴映射查询约束。
  if (axis === 'X') {
    const [min, max] = getFactorRange(items, 'Y', resolveScaleRange)
    next.x = clamp(requested.x, min, max)
  } else if (axis === 'Y') {
    const [min, max] = getFactorRange(items, 'X', resolveScaleRange)
    next.y = clamp(requested.y, min, max)
  } else {
    const [min, max] = getFactorRange(items, 'Z', resolveScaleRange)
    next.z = clamp(requested.z, min, max)
  }

  return next
}

export function scaleItemsAroundPivot(
  items: AppItem[],
  pivotWorldPosition: Vector3,
  pivotWorldQuaternion: Quaternion,
  factors: SelectionScaleFactors
): AppItem[] {
  // 第一步：缓存 Pivot 逆旋转，把世界空间偏移转换到当前变换坐标系。
  const inversePivotRotation = pivotWorldQuaternion.clone().invert()
  const factorVector = new Vector3(factors.x, factors.y, factors.z)

  return items.map((item) => {
    // 第二步：将游戏数据坐标转换到 Three.js 世界空间，统一处理 Y 轴翻转。
    const worldPosition = matrixTransform.dataPositionToWorld(item)
    // 第三步：以 Pivot 为原点，在当前变换坐标系中缩放物品的位置偏移。
    const scaledOffset = new Vector3(worldPosition.x, worldPosition.y, worldPosition.z)
      .sub(pivotWorldPosition)
      .applyQuaternion(inversePivotRotation)
      .multiply(factorVector)
      .applyQuaternion(pivotWorldQuaternion)

    // 第四步：把缩放后的世界坐标转换回可写入存档的数据坐标。
    const nextWorldPosition = scaledOffset.add(pivotWorldPosition)
    const nextDataPosition = matrixTransform.worldPositionToData(nextWorldPosition)
    const currentScale = item.extra.Scale ?? { X: 1, Y: 1, Z: 1 }

    // 第五步：生成全新的顶层对象和 extra，确保引用式事务引擎能识别缩放变化。
    return {
      ...item,
      x: nextDataPosition.x,
      y: nextDataPosition.y,
      z: nextDataPosition.z,
      extra: {
        ...item.extra,
        Scale: {
          // 第六步：沿用项目既有约定，视觉 X/Y 分别写入存档 Scale.Y/X。
          X: currentScale.X * factors.y,
          Y: currentScale.Y * factors.x,
          Z: currentScale.Z * factors.z,
        },
      },
    }
  })
}

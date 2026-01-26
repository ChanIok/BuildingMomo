import { Vector3, Euler } from 'three'
import type { AppItem } from '../types/editor'
import { matrixTransform } from './matrixTransform'
import { getOBBFromMatrix, getOBBFromMatrixAndModelBox, type OBB } from './collision'

/**
 * 对齐计算辅助函数库
 *
 * 提供可复用的纯函数，用于对齐/分布操作
 * 封装了重复的计算逻辑，确保一致性
 */

// ========== 包围盒计算 ==========

/**
 * 为单个物品构建 OBB
 *
 * 封装了 box/model 模式的差异逻辑
 *
 * @param item 物品数据
 * @param currentMode 当前显示模式
 * @param gameDataStore 游戏数据 store（用于获取家具尺寸）
 * @param modelManager 模型管理器（用于获取模型包围盒）
 * @returns OBB 实例
 */
export function buildItemOBB(
  item: AppItem,
  currentMode: 'box' | 'icon' | 'simple-box' | 'model',
  gameDataStore: any,
  modelManager: any
): OBB {
  const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
  const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
  const useModelScale = !!(currentMode === 'model' && hasValidModel)

  const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)

  if (useModelScale) {
    const modelBox = modelManager.getModelBoundingBox(item.gameId)
    if (modelBox) {
      return getOBBFromMatrixAndModelBox(matrix, modelBox)
    } else {
      // Fallback: box 模式
      return getOBBFromMatrix(matrix, new Vector3(1, 1, 1))
    }
  } else {
    // Box/Icon/Simple 模式：单位立方体
    // 注意：Box 模式的 Z 轴原点在底部，getOBBFromMatrix 内部会正确处理
    return getOBBFromMatrix(matrix, new Vector3(1, 1, 1))
  }
}

// ========== 对齐轴计算 ==========

/**
 * 计算对齐轴在世界空间中的方向向量
 *
 * @param axis 对齐轴 ('x' | 'y' | 'z')
 * @param workingRotation 工作坐标系旋转角度（视觉空间，度），null 表示全局坐标系
 * @returns 世界空间的单位向量
 */
export function calculateAlignAxisVector(
  axis: 'x' | 'y' | 'z',
  workingRotation: { x: number; y: number; z: number } | null
): Vector3 {
  const alignAxisVector = new Vector3()

  if (axis === 'x') {
    alignAxisVector.set(1, 0, 0)
  } else if (axis === 'y') {
    alignAxisVector.set(0, 1, 0)
  } else {
    alignAxisVector.set(0, 0, 1)
  }

  // 如果有工作坐标系旋转，应用到轴向量
  if (workingRotation) {
    const hasRotation =
      workingRotation.x !== 0 || workingRotation.y !== 0 || workingRotation.z !== 0

    if (hasRotation) {
      const euler = new Euler(
        (workingRotation.x * Math.PI) / 180,
        (workingRotation.y * Math.PI) / 180,
        -(workingRotation.z * Math.PI) / 180, // Z 轴取反
        'ZYX'
      )
      alignAxisVector.applyEuler(euler)
    }
  }

  return alignAxisVector
}

// ========== Y轴翻转逻辑 ==========

/**
 * 判断是否需要反转 min/max 逻辑（Y轴特殊处理）
 *
 * 由于渲染时使用 Scale(1, -1, 1) 翻转了 Y 轴，
 * 需要反转 min/max 逻辑以符合用户的视觉预期
 *
 * @param axis 对齐轴
 * @returns 是否需要反转
 */
export function shouldInvertForYAxis(axis: 'x' | 'y' | 'z'): boolean {
  return axis === 'y'
}

// ========== 对齐目标值计算 ==========

/**
 * 单元投影信息
 */
export interface UnitProjection {
  projMin: number
  projMax: number
  projCenter: number
}

/**
 * 根据对齐模式和投影数据计算目标值
 *
 * @param projections 所有单元的投影数据
 * @param mode 对齐模式
 * @param axis 对齐轴
 * @returns 目标对齐位置
 */
export function calculateAlignTarget(
  projections: UnitProjection[],
  mode: 'min' | 'center' | 'max',
  axis: 'x' | 'y' | 'z'
): number {
  const shouldInvert = shouldInvertForYAxis(axis)

  if (mode === 'min') {
    if (shouldInvert) {
      return Math.max(...projections.map((p) => p.projMax))
    } else {
      return Math.min(...projections.map((p) => p.projMin))
    }
  } else if (mode === 'center') {
    const allMin = Math.min(...projections.map((p) => p.projMin))
    const allMax = Math.max(...projections.map((p) => p.projMax))
    return (allMin + allMax) / 2
  } else {
    // max
    if (shouldInvert) {
      return Math.min(...projections.map((p) => p.projMin))
    } else {
      return Math.max(...projections.map((p) => p.projMax))
    }
  }
}

/**
 * 计算单个单元需要移动的距离
 *
 * @param projection 单元的投影数据
 * @param targetValue 目标对齐位置
 * @param mode 对齐模式
 * @param axis 对齐轴
 * @returns 移动距离（带符号）
 */
export function calculateAlignDelta(
  projection: UnitProjection,
  targetValue: number,
  mode: 'min' | 'center' | 'max',
  axis: 'x' | 'y' | 'z'
): number {
  const shouldInvert = shouldInvertForYAxis(axis)

  if (mode === 'min') {
    return shouldInvert ? targetValue - projection.projMax : targetValue - projection.projMin
  } else if (mode === 'center') {
    return targetValue - projection.projCenter
  } else {
    // max
    return shouldInvert ? targetValue - projection.projMin : targetValue - projection.projMax
  }
}

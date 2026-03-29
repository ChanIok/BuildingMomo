import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import type { AppItem } from '@/types/editor'
import { matrixTransform } from './matrixTransform'

type DisplayMode = 'box' | 'icon' | 'simple-box' | 'model'

interface DisplayGeometryContext {
  currentMode: DisplayMode
  getFurnitureSize: (gameId: number) => [number, number, number] | null
  getModelConfig: (gameId: number) => { meshes?: unknown[] } | null | undefined
  getModelBoundingBox?: (gameId: number) => Box3 | null
}

export interface DisplayGeometryInfo {
  useModelScale: boolean
  modelBox: Box3 | null
  furnitureSize: [number, number, number]
  /** 补偿 X 类用：家具长边或模型 AABB 的 x */
  sizeX: number
  /** 补偿 Y 类用：家具宽或模型 AABB 的 y */
  sizeY: number
}

/** X/Y 两类补偿各自用的“半边长”尺寸 */
export interface ScaleCompensationSizes {
  sizeX: number
  sizeY: number
}

const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]
const COMPENSATION_EPSILON = 0.001

// 游戏缩放后“锚点漂移”分两类，用两张表互斥配置（同一 gameId 不能同时出现在两表）。
// - X 类：沿物品局部 X 补偿，标量 ((Scale.Y - Scale.X) * 0.5 * sizeX)
// - Y 类：沿旋转后局部 Y 轴负方向补偿，标量与 X 类相反且用 sizeY：((Scale.X - Scale.Y) * 0.5 * sizeY)
export const SCALE_RENDER_COMPENSATION_X_GAME_IDS = [1170000307, 1170000582, 1170000813] as const

export const SCALE_RENDER_COMPENSATION_Y_GAME_IDS = [1170000345, 1170000346, 1170000218] as const

const scaleRenderCompensationXSet = new Set<number>(SCALE_RENDER_COMPENSATION_X_GAME_IDS)
const scaleRenderCompensationYSet = new Set<number>(SCALE_RENDER_COMPENSATION_Y_GAME_IDS)

for (const id of SCALE_RENDER_COMPENSATION_Y_GAME_IDS) {
  if (scaleRenderCompensationXSet.has(id)) {
    throw new Error(`[scaleRenderCompensation] gameId ${id} 不能同时出现在 X 与 Y 白名单中`)
  }
}

const scratchLocalAxis = new Vector3()
const scratchLocalMatrix = new Matrix4()
const scratchLocalPosition = new Vector3()
const scratchLocalQuaternion = new Quaternion()
const scratchLocalScale = new Vector3()
const scratchModelSize = new Vector3()

export type ScaleRenderCompensationAxis = 'none' | 'x' | 'y'

export function getScaleRenderCompensationAxis(gameId: number): ScaleRenderCompensationAxis {
  if (scaleRenderCompensationXSet.has(gameId)) return 'x'
  if (scaleRenderCompensationYSet.has(gameId)) return 'y'
  return 'none'
}

export function hasScaleRenderCompensation(gameId: number): boolean {
  return getScaleRenderCompensationAxis(gameId) !== 'none'
}

export function getScaleRenderCompensationAmount(
  item: AppItem,
  sizes: ScaleCompensationSizes
): number {
  const axis = getScaleRenderCompensationAxis(item.gameId)
  if (axis === 'none') {
    return 0
  }

  const scale = item.extra.Scale
  const dx = (scale?.Y ?? 1) - (scale?.X ?? 1)
  if (axis === 'x') {
    return dx * 0.5 * sizes.sizeX
  }
  // Y 类：与 X 类标量互为相反数，半边长用 sizeY（沿局部 Y 施加）
  return -dx * 0.5 * sizes.sizeY
}

export function applyScaleRenderCompensationToPositionInPlace(
  position: Vector3,
  item: AppItem,
  localRotation: Quaternion,
  sizes: ScaleCompensationSizes
): Vector3 {
  // 这个入口给 Box / Model 渲染重建使用：
  // 已经拿到了“局部旋转”和“待写入的 position”，直接在 compose 前改位置即可。
  const axis = getScaleRenderCompensationAxis(item.gameId)
  if (axis === 'none') {
    return position
  }

  const compensationAmount = getScaleRenderCompensationAmount(item, sizes)
  if (Math.abs(compensationAmount) <= COMPENSATION_EPSILON) {
    return position
  }

  if (axis === 'x') {
    scratchLocalAxis.set(1, 0, 0).applyQuaternion(localRotation)
  } else {
    // Y 类：沿旋转后的局部 Y 轴负方向
    scratchLocalAxis.set(0, -1, 0).applyQuaternion(localRotation)
  }
  position.addScaledVector(scratchLocalAxis, compensationAmount)
  return position
}

export function applyScaleRenderCompensationToWorldMatrixInPlace(
  worldMatrix: Matrix4,
  item: AppItem,
  sizes: ScaleCompensationSizes
): Matrix4 {
  // 这个入口给“只拿到 world matrix 的消费者”使用，例如 Gizmo 预览、相机包围盒、吸附。
  // 做法是：先转回 local matrix，按局部 X 或 Y 补偿位置，再重新乘回父级翻转矩阵。
  const axis = getScaleRenderCompensationAxis(item.gameId)
  if (axis === 'none') {
    return worldMatrix
  }

  const compensationAmount = getScaleRenderCompensationAmount(item, sizes)
  if (Math.abs(compensationAmount) <= COMPENSATION_EPSILON) {
    return worldMatrix
  }

  scratchLocalMatrix.copy(matrixTransform.parentFlipMatrix).multiply(worldMatrix)
  scratchLocalMatrix.decompose(scratchLocalPosition, scratchLocalQuaternion, scratchLocalScale)

  if (axis === 'x') {
    scratchLocalAxis.set(1, 0, 0).applyQuaternion(scratchLocalQuaternion)
  } else {
    scratchLocalAxis.set(0, -1, 0).applyQuaternion(scratchLocalQuaternion)
  }
  scratchLocalPosition.addScaledVector(scratchLocalAxis, compensationAmount)
  scratchLocalMatrix.compose(scratchLocalPosition, scratchLocalQuaternion, scratchLocalScale)

  worldMatrix.copy(matrixTransform.parentFlipMatrix).multiply(scratchLocalMatrix)
  return worldMatrix
}

export function applyScaleRenderCompensationToWorldMatrix(
  worldMatrix: Matrix4,
  item: AppItem,
  sizes: ScaleCompensationSizes
): Matrix4 {
  return applyScaleRenderCompensationToWorldMatrixInPlace(worldMatrix.clone(), item, sizes)
}

export function resolveDisplayGeometryInfo(
  item: AppItem,
  context: DisplayGeometryContext
): DisplayGeometryInfo {
  const furnitureSize = context.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
  const modelConfig = context.getModelConfig(item.gameId)
  const hasValidModel =
    context.currentMode === 'model' && !!modelConfig?.meshes && modelConfig.meshes.length > 0

  const modelBox =
    hasValidModel && context.getModelBoundingBox ? context.getModelBoundingBox(item.gameId) : null
  // 只有真的拿到 modelBox，才按模型真实几何来算 sizeX；
  // 否则退回家具尺寸，避免“模型还没加载好时包围盒突然变得很小”。
  const useModelScale = hasValidModel && modelBox !== null

  let sizeX = furnitureSize[0]
  let sizeY = furnitureSize[1]
  if (modelBox) {
    modelBox.getSize(scratchModelSize)
    sizeX = scratchModelSize.x
    sizeY = scratchModelSize.y
  }

  return {
    useModelScale,
    modelBox,
    furnitureSize,
    sizeX,
    sizeY,
  }
}

export function buildDisplayWorldMatrixFromItem(
  item: AppItem,
  context: DisplayGeometryContext
): DisplayGeometryInfo & { worldMatrix: Matrix4 } {
  // 这里故意构建的是“显示用矩阵”：
  // raw 数据语义仍由 matrixTransform 负责，这个函数只在显示/交互层叠加补偿。
  const geometry = resolveDisplayGeometryInfo(item, context)
  const worldMatrix = matrixTransform.buildWorldMatrixFromItem(item, geometry.useModelScale)

  applyScaleRenderCompensationToWorldMatrixInPlace(worldMatrix, item, {
    sizeX: geometry.sizeX,
    sizeY: geometry.sizeY,
  })

  return {
    ...geometry,
    worldMatrix,
  }
}

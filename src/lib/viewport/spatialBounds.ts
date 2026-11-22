import { Box3, Vector3 } from 'three'
import { SCENE_BOUNDS_ORIGIN_ONLY_THRESHOLD } from '@/types/constants'
import type { AppItem } from '@/types/editor'
import { getAABBFromMatrix, getAABBFromMatrixAndModelBox } from '@/lib/geometry/collision'
import {
  buildDisplayWorldMatrixFromItem,
  type DisplayGeometryContext,
} from '@/lib/transform/scaleRenderCompensation'
import { getSlidePathWorldBox, isSlidePathItem } from '@/lib/geometry/slidePath'

// Box 模式 / fallback 模式使用单位立方体作为基础几何体；
// 实际尺寸已经编码在 world matrix 的 scale 中。
const UNIT_BOX_SIZE = new Vector3(1, 1, 1)

/**
 * 世界空间包围盒的派生信息。
 *
 * 这些指标主要服务于相机 framing、选区几何中心等“视觉空间”语义，
 * 避免各处重复从 Box3 手动提取 center / size / maxDim。
 */
export interface WorldBoundsMetrics {
  box: Box3
  center: Vector3
  size: Vector3
  maxDim: number
}

/**
 * 计算世界空间包围盒所需的只读查询上下文。
 * 由调用方（如视口相机 composable）注入 Store 与模型包围盒查询，保持本模块无框架依赖。
 */
export type WorldBoundsProvider = DisplayGeometryContext

/**
 * 在共享上下文中计算单个物品的世界空间 AABB。
 *
 * 优先级：
 * 1. 若模型包围盒可用，则使用“模型真实包围盒 + world matrix”
 * 2. 否则回退到 box 模式的基础几何体 AABB
 *
 * 注意这里统一返回的是“世界空间 AABB”，不是数据空间 bounds。
 */
function getItemWorldBoxWithProvider(item: AppItem, provider: WorldBoundsProvider): Box3 {
  if (isSlidePathItem(item)) {
    const slidePathBox = getSlidePathWorldBox(item)
    if (slidePathBox) return slidePathBox
  }

  // 相机 framing / focus 应该和用户“眼睛看到的东西”一致，
  // 所以这里用 display world matrix，而不是 raw world matrix。
  const { worldMatrix, modelBox } = buildDisplayWorldMatrixFromItem(item, provider)

  if (modelBox) {
    return getAABBFromMatrixAndModelBox(worldMatrix, modelBox)
  }

  return getAABBFromMatrix(worldMatrix, UNIT_BOX_SIZE)
}

/**
 * 获取“仅按物品原点”合并后的世界空间包围盒。
 *
 * 这是给超大场景用的降级路径：
 * - 不再计算每个物品的真实显示几何 AABB
 * - 只取每个物品原点在世界空间中的位置
 * - 最终得到一个“原点云”的最小包围盒
 *
 * 设计目的：
 * - scene / selection bounds 在本项目里主要服务于相机构图（far / fit / center）
 * - 当物品数量超过阈值时，精确 AABB 的计算成本会远高于它带来的构图收益
 * - 因此这里允许用“粗略但稳定”的 bounds 替代，以换取大场景交互性能
 *
 * 注意：
 * - 返回的是世界空间 Box3，因此数据空间 Y 需要翻转成世界空间的 `-item.y`
 * - 该结果会低估真实场景尺寸（因为忽略了物品自身大小），但这是有意接受的取舍
 */
function getItemsOriginWorldBox(items: AppItem[]): Box3 | null {
  if (items.length === 0) return null

  const first = items[0]
  if (!first) return null

  let minX = first.x
  let maxX = first.x
  let minY = -first.y
  let maxY = -first.y
  let minZ = first.z
  let maxZ = first.z

  for (let index = 1; index < items.length; index++) {
    const item = items[index]
    if (!item) continue

    const worldX = item.x
    const worldY = -item.y
    const worldZ = item.z

    if (worldX < minX) minX = worldX
    if (worldX > maxX) maxX = worldX
    if (worldY < minY) minY = worldY
    if (worldY > maxY) maxY = worldY
    if (worldZ < minZ) minZ = worldZ
    if (worldZ > maxZ) maxZ = worldZ
  }

  return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ))
}

/**
 * 获取单个物品的世界空间 AABB。
 */
export function getItemWorldBox(item: AppItem, provider: WorldBoundsProvider): Box3 {
  return getItemWorldBoxWithProvider(item, provider)
}

/**
 * 获取多个物品合并后的世界空间 AABB。
 *
 * 这是“选区 frame center / scene frame center”的基础数据来源。
 */
export function getItemsWorldBox(items: AppItem[], provider: WorldBoundsProvider): Box3 | null {
  if (items.length === 0) return null

  // 超大场景下退化为“原点包围盒”策略，避免为相机构图重复扫描所有物品的真实显示几何。
  // 这里的目标不是物理精确，而是以足够低的成本得到一个稳定可用的 framing 参考盒。
  if (items.length > SCENE_BOUNDS_ORIGIN_ONLY_THRESHOLD) {
    return getItemsOriginWorldBox(items)
  }

  let mergedBox: Box3 | null = null

  for (const item of items) {
    const itemBox = getItemWorldBoxWithProvider(item, provider)
    if (mergedBox) {
      mergedBox.union(itemBox)
    } else {
      mergedBox = itemBox.clone()
    }
  }

  return mergedBox
}

/**
 * 获取多个物品的世界空间包围盒指标。
 *
 * 相比只返回 `Box3`，这里额外提供：
 * - `center`：包围盒中心
 * - `size`：包围盒尺寸
 * - `maxDim`：三个轴中最大的尺寸，用于相机距离/缩放估算
 */
export function getItemsWorldBoundsMetrics(
  items: AppItem[],
  provider: WorldBoundsProvider
): WorldBoundsMetrics | null {
  const box = getItemsWorldBox(items, provider)
  if (!box || box.isEmpty()) return null

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())

  return {
    box,
    center,
    size,
    maxDim: Math.max(size.x, size.y, size.z),
  }
}

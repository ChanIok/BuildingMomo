import type { AppItem } from '../types/editor'

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  centerX: number
  centerY: number
  centerZ: number
  width: number
  height: number
  depth: number
}

/**
 * 计算物品列表的边界框
 * @param items 物品列表
 * @param getItemSize 可选的物品尺寸获取函数，返回 [长X, 宽Y, 高Z]，用于更精确的包围盒计算
 */
export function calculateBounds(
  items: AppItem[],
  getItemSize?: (gameId: number) => [number, number, number] | null
): Bounds | null {
  if (items.length === 0) return null

  let minX = Infinity,
    maxX = -Infinity
  let minY = Infinity,
    maxY = -Infinity
  let minZ = Infinity,
    maxZ = -Infinity

  for (const item of items) {
    // 获取物品尺寸（如果提供了获取函数）
    const size = getItemSize?.(item.gameId) ?? null

    if (size) {
      // 使用尺寸计算包围盒（静态尺寸，不考虑旋转）
      const halfX = size[0] / 2
      const halfY = size[1] / 2
      const halfZ = size[2] / 2

      minX = Math.min(minX, item.x - halfX)
      maxX = Math.max(maxX, item.x + halfX)
      minY = Math.min(minY, item.y - halfY)
      maxY = Math.max(maxY, item.y + halfY)
      minZ = Math.min(minZ, item.z - halfZ)
      maxZ = Math.max(maxZ, item.z + halfZ)
    } else {
      // 回退到仅使用中心点
      if (item.x < minX) minX = item.x
      if (item.x > maxX) maxX = item.x
      if (item.y < minY) minY = item.y
      if (item.y > maxY) maxY = item.y
      if (item.z < minZ) minZ = item.z
      if (item.z > maxZ) maxZ = item.z
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  }
}

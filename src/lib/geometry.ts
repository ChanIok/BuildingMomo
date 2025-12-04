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
 */
export function calculateBounds(items: AppItem[]): Bounds | null {
  if (items.length === 0) return null

  let minX = Infinity,
    maxX = -Infinity
  let minY = Infinity,
    maxY = -Infinity
  let minZ = Infinity,
    maxZ = -Infinity

  for (const item of items) {
    if (item.x < minX) minX = item.x
    if (item.x > maxX) maxX = item.x
    if (item.y < minY) minY = item.y
    if (item.y > maxY) maxY = item.y
    if (item.z < minZ) minZ = item.z
    if (item.z > maxZ) maxZ = item.z
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

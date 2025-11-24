import * as Comlink from 'comlink'
import type { AppItem } from '../types/editor'

// 射线法判断点是否在多边形内
function isPointInPolygon(point: { x: number; y: number }, polygon: number[][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]
    const pj = polygon[j]

    if (!pi || !pj || pi.length < 2 || pj.length < 2) continue

    const xi = pi[0]!
    const yi = pi[1]!
    const xj = pj[0]!
    const yj = pj[1]!

    const intersect =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// 重复物品检测
function detectDuplicates(items: AppItem[], enableDetection: boolean): AppItem[][] {
  if (!enableDetection || items.length === 0) {
    return []
  }

  // Map索引：key = "gameId,x,y,z,pitch,yaw,roll,scaleX,scaleY,scaleZ", value = AppItem[]
  const itemMap = new Map<string, AppItem[]>()

  items.forEach((item) => {
    const rot = item.originalData.Rotation
    const scale = item.originalData.Scale
    const key = `${item.gameId},${item.x},${item.y},${item.z},${rot.Pitch},${rot.Yaw},${rot.Roll},${scale.X},${scale.Y},${scale.Z}`
    if (!itemMap.has(key)) {
      itemMap.set(key, [])
    }
    itemMap.get(key)!.push(item)
  })

  // 过滤出重复的组（count > 1）
  const duplicates = Array.from(itemMap.values()).filter((group) => group.length > 1)

  return duplicates
}

// 限制检查结果类型
interface LimitCheckResult {
  outOfBoundsItemIds: string[]
  oversizedGroups: number[]
}

// 限制检查 (坐标 & 组大小)
function checkLimits(
  items: AppItem[],
  buildableAreas: Record<string, number[][]> | null
): LimitCheckResult {
  const outOfBoundsItemIds: string[] = []
  const oversizedGroups: number[] = []

  // 1. 检查组大小限制 ( > 50 )
  const groupCounts = new Map<number, number>()
  items.forEach((item) => {
    const gid = item.originalData.GroupID
    if (gid > 0) {
      groupCounts.set(gid, (groupCounts.get(gid) || 0) + 1)
    }
  })

  groupCounts.forEach((count, gid) => {
    if (count > 50) {
      oversizedGroups.push(gid)
    }
  })

  // 2. 检查坐标限制 (如果在可建造区域外)
  if (buildableAreas) {
    // 获取所有多边形
    const polygons = Object.values(buildableAreas)

    items.forEach((item) => {
      // 简单的点判定，不考虑物品体积
      const point = { x: item.x, y: item.y }
      let isInside = false

      // 只要在任意一个多边形内就算合法
      for (const polygon of polygons) {
        if (isPointInPolygon(point, polygon)) {
          isInside = true
          break
        }
      }

      if (!isInside) {
        outOfBoundsItemIds.push(item.internalId)
      }
    })
  }

  return {
    outOfBoundsItemIds,
    oversizedGroups,
  }
}

const api = {
  detectDuplicates,
  checkLimits,
}

export type ValidationWorkerApi = typeof api

Comlink.expose(api)

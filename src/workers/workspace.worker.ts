import * as Comlink from 'comlink'
import { set } from 'idb-keyval'
import type { AppItem } from '../types/editor'
import type { WorkspaceSnapshot, ValidationResult } from '../types/persistence'

const STORAGE_KEY = 'workspace_snapshot'

// 状态
let currentSnapshot: WorkspaceSnapshot | null = null
let buildableAreas: Record<string, number[][]> | null = null
let settings = {
  enableDuplicateDetection: true,
  enableLimitDetection: true,
}

// --- 验证逻辑（适配 AppItem）---

// 射线投射算法
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

function detectDuplicates(items: AppItem[]): string[][] {
  if (!settings.enableDuplicateDetection || items.length === 0) {
    return []
  }

  // 映射索引：key = "gameId,x,y,z,pitch,yaw,roll,scaleX,scaleY,scaleZ"
  const itemMap = new Map<string, string[]>()

  for (const item of items) {
    // AppItem 旋转：x=Roll, y=Pitch, z=Yaw
    const rot = item.rotation
    // 缩放在 extra 中
    const scale = item.extra.Scale

    const key = `${item.gameId},${item.x},${item.y},${item.z},${rot.y},${rot.z},${rot.x},${scale.X},${scale.Y},${scale.Z}`

    let list = itemMap.get(key)
    if (!list) {
      list = []
      itemMap.set(key, list)
    }
    list.push(item.internalId)
  }

  return Array.from(itemMap.values()).filter((group) => group.length > 1)
}

function checkLimits(items: AppItem[]): {
  outOfBoundsItemIds: string[]
  oversizedGroups: number[]
} {
  const outOfBoundsItemIds: string[] = []
  const oversizedGroups: number[] = []

  if (!settings.enableLimitDetection) {
    return { outOfBoundsItemIds, oversizedGroups }
  }

  // 1. 组大小
  const groupCounts = new Map<number, number>()
  for (const item of items) {
    const gid = item.groupId
    if (gid > 0) {
      groupCounts.set(gid, (groupCounts.get(gid) || 0) + 1)
    }
  }

  groupCounts.forEach((count, gid) => {
    if (count > 50) {
      oversizedGroups.push(gid)
    }
  })

  // 2. 边界（Z 和 XY）
  const zRange = { min: -3500, max: 10200 }
  const polygons = buildableAreas ? Object.values(buildableAreas) : []

  if (buildableAreas || zRange) {
    for (const item of items) {
      let isInvalid = false

      // 检查 Z
      if (item.z < zRange.min || item.z > zRange.max) {
        isInvalid = true
      }

      // 检查 XY
      if (!isInvalid && polygons.length > 0) {
        const point = { x: item.x, y: item.y }
        let isInside = false

        for (const polygon of polygons) {
          if (isPointInPolygon(point, polygon)) {
            isInside = true
            break
          }
        }

        if (!isInside) {
          isInvalid = true
        }
      }

      if (isInvalid) {
        outOfBoundsItemIds.push(item.internalId)
      }
    }
  }

  return { outOfBoundsItemIds, oversizedGroups }
}

function runValidation(): ValidationResult {
  if (!currentSnapshot || !currentSnapshot.editor.activeSchemeId) {
    return {
      duplicateGroups: [],
      limitIssues: { outOfBoundsItemIds: [], oversizedGroups: [] },
    }
  }

  const activeScheme = currentSnapshot.editor.schemes.find(
    (s) => s.id === currentSnapshot!.editor.activeSchemeId
  )

  if (!activeScheme) {
    return {
      duplicateGroups: [],
      limitIssues: { outOfBoundsItemIds: [], oversizedGroups: [] },
    }
  }

  const items = activeScheme.items

  const duplicates = detectDuplicates(items)
  const limits = checkLimits(items)

  return {
    duplicateGroups: duplicates,
    limitIssues: limits,
  }
}

// --- 工具函数 ---

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
    }, delay)
  }
}

// --- 持久化逻辑 ---

const saveSnapshot = async () => {
  if (!currentSnapshot) return

  try {
    await set(STORAGE_KEY, currentSnapshot)
    postMessage({ type: 'SAVE_COMPLETE', timestamp: Date.now() })
  } catch (e) {
    console.error('[Worker] Failed to save snapshot', e)
  }
}

const scheduleSave = debounce(saveSnapshot, 2000)

// --- API ---

const api = {
  async syncWorkspace(snapshot: WorkspaceSnapshot): Promise<ValidationResult> {
    currentSnapshot = snapshot

    // 触发保存
    scheduleSave()

    // 立即触发验证
    return runValidation()
  },

  updateSettings(newSettings: {
    enableDuplicateDetection: boolean
    enableLimitDetection: boolean
  }) {
    settings = { ...settings, ...newSettings }
    // 如果有数据，重新运行验证
    if (currentSnapshot) {
      return runValidation()
    }
    return {
      duplicateGroups: [],
      limitIssues: { outOfBoundsItemIds: [], oversizedGroups: [] },
    }
  },

  updateBuildableAreas(areas: Record<string, number[][]> | null) {
    buildableAreas = areas
    if (currentSnapshot) {
      return runValidation()
    }
    return {
      duplicateGroups: [],
      limitIssues: { outOfBoundsItemIds: [], oversizedGroups: [] },
    }
  },
}

export type WorkspaceWorkerApi = typeof api

Comlink.expose(api)

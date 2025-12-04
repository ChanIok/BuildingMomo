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
  enableAutoSave: false,
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

function detectDuplicates(
  items: AppItem[],
  config: { enableDuplicateDetection: boolean }
): string[][] {
  if (!config.enableDuplicateDetection || items.length === 0) {
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

function checkLimits(
  items: AppItem[],
  config: { enableLimitDetection: boolean }
): {
  outOfBoundsItemIds: string[]
  oversizedGroups: number[]
} {
  const outOfBoundsItemIds: string[] = []
  const oversizedGroups: number[] = []

  if (!config.enableLimitDetection) {
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

function runValidation(
  items: AppItem[],
  config: { enableDuplicateDetection: boolean; enableLimitDetection: boolean }
): ValidationResult {
  const duplicates = detectDuplicates(items, config)
  const limits = checkLimits(items, config)

  return {
    duplicateGroups: duplicates,
    limitIssues: limits,
  }
}

// --- 持久化逻辑 ---

let saveTimer: ReturnType<typeof setTimeout> | null = null

const forceSave = async () => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveSnapshot()
}

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSnapshot, 2000)
}

const saveSnapshot = async () => {
  // 关键修改：检查 enableAutoSave
  if (!currentSnapshot || !settings.enableAutoSave) return

  try {
    await set(STORAGE_KEY, currentSnapshot)
    postMessage({ type: 'SAVE_COMPLETE', timestamp: Date.now() })
  } catch (e) {
    console.error('[Worker] Failed to save snapshot', e)
  }
}

// 内部辅助：基于当前快照状态运行验证
function runValidationOnSnapshot(): ValidationResult {
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

  return runValidation(activeScheme.items, settings)
}

// --- API ---

const api = {
  // 1. 初始化 (全量)
  async initWorkspace(snapshot: WorkspaceSnapshot) {
    currentSnapshot = snapshot
    // 初始化时不触发保存
  },

  // 2. 纯验证 (无状态)
  validate(
    items: AppItem[],
    config?: { enableDuplicateDetection: boolean; enableLimitDetection: boolean }
  ): ValidationResult {
    // 使用传入的配置，或者回退到 Worker 内部状态的配置
    const effectiveConfig = config ? { ...settings, ...config } : settings
    return runValidation(items, effectiveConfig)
  },

  // 3. 统一增量同步 (结构 + 内容)
  async syncWorkspace(payload: {
    // 元数据
    meta: {
      activeSchemeId: string
      tabs: any[]
      activeTabId: string
      schemes: { id: string; name: string; filePath?: string; lastModified?: number }[]
    }
    // 当前激活方案的完整数据 (可选)
    activeSchemeData?: {
      id: string
      items: AppItem[]
      selectedItemIds: any
      currentViewConfig: any
      viewState: any
    }
    // 是否立即保存（跳过防抖）
    immediate?: boolean
  }): Promise<ValidationResult> {
    if (!currentSnapshot) {
      return {
        duplicateGroups: [],
        limitIssues: { outOfBoundsItemIds: [], oversizedGroups: [] },
      }
    }

    // 1. 更新元数据 & 结构 (合并方案列表)
    currentSnapshot.editor.activeSchemeId = payload.meta.activeSchemeId
    currentSnapshot.tab.tabs = payload.meta.tabs
    currentSnapshot.tab.activeTabId = payload.meta.activeTabId

    const newSchemesList: any[] = []
    for (const metaScheme of payload.meta.schemes) {
      const existing = currentSnapshot.editor.schemes.find((s) => s.id === metaScheme.id)
      if (existing) {
        existing.name = metaScheme.name
        existing.filePath = metaScheme.filePath
        if (metaScheme.lastModified) existing.lastModified = metaScheme.lastModified
        newSchemesList.push(existing)
      } else {
        // 新建空方案
        newSchemesList.push({
          ...metaScheme,
          items: [],
          selectedItemIds: [],
          currentViewConfig: undefined,
          viewState: undefined,
        })
      }
    }
    currentSnapshot.editor.schemes = newSchemesList

    // 2. 更新当前方案内容 (如果提供了)
    let targetScheme = null
    if (payload.activeSchemeData) {
      targetScheme = currentSnapshot.editor.schemes.find(
        (s) => s.id === payload.activeSchemeData!.id
      )
      if (targetScheme) {
        Object.assign(targetScheme, payload.activeSchemeData)
        targetScheme.lastModified = Date.now()
      }
    }

    // 3. 触发保存
    currentSnapshot.updatedAt = Date.now()

    if (payload.immediate) {
      forceSave()
    } else {
      scheduleSave()
    }

    // 4. 返回验证结果 (基于刚刚更新的数据)
    if (targetScheme) {
      return runValidation(targetScheme.items, settings)
    } else {
      // 如果没有更新内容，或者更新的是非激活方案（不太可能），尝试验证当前的 activeScheme
      return runValidationOnSnapshot()
    }
  },

  // 5. 主动触发全量验证
  revalidate(): ValidationResult {
    return runValidationOnSnapshot()
  },

  // 6. 更新设置
  updateSettings(newSettings: {
    enableDuplicateDetection?: boolean
    enableLimitDetection?: boolean
    enableAutoSave?: boolean
  }) {
    const oldAutoSave = settings.enableAutoSave
    settings = { ...settings, ...newSettings }

    // 如果刚刚开启了自动保存，且有数据，立即尝试保存一次
    if (!oldAutoSave && settings.enableAutoSave && currentSnapshot) {
      scheduleSave()
    }
  },

  // 7. 更新可建造区域 (缓存)
  updateBuildableAreas(areas: Record<string, number[][]> | null) {
    buildableAreas = areas
  },
}

export type WorkspaceWorkerApi = typeof api

Comlink.expose(api)

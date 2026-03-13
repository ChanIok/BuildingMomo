import type { AppItem } from '@/types/editor'
import type { FurnitureColorConfig } from '@/types/furniture'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'

export type ModelDyePlan =
  | { mode: 'plain' }
  | {
      mode: 'dyed'
      /** meshIdx → { pattern, tint }：每个源 mesh 的贴图变体选择 */
      dyeMap: Map<number, { pattern: number; tint: number }>
    }

/**
 * 根据家具模型的染色配置和物品 ColorMap，解析模型染色计划。
 *
 * 规则：
 * 1) 无 colors 配置 → plain
 * 2) 对每个存在染色配置的区域：优先使用 ColorMap 中显式选择的 colorIndex，
 *    未显式选择时回退到该区域的 0 号配置
 * 3) 只要任一区域命中 cfg，就返回 dyed；否则 plain
 */
export function resolveModelDyePlan({
  item,
  colorsConfig,
}: {
  item: Pick<AppItem, 'extra'>
  colorsConfig: FurnitureColorConfig | undefined
}): ModelDyePlan {
  if (!colorsConfig) return { mode: 'plain' }

  const groupMap = decodeColorMapToGroupMap(item.extra.ColorMap)

  const dyeMap = new Map<number, { pattern: number; tint: number }>()

  for (const [rawGroupId, groupConfig] of Object.entries(colorsConfig)) {
    if (!groupConfig) continue
    const groupId = Number(rawGroupId)
    if (!Number.isFinite(groupId)) continue

    const colorIndex = groupMap.get(groupId) ?? 0
    const entry = groupConfig[colorIndex]
    if (!entry) continue

    for (const [meshIdx, pattern, tint] of entry.cfg) {
      dyeMap.set(meshIdx, { pattern, tint })
    }
  }

  if (dyeMap.size === 0) return { mode: 'plain' }
  return { mode: 'dyed', dyeMap }
}

/**
 * 生成模型分组缓存键，完整表达染色意图，避免错误复用。
 */
export function buildModelMeshKey(gameId: number, plan: ModelDyePlan): string {
  if (plan.mode === 'plain') return `${gameId}|plain`

  const parts = Array.from(plan.dyeMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([meshIdx, { pattern, tint }]) => `${meshIdx}:${pattern},${tint}`)
    .join(';')
  return `${gameId}|dyed|${parts}`
}

import type { AppItem } from '@/types/editor'
import type { DyePreset } from '@/types/furniture'
import { parseColorIndex, parseColorMapSlots } from '@/lib/colorMap'

export type ModelDyePlan =
  | { mode: 'plain' }
  | { mode: 'legacy'; colorIndex: number }
  | { mode: 'preset'; preset: DyePreset; slotValues: number[] }

interface ResolveModelDyePlanParams {
  item: Pick<AppItem, 'gameId' | 'extra'>
  enableModelDye: boolean
  getDyePreset: (gameId: number) => { preset: DyePreset; slotIds: number[] } | null
}

/**
 * 根据当前设置和家具数据，解析模型染色计划。
 *
 * 规则：
 * 1) enableModelDye=false -> plain
 * 2) 有 preset -> 仅使用 preset（不访问 legacy）
 * 3) 无 preset -> legacy
 */
export function resolveModelDyePlan({
  item,
  enableModelDye,
  getDyePreset,
}: ResolveModelDyePlanParams): ModelDyePlan {
  if (!enableModelDye) {
    return { mode: 'plain' }
  }

  const dyeResult = getDyePreset(item.gameId)
  if (dyeResult) {
    const { preset, slotIds } = dyeResult
    const slotValues = parseColorMapSlots(item.extra.ColorMap, slotIds)
    return {
      mode: 'preset',
      preset,
      slotValues,
    }
  }

  return {
    mode: 'legacy',
    colorIndex: parseColorIndex(item.extra.ColorMap) ?? 0,
  }
}

/**
 * 生成模型分组键，键必须完整表达最终材质意图，避免错误复用。
 */
export function buildModelMeshKey(gameId: number, plan: ModelDyePlan): string {
  if (plan.mode === 'plain') {
    return `${gameId}|plain`
  }
  if (plan.mode === 'legacy') {
    return `${gameId}|legacy|ci=${plan.colorIndex}`
  }

  const slotKey = plan.slotValues.length > 0 ? plan.slotValues.join('_') : 'none'
  return `${gameId}|preset|slots=${slotKey}`
}

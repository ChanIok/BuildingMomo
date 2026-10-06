import type { GameColorMap } from '../types/editor'
import type { FurnitureColorConfig } from '../types/furniture'

export function cleanFurnitureColors(
  colorMap: GameColorMap | undefined,
  config: FurnitureColorConfig | undefined
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const scheme of Object.values(colorMap ?? {})) {
    if (typeof scheme !== 'number' || scheme <= 0 || scheme % 10 === 0) continue
    const area = Math.trunc(scheme / 10)
    // 同一区域保留最后一个合法色盘。
    if (config?.[area]?.[scheme % 10]) result[String(area)] = scheme
  }
  return result
}

export function checkFurnitureColors(colorMap: GameColorMap | undefined, schemes: number[]) {
  // 与导出一致：空值、0 和区域默认色不会写入有效染色列表。
  const colors = Object.values(colorMap ?? {}).filter(
    (color): color is number => typeof color === 'number' && color > 0 && color % 10 !== 0
  )
  const areas = colors.map((color) => Math.trunc(color / 10))

  return {
    invalidColor: colors.some((color) => !schemes.includes(color)),
    conflictingColor: new Set(areas).size !== areas.length,
  }
}

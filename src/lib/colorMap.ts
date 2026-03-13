import type { GameColorMap } from '@/types/editor'

/**
 * 从 ColorMap 中解析单个颜色索引（旧系统，单槽染色）
 *
 * 规则：
 * - 对象格式 { "0": 0 } → 返回第一个值
 * - 数组格式 [null, 22] → 返回 null（多槽染色，需使用 parseColorMapSlots）
 * - undefined / 无效 → 返回 0（默认颜色）
 */
export function parseColorIndex(colorMap: GameColorMap | undefined): number | null {
  if (colorMap === undefined || colorMap === null) {
    return 0
  }

  // 数组格式 → 需使用 parseColorMapSlots 处理
  if (Array.isArray(colorMap)) {
    return null
  }

  // 对象格式 { "0": 0 } → 取第一个值
  if (typeof colorMap === 'object') {
    const values = Object.values(colorMap)
    if (values.length > 0 && typeof values[0] === 'number') {
      return values[0]
    }
    return 0
  }

  return 0
}

/**
 * 将 ColorMap 解码为「groupId -> colorIndex」映射。
 *
 * 统一解码规则（值驱动）：
 * - value <= 0 或无效：忽略
 * - value < 10：groupId = 0，colorIndex = value（简单模式）
 * - value >= 10：groupId = floor(value / 10)，colorIndex = value % 10（多组模式）
 *
 * 说明：
 * - 数组格式：逐项按 value 解码（不依赖索引语义）
 * - 对象格式：key 作为 groupId，value 仅用于取 colorIndex（兼容旧数据）
 */
export function decodeColorMapToGroupMap(colorMap: GameColorMap | undefined): Map<number, number> {
  const result = new Map<number, number>()
  if (!colorMap) return result

  const toColorIndex = (value: number): number | null => {
    if (!Number.isFinite(value) || value <= 0) return null
    const colorIndex = value < 10 ? value : value % 10
    return colorIndex > 0 ? colorIndex : null
  }

  if (Array.isArray(colorMap)) {
    for (const raw of colorMap) {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue
      const colorIndex = toColorIndex(raw)
      if (colorIndex === null) continue
      const groupId = raw < 10 ? 0 : Math.floor(raw / 10)
      result.set(groupId, colorIndex)
    }
    return result
  }

  for (const [groupKey, raw] of Object.entries(colorMap)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue
    const groupId = Number(groupKey)
    if (!Number.isFinite(groupId) || groupId < 0) continue
    const colorIndex = toColorIndex(raw)
    if (colorIndex === null) continue
    result.set(groupId, colorIndex)
  }

  return result
}

/**
 * 从 ColorMap 中解析多槽颜色索引（新系统，多槽染色）
 *
 * @param colorMap 游戏 ColorMap 数据
 * @param slotIds 色盘组编号列表（与 preset.slots 数组一一对应）
 * @returns 各槽位的变体索引数组（颜色编号），缺失的槽位默认为 0
 */
export function parseColorMapSlots(
  colorMap: GameColorMap | undefined,
  slotIds: number[]
): number[] {
  const groupMap = decodeColorMapToGroupMap(colorMap)
  return slotIds.map((slotId) => groupMap.get(slotId) ?? 0)
}

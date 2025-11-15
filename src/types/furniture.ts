// 家具元数据类型定义

/**
 * 原始家具条目：
 * [
 *   ItemID: number,
 *   [name_zh: string, name_en: string, icon_id: number, dim: [number, number, number]]
 * ]
 */
export type RawFurnitureEntry = [
  number,
  [name_zh: string, name_en: string, icon_id: number, dim: [number, number, number]],
]

/** 远程数据格式 */
export interface BuildingMomoFurniture {
  v: string
  /**
   * 远程数据格式：
   * {
   *   "v": "20251115",
   *   "d": [
   *     [1170000817, ["流转之柱・家园", "Warp Spire: Home", 1885877145, [169.5, 142.4, 368.1]]],
   *     ...
   *   ]
   * }
   */
  d: RawFurnitureEntry[]
}

/** 家具物品信息（应用内部统一使用的结构） */
export interface FurnitureItem {
  /** 中文名称 */
  name_cn: string
  /** 英文名称 */
  name_en: string
  /** 图标相对路径 */
  icon: string
  /** 尺寸（游戏坐标系：X=长, Y=宽, Z=高，单位：cm） */
  size: [number, number, number]
}

/** IndexedDB 缓存结构 */
export interface FurnitureCache {
  lastFetchTime: number
  data: Record<string, FurnitureItem>
}

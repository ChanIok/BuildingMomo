// 家具元数据类型定义

/**
 * 原始家具条目：
 * [
 *   ItemID: number,
 *   [name_zh: string, name_en: string, icon_id: number, dim: [number, number, number], scale: [min, max], rot: [x, y], category_id: number, colors, combination, combination_colors]
 * ]
 */
export interface FurnitureColorEntry {
  /** 显示图标 ID（UI 色块用） */
  idx: number
  /** 原始 raw 由上游 cfg 保留；旧三项数据不能反推 HBC 的 raw。 */
  cfg: [meshIdx: number, pattern: number, tint: number, raw?: number][]
}

/** 染色配置：groupId -> (colorIndex -> 变体配置) */
export type FurnitureColorConfig = Record<number, Record<number, FurnitureColorEntry>>

export type RawFurnitureCombinationMember = [
  item_id: number,
  position: [x: number, y: number, z: number],
  rotation: [roll: number, pitch: number, yaw: number],
  scale: [x: number, y: number, z: number],
]

export type RawFurnitureCombinationColorMap = [
  member_index: number,
  colors: [area: number, scheme_id: number][],
]

export type RawFurnitureCombinationColorPreset = [
  color_id: number,
  icon_id: number,
  member_colors: RawFurnitureCombinationColorMap[],
]

export type RawFurnitureEntry = [
  number,
  [
    name_zh: string,
    name_en: string,
    icon_id: number,
    dim: [number, number, number],
    scale: [min: number, max: number],
    rot: [x: boolean, y: boolean],
    category_id: number,
    colors: FurnitureColorConfig | null,
    combination: RawFurnitureCombinationMember[] | null,
    combination_colors: RawFurnitureCombinationColorPreset[] | null,
  ],
]

export type RawFurnitureCategory = [
  name_zh: string,
  name_en: string,
  icon_id: number,
  parent_id?: number,
]

/** 远程数据格式 */
export interface BuildingMomoFurniture {
  v: string
  c: Record<string, RawFurnitureCategory>
  d: RawFurnitureEntry[]
}

export interface FurnitureCategory {
  id: number
  name_cn: string
  name_en: string
  iconId: number
  parentId: number | null
}

export interface FurnitureCombinationMember {
  itemId: number
  position: [number, number, number]
  rotation: [roll: number, pitch: number, yaw: number]
  scale: [number, number, number]
}

export interface FurnitureCombinationColorPreset {
  id: number
  iconId: number
  /** 与 combination 成员下标对齐的游戏 ColorMap。 */
  colorMaps: Record<string, number>[]
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
  /** 缩放范围限制 [最小值, 最大值] */
  scaleRange: [number, number]
  /** 旋转权限 */
  rotationAllowed: {
    x: boolean
    y: boolean
    z: boolean
  }
  /** 家具小分类 ID */
  categoryId: number
  /** 家具染色渲染配置 */
  colors?: FurnitureColorConfig
  /** 组合成员；存在时目录条目本身不作为家具摆放 */
  combination?: FurnitureCombinationMember[]
  /** 该组合在游戏中定义的整组染色方案 */
  combinationColorPresets?: FurnitureCombinationColorPreset[]
}

// 家具元数据类型定义

/**
 * 原始家具条目：
 * [
 *   ItemID: number,
 *   [name_zh: string, name_en: string, icon_id: number, dim: [number, number, number], scale: [min, max], rot: [x, y]]
 * ]
 */
export type RawFurnitureEntry = [
  number,
  [
    name_zh: string,
    name_en: string,
    icon_id: number,
    dim: [number, number, number],
    scale: [min: number, max: number],
    rot: [x: boolean, y: boolean],
  ],
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
  /** 缩放范围限制 [最小值, 最大值] */
  scaleRange: [number, number]
  /** 旋转权限 */
  rotationAllowed: {
    x: boolean
    y: boolean
    z: boolean
  }
}

/** IndexedDB 缓存结构 */
export interface FurnitureCache {
  lastFetchTime: number
  data: Record<string, FurnitureItem>
}

// ========== Furniture DB (模型配置) ==========

/** 单个 Mesh 配置 */
export interface FurnitureMeshConfig {
  path: string
  rotation: { x: number; y: number; z: number; w: number }
  trans: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

/** 染色配置：groupId -> (colorIndex -> iconId) */
export type FurnitureColorConfig = Record<string, Record<string, number>>

/** 家具模型配置 */
export interface FurnitureModelConfig {
  id: number
  name: string
  cat: string
  meshes: FurnitureMeshConfig[]
  root_offset: { x: number; y: number; z: number }
  scale_range?: [number, number]
  rotate_axis?: [boolean, boolean]
  colors?: FurnitureColorConfig
  price?: number
}

/** Furniture DB 数据结构 */
export interface FurnitureDB {
  categories: string[]
  furniture: FurnitureModelConfig[]
}

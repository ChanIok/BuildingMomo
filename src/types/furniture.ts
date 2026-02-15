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

// ========== Material Variant Map (单槽染色映射) ==========

/** 旧染色系统中的材质处理类型 */
export type MaterialVariantType = 'color' | 'diffuse'

/** material_variant_map.json 中单个材质实例的配置 */
export interface MaterialVariantConfig {
  /** color: 使用 tint shader；diffuse: 直接替换基础贴图 */
  type: MaterialVariantType
  /** 按 colorIndex 对应的贴图文件名列表 */
  file: string[]
}

/** material_variant_map.json 的完整结构：材质实例名 -> 配置 */
export type MaterialVariantMap = Record<string, MaterialVariantConfig>

// ========== Dye Presets (多槽染色预设) ==========

/** 染色变体配置（单个颜色选项） */
export interface DyeVariant {
  /** 可选：tint 调色板贴图文件名（UV2 采样） */
  color?: string
  /** 可选：替换基础 D 贴图文件名（UV1 采样） */
  diffuse?: string
  /** 说明：当 color 与 diffuse 都缺失时，表示该变体为 no-op（显式不染色） */
}

/** 染色目标配置（指定作用于哪个 mesh 的哪个材质） */
export interface DyeTarget {
  /** meshes 数组中的索引 */
  mesh: number
  /** 材质实例名（如 "MI_WallPaper_01"） */
  mi: string
}

/** 染色槽位配置（一个独立染色区域） */
export interface DyeSlot {
  /** 作用目标列表（可能跨多个 mesh） */
  targets: DyeTarget[]
  /** 变体列表（索引对应 ColorMap 中的值） */
  variants: DyeVariant[]
}

/** 染色预设配置（描述一类家具的所有染色区域） */
export interface DyePreset {
  /** 预设名称（调试用） */
  name: string
  /** 预设 ID */
  id: number
  /** 染色槽位列表（索引对应 ColorMap 的 key/index） */
  slots: DyeSlot[]
}

/** 家具 ID 到预设的引用 */
export interface DyeItemRef {
  /** 引用的预设 ID（presets 数组索引） */
  presets: number
}

/** furniture_dye_presets.json 的完整数据结构 */
export interface DyePresetsData {
  /** 预设定义列表 */
  presets: DyePreset[]
  /** 家具 ID -> 预设引用的映射 */
  items: Record<string, DyeItemRef>
}

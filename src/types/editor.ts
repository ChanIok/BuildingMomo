import type { CollectionTree } from '@/lib/collectionTree'
import type { Ref, ShallowRef } from 'vue'
import type { ViewPreset } from '../composables/useThreeCamera'

export type SchemeSource = 'local' | 'cloud'

/** 成组/解组的明确范围。面板按整组整理，不受画布显隐、锁定和选区限制。 */
export type GroupEditTarget = { schemeId: string } & (
  | { kind: 'selection'; itemIds: readonly string[] }
  | { kind: 'groups'; groupIds: readonly number[] }
)

// 内部 ColorMap 的兼容格式；导出到新版游戏时由 gameDataFormat 统一写成 colors 数组。
// 导入数据中的 ColorMap/colors 有两种格式：
// 1. 对象格式：{ "0": 0 } 或 { "0": 1 }
// 2. 数组格式：[10, 20] 或 [null, 22]
export type GameColorMap = Record<string, number> | (number | null)[]

// 游戏内物品原始数据结构（对应JSON格式）
export interface GameItem {
  ItemID: number
  InstanceID: number
  Location: {
    X: number
    Y: number
    Z: number
  }
  Rotation: {
    Pitch: number
    Yaw: number
    Roll: number
  }
  Scale: {
    X: number
    Y: number
    Z: number
  }
  GroupID: number
  AttachID: number
  ColorMap?: GameColorMap
  TempInfo?: Record<string, any>
}

// 应用内部使用的物品数据结构 - 纯数据对象 (Plain Object)
export interface AppItem {
  internalId: string // 内部唯一ID（用于Vue key）
  gameId: number // 原始游戏ItemID
  instanceId: number // 原始InstanceID

  // 核心变换数据 (扁平化)
  x: number // 平面X坐标
  y: number // 平面Y坐标
  z: number // 高度Z坐标
  rotation: { x: number; y: number; z: number } // 旋转 (x=Roll, y=Pitch, z=Yaw)

  // 逻辑数据
  groupId: number // 组ID

  // 保留原始数据中的其他字段 (Scale, AttachID, ColorMap, TempInfo 等)
  // 注意：Location, Rotation, GroupID 已提升到顶层，此处不再保留以避免冗余
  extra: Omit<GameItem, 'Location' | 'Rotation' | 'GroupID' | 'ItemID' | 'InstanceID'>
}

// 验证所需的轻量级物品数据
export interface ValidationItem {
  internalId: string
  gameId: number
  x: number
  y: number
  z: number
  groupId: number
  scale: { X: number; Y: number; Z: number }
  rotation: { Pitch: number; Yaw: number; Roll: number }
}

// 旧版/方案码使用的扁平数据结构。
// 游戏文件的兼容解析与新格式序列化由 lib/gameDataFormat 负责。
export interface GameDataFile {
  Name?: string
  NeedRestore?: boolean
  PlaceInfo: GameItem[]
}

// 3D视图状态
export interface ThreeViewState {
  position: [number, number, number] // 相机位置
  target: [number, number, number] // 观察目标点
  preset: ViewPreset | null // 视图预设
  zoom: number // 相机缩放 (正交视图必需)
}

// 家园方案（多文档架构） - 高性能重构版
export interface HomeScheme {
  readonly id: string // 方案唯一ID (不可变)

  // 元数据 (使用 Ref 保持 UI 响应式)
  name: Ref<string>
  filePath: Ref<string | undefined>
  lastModified: Ref<number | undefined>
  source: Ref<SchemeSource>
  cloudRoomCode: Ref<string | undefined>

  // 核心数据 (使用 ShallowRef 优化性能)
  // items.value 是原生数组，AppItem 是原生对象
  items: ShallowRef<AppItem[]>

  // 选择集 (使用 ShallowRef)
  selectedItemIds: ShallowRef<Set<string>>
  /** 明确选择的目录节点；null 表示画布选区。不保存到共享文档。 */
  selectedEntries: ShallowRef<readonly CollectionEntry[] | null>

  // ID 分配器（Ref，记录历史最大值，永不回退）
  maxInstanceId: Ref<number>
  maxGroupId: Ref<number>

  // 视图配置 (Ref)
  currentViewConfig: Ref<{ scale: number; x: number; y: number } | undefined>
  viewState: Ref<ThreeViewState | undefined>

  // 组合原点配置 (ShallowRef)
  // 存储每个组的原点物品 ID，用于移动和旋转操作
  groupOrigins: ShallowRef<Map<number, string>> // groupId -> originItemId

  // 组名、分类和排序统一存入文档树；显隐等标记属于个人状态。
  collectionTree: ShallowRef<CollectionTree>
  collapsedCollectionIds: ShallowRef<ReadonlySet<string>>
  hiddenCollectionIds: ShallowRef<ReadonlySet<string>>
  lockedCollectionIds: ShallowRef<ReadonlySet<string>>
  activeCollectionId: Ref<string | null>
  collectionsSupported: Ref<boolean>
  hiddenGroupIds: ShallowRef<ReadonlySet<number>> // 0 隐藏未分组家具，正数 ID 隐藏对应组。
  lockedGroupIds: ShallowRef<ReadonlySet<number>> // 0 锁定未分组家具，正数 ID 锁定对应组。
  activeGroupId: Ref<number | null>

  // 历史记录栈 (ShallowRef)
  history: ShallowRef<HistoryStack | undefined>
}

// 文件监控状态
export interface FileWatchIndexEntry {
  lastModified: number
  lastContent: string
  itemCount: number
  firstDetectedAt: number
}

export interface FileWatchState {
  isActive: boolean // 是否正在监控
  dirHandle: FileSystemDirectoryHandle | null // 监控的目录句柄
  dirPath: string // 目录路径（用于显示）
  lastCheckedTime: number // 上次检查的时间戳
  // 目录内所有文件的索引 Map<文件名, 监控条目>
  fileIndex: Map<string, FileWatchIndexEntry>
}

// 工作坐标系配置
export interface WorkingCoordinateSystem {
  enabled: boolean // 是否启用工作坐标系
  rotation: {
    x: number // X 轴旋转角度（Roll，以度为单位）
    y: number // Y 轴旋转角度（Pitch，以度为单位）
    z: number // Z 轴旋转角度（Yaw，以度为单位）
  }
}

export interface PatchItemChange {
  itemId: string
  before: AppItem
  after: AppItem
}

export interface PatchItemsOperation {
  type: 'patch_items'
  changes: PatchItemChange[]
}

export interface AddItemsOperation {
  type: 'add_items'
  items: AppItem[]
}

export interface RemoveItemsOperation {
  type: 'remove_items'
  items: AppItem[]
}

export interface SetGroupOriginsOperation {
  type: 'set_group_origins'
  before: Array<[number, string]>
  after: Array<[number, string]>
}

export interface SetGroupNamesOperation {
  type: 'set_group_names'
  // 字段补丁作用于 collectionTree.groups，不单独存储名称。
  // 仅包含变化的键，某一侧缺少该键表示删除。
  before: Array<[number, string]>
  after: Array<[number, string]>
}

export interface SetCollectionTreeOperation {
  type: 'set_collection_tree'
  // 仅包含目录结构的投影；名称通过字段补丁传递。
  before: CollectionTree
  after: CollectionTree
}

export type EditorOperation =
  | PatchItemsOperation
  | AddItemsOperation
  | RemoveItemsOperation
  | SetGroupOriginsOperation
  | SetGroupNamesOperation
  | SetCollectionTreeOperation

export interface EditorTransaction {
  id: string
  schemeId: string
  createdAt: number
  intent: string
  ops: EditorOperation[]
}

export interface SelectionHistoryEntry {
  kind: 'selection'
  selectedItemIds: Set<string>
  selectedEntries?: readonly CollectionEntry[] | null
  sequence: number
  timestamp: number
}

export interface TransactionHistoryEntry {
  kind: 'transaction'
  transaction: EditorTransaction
  selectionBefore: Set<string>
  selectionAfter: Set<string>
  entriesBefore?: readonly CollectionEntry[] | null
  entriesAfter?: readonly CollectionEntry[] | null
  committed: boolean
  stale: boolean
  sequence: number
  timestamp: number
}

// Undo/redo history stacks
export interface HistoryStack {
  selectionUndoStack: SelectionHistoryEntry[]
  selectionRedoStack: SelectionHistoryEntry[]
  transactionUndoStack: TransactionHistoryEntry[]
  transactionRedoStack: TransactionHistoryEntry[]
  maxSize: number // Max entries per stack
  nextSequence: number
}

// Recently closed scheme snapshot
export interface ClosedSchemeHistory {
  collectionOriginItems?: Array<Pick<AppItem, 'internalId' | 'instanceId' | 'gameId' | 'groupId'>>
  id: string // Original scheme ID
  name: string // Scheme name
  fileName?: string // Original file name if available
  gameData: GameDataFile // Exported game JSON payload
  collectionTree?: CollectionTree
  collapsedCollectionIds?: string[]
  hiddenCollectionIds?: string[]
  lockedCollectionIds?: string[]
  hiddenGroupIds?: number[]
  lockedGroupIds?: number[]
  lastModified?: number // Last modified timestamp
  closedAt: number // Close timestamp
}

// Clipboard data for cross-scheme copy/paste
export type CollectionEntry =
  | { kind: 'group'; id: number }
  | { kind: 'collection'; id: string }
  | { kind: 'ungrouped'; id: number }

export interface ClipboardStructure {
  tree: CollectionTree
  /** 真正复制的集合；其余节点仅用于恢复来源路径。 */
  collectionIds: string[]
  hiddenGroups: number[]
  lockedGroups: number[]
  hiddenCollections: string[]
  lockedCollections: string[]
}

export interface ClipboardData {
  referenceItemId?: string // 复制时确定的整体变换参考家具
  sourceSchemeId?: string | null // 剪贴板来源方案 ID，用于判断高级粘贴模式可用性
  items: AppItem[] // 复制的物品列表
  groupOrigins: Map<number, string> // 组原点映射 (groupId -> originItemId)
  structure: ClipboardStructure
}

export interface PasteResult {
  newIds: string[]
  /** 新建的组/集合根节点；未分组类别不能代表本次新增家具的范围。 */
  roots: Exclude<CollectionEntry, { kind: 'ungrouped' }>[]
}

export interface StepRepeatConfig {
  repeatCount: number
  positionDelta: { x: number; y: number; z: number }
  rotationDelta: { x: number; y: number; z: number }
  scaleMultiplier: { x: number; y: number; z: number }
}

// 判别联合类型：mode 决定哪些字段必须存在，避免运行时防御判断
export type AdvancedPasteOptions =
  { mode: 'preserveIds' } | { mode: 'stepRepeat'; stepRepeat: StepRepeatConfig }

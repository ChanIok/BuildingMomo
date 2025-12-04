import type { Ref, ShallowRef } from 'vue'
import type { ViewPreset } from '../composables/useThreeCamera'

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
  ColorMap?: Record<string, number>
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

// JSON文件根结构
export interface GameDataFile {
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

  // 核心数据 (使用 ShallowRef 优化性能)
  // items.value 是原生数组，AppItem 是原生对象
  items: ShallowRef<AppItem[]>

  // 选择集 (使用 ShallowRef)
  selectedItemIds: ShallowRef<Set<string>>

  // 视图配置 (Ref)
  currentViewConfig: Ref<{ scale: number; x: number; y: number } | undefined>
  viewState: Ref<ThreeViewState | undefined>

  // 历史记录栈 (ShallowRef)
  history: ShallowRef<HistoryStack | undefined>
}

// 文件监控状态
export interface FileWatchState {
  isActive: boolean // 是否正在监控
  dirHandle: FileSystemDirectoryHandle | null // 监控的目录句柄
  dirPath: string // 目录路径（用于显示）
  lastCheckedTime: number // 上次检查的时间戳
  lastModifiedTime: number // 文件的最后修改时间
  fileHandle: FileSystemFileHandle | null // 当前监控的文件句柄
  fileName: string // 文件名
  lastContent?: string // 上一次的文件内容（用于去重）
}

// 精确变换参数
export interface TransformParams {
  mode: 'relative' | 'absolute'
  position?: {
    x?: number
    y?: number
    z?: number
  }
  rotation?: {
    x?: number // 绕X轴旋转（对应游戏的Roll）
    y?: number // 绕Y轴旋转（对应游戏的Pitch）
    z?: number // 绕Z轴旋转（对应游戏的Yaw）
  }
}

// 工作坐标系配置
export interface WorkingCoordinateSystem {
  enabled: boolean // 是否启用工作坐标系
  rotationAngle: number // 旋转角度（以度为单位，0° = 全局坐标系）
}

// 历史记录快照
export interface HistorySnapshot {
  // 注意：items 保存的是对象引用的浅拷贝或深拷贝，取决于具体实现
  items: AppItem[] | null
  selectedItemIds: Set<string> // 选择状态快照
  timestamp: number // 时间戳
  type: 'edit' | 'selection' // 操作类型
}

// 历史记录栈
export interface HistoryStack {
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  maxSize: number // 最大历史记录数量
}

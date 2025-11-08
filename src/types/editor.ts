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

// 应用内部使用的物品数据结构
export interface AppItem {
  internalId: string // 内部唯一ID（用于Vue/Konva key）
  gameId: number // 原始游戏ItemID
  instanceId: number // 原始InstanceID
  x: number // 平面X坐标
  y: number // 平面Y坐标
  z: number // 高度Z坐标
  // 保留原始数据用于导出
  originalData: GameItem
}

// 高度过滤器配置
export interface HeightFilter {
  min: number
  max: number
  currentMin: number
  currentMax: number
}

// JSON文件根结构
export interface GameDataFile {
  NeedRestore?: boolean
  PlaceInfo: GameItem[]
}

// 家园方案（多文档架构）
export interface HomeScheme {
  id: string // 方案唯一ID
  name: string // 方案名称（从文件名提取）
  filePath?: string // 原始文件路径（可选）

  // 游戏路径相关
  sourceType?: 'manual' | 'game' // 来源类型：手动导入 vs 从游戏路径导入
  gameFilePath?: string // 完整的游戏文件路径（仅用于显示）
  gameFileHandle?: FileSystemFileHandle // 游戏文件句柄（用于直接写入）
  gameDirHandle?: FileSystemDirectoryHandle // 游戏目录句柄（BuildData 目录）

  // 每个方案独立的状态
  items: AppItem[]
  heightFilter: HeightFilter
  selectedItemIds: Set<string>
  initialViewConfig?: { scale: number; x: number; y: number }
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

import type { InstancedMesh, Matrix4, Raycaster } from 'three'
import type { Ref } from 'vue'

/**
 * 渲染模式返回值接口（各模式 composable 的统一返回结构）
 */
export interface RenderModeResult {
  /** 实例化网格对象 */
  mesh: Ref<InstancedMesh | null>
  /** 重建所有实例（完整刷新） */
  rebuild: () => Promise<void> | void
  /** 更新选中实例的矩阵（增量更新） */
  updateMatrix?: (idToWorldMatrixMap: Map<string, Matrix4>) => void
  /** 清理资源 */
  dispose: () => void
}

/**
 * 射线检测结果
 */
export interface RaycastHit {
  instanceId: number
  internalId: string
  distance: number
}

/**
 * 异步射线检测任务（用于取消）
 */
export interface RaycastTask {
  cancelled: boolean
}

/**
 * 统一的拾取配置（对外暴露）
 */
export interface PickingConfig {
  /**
   * 同步射线检测（用于框选等需要立即结果的场景）
   * @param raycaster - Three.js Raycaster 实例
   * @returns 拾取结果（最近的交点）或 null
   */
  performRaycast: (raycaster: Raycaster) => RaycastHit | null

  /**
   * 异步时间切片射线检测（用于 tooltip 等可接受延迟的场景）
   * 会自动取消上一次未完成的检测
   * @param raycaster - Three.js Raycaster 实例
   * @returns Promise，返回拾取结果或 null（被取消时也返回 null）
   */
  performRaycastAsync: (raycaster: Raycaster) => Promise<RaycastHit | null>

  /**
   * 取消当前进行中的异步检测
   */
  cancelRaycast: () => void

  /**
   * 当前模式的索引映射（只读）
   * index -> internalId
   */
  readonly indexToIdMap: Ref<ReadonlyMap<number, string>>
}

/**
 * 颜色管理器接口
 */
export interface ColorManager {
  /** 获取物品颜色（考虑 hover/选中/分组状态） */
  getItemColor: (itemId: string, type: 'box' | 'icon') => number
  /** 更新所有实例颜色 */
  updateAllColors: () => void
  /** 更新单个实例颜色 */
  updateColorById: (itemId: string) => void
  /** 设置 hover 物品 ID */
  setHoveredItemId: (id: string | null) => void
}

/**
 * 索引映射接口
 */
export interface IndexMapping {
  indexToIdMap: Ref<Map<number, string>>
  idToIndexMap: Ref<Map<string, number>>
}

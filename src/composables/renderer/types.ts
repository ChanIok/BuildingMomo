import type { InstancedMesh, Matrix4 } from 'three'
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

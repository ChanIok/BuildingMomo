import { Box3, Vector3 } from 'three'
import { getThreeModelManager, type ThreeModelManager } from '@/composables/useThreeModelManager'
import { useGameDataStore } from '@/stores/gameDataStore'
import type { AppItem } from '@/types/editor'
import { getAABBFromMatrix, getAABBFromMatrixAndModelBox } from './collision'
import { matrixTransform } from './matrixTransform'

// Box 模式 / fallback 模式使用单位立方体作为基础几何体；
// 实际尺寸已经编码在 world matrix 的 scale 中。
const UNIT_BOX_SIZE = new Vector3(1, 1, 1)

/**
 * 世界空间包围盒的派生信息。
 *
 * 这些指标主要服务于相机 framing、选区几何中心等“视觉空间”语义，
 * 避免各处重复从 Box3 手动提取 center / size / maxDim。
 */
export interface WorldBoundsMetrics {
  box: Box3
  center: Vector3
  size: Vector3
  maxDim: number
}

/**
 * 单次计算过程中的上下文缓存。
 *
 * - `gameDataStore` 用于判断物品是否存在模型配置
 * - `modelManager` 延迟初始化，只在确实需要模型包围盒时才创建
 *
 * 这样在批量计算多个 item 的 bounds 时，可以避免重复获取同类依赖。
 */
interface WorldBoundsContext {
  gameDataStore: ReturnType<typeof useGameDataStore>
  modelManager: ThreeModelManager | null
}

/**
 * 创建一次性 world bounds 计算上下文。
 */
function createWorldBoundsContext(): WorldBoundsContext {
  return {
    gameDataStore: useGameDataStore(),
    modelManager: null,
  }
}

/**
 * 获取单个物品可用的模型包围盒。
 *
 * 只有当该物品存在模型配置，且模型几何已经被模型管理器预热后，
 * 才能拿到真实模型包围盒；否则返回 null，后续自动回退到 box/furniture size 逻辑。
 */
function getItemModelBox(item: AppItem, context: WorldBoundsContext): Box3 | null {
  const modelConfig = context.gameDataStore.getFurnitureModelConfig(item.gameId)
  if (!modelConfig || modelConfig.meshes.length === 0) {
    return null
  }

  context.modelManager ??= getThreeModelManager()
  return context.modelManager.getModelBoundingBox(item.gameId)
}

/**
 * 在共享上下文中计算单个物品的世界空间 AABB。
 *
 * 优先级：
 * 1. 若模型包围盒可用，则使用“模型真实包围盒 + world matrix”
 * 2. 否则回退到 box 模式的基础几何体 AABB
 *
 * 注意这里统一返回的是“世界空间 AABB”，不是数据空间 bounds。
 */
function getItemWorldBoxWithContext(item: AppItem, context: WorldBoundsContext): Box3 {
  const modelBox = getItemModelBox(item, context)
  const worldMatrix = matrixTransform.buildWorldMatrixFromItem(item, modelBox !== null)

  if (modelBox) {
    return getAABBFromMatrixAndModelBox(worldMatrix, modelBox)
  }

  return getAABBFromMatrix(worldMatrix, UNIT_BOX_SIZE)
}

/**
 * 获取单个物品的世界空间 AABB。
 *
 * 适合一次性调用；若需要批量计算多个 item，优先使用 `getItemsWorldBox()`，
 * 这样可以复用内部上下文，减少重复依赖解析。
 */
export function getItemWorldBox(item: AppItem): Box3 {
  const context = createWorldBoundsContext()
  return getItemWorldBoxWithContext(item, context)
}

/**
 * 获取多个物品合并后的世界空间 AABB。
 *
 * 这是“选区 frame center / scene frame center”的基础数据来源。
 */
export function getItemsWorldBox(items: AppItem[]): Box3 | null {
  if (items.length === 0) return null

  const context = createWorldBoundsContext()
  let mergedBox: Box3 | null = null

  for (const item of items) {
    const itemBox = getItemWorldBoxWithContext(item, context)
    if (mergedBox) {
      mergedBox.union(itemBox)
    } else {
      mergedBox = itemBox.clone()
    }
  }

  return mergedBox
}

/**
 * 获取多个物品的世界空间包围盒指标。
 *
 * 相比只返回 `Box3`，这里额外提供：
 * - `center`：包围盒中心
 * - `size`：包围盒尺寸
 * - `maxDim`：三个轴中最大的尺寸，用于相机距离/缩放估算
 */
export function getItemsWorldBoundsMetrics(items: AppItem[]): WorldBoundsMetrics | null {
  const box = getItemsWorldBox(items)
  if (!box || box.isEmpty()) return null

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())

  return {
    box,
    center,
    size,
    maxDim: Math.max(size.x, size.y, size.z),
  }
}

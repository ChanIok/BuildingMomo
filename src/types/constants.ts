// 渲染相关的常量定义

export { MAX_RENDER_INSTANCES } from '@/lib/viewport/renderInstanceBudget'

// Scene / Selection bounds 超过此数量后，退化为“仅按物品原点”计算的粗略包围盒
export const SCENE_BOUNDS_ORIGIN_ONLY_THRESHOLD = 10000

// 射线检测跳过阈值：物品数超过此值时，相机移动期间跳过射线检测以避免卡顿
export const RAYCAST_SKIP_ITEM_THRESHOLD = 10000

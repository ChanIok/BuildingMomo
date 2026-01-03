/**
 * Three.js 实例化渲染器主入口
 *
 * 支持四种渲染模式：
 * - box: 完整体积渲染（基于家具尺寸）
 * - icon: 平面图标渲染（支持 billboard）
 * - simple-box: 简化方块渲染（固定尺寸）
 * - model: 3D 模型实例化渲染（按 itemId 分组）
 */
export { useThreeInstancedRenderer } from './core'
export type * from './types'

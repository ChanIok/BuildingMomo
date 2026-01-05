import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import { BufferGeometry, Mesh } from 'three'

/**
 * 初始化 BVH 加速
 *
 * 扩展 Three.js 原型，为所有 Mesh 启用 BVH 加速射线检测
 * 必须在任何 Three.js 对象创建之前调用
 */
export function initBVH() {
  // 扩展 Three.js 原型（three-mesh-bvh 提供了类型定义）
  BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
  BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
  Mesh.prototype.raycast = acceleratedRaycast

  console.log('[BVH] Three.js raycast acceleration enabled')
}

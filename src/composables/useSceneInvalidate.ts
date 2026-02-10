/**
 * 场景无效化工具（按需渲染模式）
 *
 * 当 TresCanvas 使用 render-mode="on-demand" 时，Three.js 对象的直接修改
 * （如 instanceMatrix、instanceColor）不会被 TresJS 自动检测。
 * 需要在这些修改后调用 invalidateScene() 来通知 TresJS 重新渲染。
 *
 * 注意：Vue props 的变化（如相机位置、clearColor）由 TresJS 自动检测，
 * 无需手动调用 invalidateScene()。
 */

let _invalidate: ((frames?: number) => void) | null = null

/**
 * 设置 TresJS 的 invalidate 函数（由 ThreeEditor 在 TresCanvas ready 时调用）
 */
export function setSceneInvalidate(fn: (frames?: number) => void) {
  _invalidate = fn
}

/**
 * 通知 TresJS 需要重新渲染一帧
 *
 * 在直接修改 Three.js 对象后调用：
 * - InstancedMesh.instanceMatrix / instanceColor 更新
 * - InstancedMesh.count 变化
 * - 离屏渲染目标内容更新（如 selection outline mask）
 */
export function invalidateScene() {
  _invalidate?.()
}

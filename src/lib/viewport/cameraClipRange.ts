import type { WorldBoundsMetrics } from './spatialBounds'

/** 与历史行为一致的最小远裁面，避免空场景或过近时 far 过小 */
const MIN_CLIP_FAR = 100_000

/** 包围盒角点相对相机的最远距离的安全系数 */
const CLIP_FAR_MARGIN = 1.08

/** 防止异常数值；大地图全览仍远低于此上限 */
const MAX_CLIP_FAR = 5e7

/**
 * 根据当前相机世界坐标与场景/选区合并 AABB，计算透视/正交相机的远裁面值。
 *
 * 用于大地图（坐标可达 ±1e6）下「框场景 / 全选预览」时避免固定 far 过小导致整屏被裁掉。
 */
export function computeClipFarFromWorldBounds(
  cameraWorld: readonly [number, number, number],
  metrics: WorldBoundsMetrics | null
): number {
  if (!metrics) return MIN_CLIP_FAR

  const min = metrics.box.min
  const max = metrics.box.max
  const cx = cameraWorld[0]
  const cy = cameraWorld[1]
  const cz = cameraWorld[2]

  let maxD = 0
  const xs = [min.x, max.x]
  const ys = [min.y, max.y]
  const zs = [min.z, max.z]

  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const dx = x - cx
        const dy = y - cy
        const dz = z - cz
        const d = Math.hypot(dx, dy, dz)
        if (d > maxD) maxD = d
      }
    }
  }

  const far = maxD * CLIP_FAR_MARGIN
  return Math.min(MAX_CLIP_FAR, Math.max(MIN_CLIP_FAR, far))
}

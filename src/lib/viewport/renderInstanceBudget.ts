/** 单方案实例化渲染的代码内硬顶（池按需扩容，不超过此数） */
export const MAX_RENDER_INSTANCES = 500_000

const POOL_MIN = 32
const POOL_HEADROOM = 16
const POOL_GROWTH = 1.5

/**
 * 实际要参与渲染/索引映射的实例数（不超过 {@link MAX_RENDER_INSTANCES}）。
 */
export function requiredInstanceCount(itemCount: number): number {
  return Math.min(Math.max(0, itemCount), MAX_RENDER_INSTANCES)
}

/**
 * 下一帧 InstancedMesh 应用分配的池容量（仅扩容，不缩容）。
 * @param required 当前需要的实例槽位数（已含硬顶裁剪）
 * @param currentAllocated 当前 mesh 的容量；0 表示尚未分配
 */
export function nextInstancedPoolCapacity(required: number, currentAllocated: number): number {
  const cap = MAX_RENDER_INSTANCES
  const need = Math.min(Math.max(0, required), cap)
  if (need === 0) return Math.min(POOL_MIN, cap)

  if (currentAllocated >= need) return currentAllocated

  if (currentAllocated === 0) {
    return Math.min(cap, Math.max(POOL_MIN, need + POOL_HEADROOM, Math.floor(need * POOL_GROWTH)))
  }

  const grown = Math.max(need + POOL_HEADROOM, Math.floor(currentAllocated * POOL_GROWTH), need)
  return Math.min(cap, Math.max(grown, POOL_MIN))
}

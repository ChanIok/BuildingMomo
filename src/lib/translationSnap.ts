import { Box3, Vector3 } from 'three'
import {
  getOBBProjectionRadius,
  getOBBSeparatingAxes,
  intersectsOBBAfterTranslation,
  type OBB,
} from './collision'

export interface TranslationSnapBody {
  id: string
  obb: OBB
  bounds: Box3
}

export interface TranslationSnapContact {
  movingId: string
  targetId: string
  /** 完整 SAT 轴索引：目标面、移动物面、双方边方向叉积。 */
  axis: number
  side: -1 | 1
}

export interface TranslationSnapResult {
  offset: Vector3
  contact: TranslationSnapContact
  distance: number
}

interface TranslationSnapOptions {
  moving: readonly TranslationSnapBody[]
  targets: readonly TranslationSnapBody[]
  /** 当前允许移动的世界空间正交单位向量；单轴一个，平面两个。 */
  movementAxes: readonly Vector3[]
  threshold: number
  preferredContact?: TranslationSnapContact | null
  releaseThreshold?: number
}

const EPSILON = 1e-6

export function createTranslationSnapBody(id: string, obb: OBB): TranslationSnapBody {
  return { id, obb, bounds: obb.getAABB() }
}

function sameContact(a: TranslationSnapContact, b?: TranslationSnapContact | null): boolean {
  return (
    !!b &&
    a.movingId === b.movingId &&
    a.targetId === b.targetId &&
    a.axis === b.axis &&
    a.side === b.side
  )
}

interface ContactCandidate {
  axis: number
  side: -1 | 1
  offset: Vector3
}

function getContactCandidates(
  moving: OBB,
  target: OBB,
  movementAxes: readonly Vector3[],
  limit: number
): ContactCandidate[] {
  const centerDelta = target.center.clone().sub(moving.center)
  const constraints = getOBBSeparatingAxes(moving, target).map((normal, axis) => ({
    normal,
    axis,
    center: centerDelta.dot(normal),
    radius: getOBBProjectionRadius(moving, normal) + getOBBProjectionRadius(target, normal),
  }))

  if (movementAxes.length === 1) {
    const direction = movementAxes[0]!
    let enter = -Infinity
    let exit = Infinity
    let enterContact: ContactCandidate | null = null
    let exitContact: ContactCandidate | null = null

    // 每条 SAT 轴约束 t 的一个区间，取交集就是沿拖拽直线能够接触/相交的区间。
    // 只保留最终两个边界，避免遗漏移动物的面或边对边接触，也不会选择穿透位置。
    for (const { normal, axis, center, radius } of constraints) {
      const speed = normal.dot(direction)
      if (Math.abs(speed) < EPSILON) {
        if (Math.abs(center) > radius + EPSILON) return []
        continue
      }
      const lowerSide = speed > 0 ? -1 : 1
      const lower = (center + lowerSide * radius) / speed
      const upper = (center - lowerSide * radius) / speed
      if (lower > enter) {
        enter = lower
        enterContact = { axis, side: lowerSide, offset: direction.clone().multiplyScalar(lower) }
      }
      if (upper < exit) {
        exit = upper
        exitContact = {
          axis,
          side: lowerSide === -1 ? 1 : -1,
          offset: direction.clone().multiplyScalar(upper),
        }
      }
      if (enter > exit + EPSILON) return []
    }
    return [enterContact, exitContact].filter(
      (contact): contact is ContactCandidate => !!contact && contact.offset.length() <= limit
    )
  }

  const candidates: ContactCandidate[] = []
  for (const { normal, axis, center, radius } of constraints) {
    const projectedNormal = new Vector3()
    for (const direction of movementAxes) {
      projectedNormal.addScaledVector(direction, normal.dot(direction))
    }
    const denominator = projectedNormal.lengthSq()
    if (denominator < EPSILON * EPSILON) continue
    for (const side of [-1, 1] as const) {
      const offset = projectedNormal.clone().multiplyScalar((center + side * radius) / denominator)
      if (offset.length() > limit) continue
      if (intersectsOBBAfterTranslation(moving, target, offset)) {
        candidates.push({ axis, side, offset })
      }
    }
  }
  return candidates
}

/**
 * 从原始拖拽位置求一次完整的接触修正。包围盒仅用于粗筛，最终接触由真实 OBB 验证。
 * 所有选中物共享返回的位移；函数不修改输入，也不把上一帧吸附位移累加到本帧。
 */
export function solveTranslationSnap({
  moving,
  targets,
  movementAxes,
  threshold,
  preferredContact,
  releaseThreshold = threshold,
}: TranslationSnapOptions): TranslationSnapResult | null {
  if (moving.length === 0 || movementAxes.length === 0 || threshold <= 0) return null

  const searchDistance = preferredContact ? Math.max(threshold, releaseThreshold) : threshold
  const selectionBounds = new Box3()
  for (const body of moving) selectionBounds.union(body.bounds)
  selectionBounds.expandByScalar(searchDistance)

  let best: TranslationSnapResult | null = null
  const pairBounds = new Box3()

  for (const target of targets) {
    if (!selectionBounds.intersectsBox(target.bounds)) continue

    for (const body of moving) {
      pairBounds.copy(body.bounds).expandByScalar(searchDistance)
      if (!pairBounds.intersectsBox(target.bounds)) continue

      const candidates = getContactCandidates(body.obb, target.obb, movementAxes, searchDistance)
      for (const { axis, side, offset } of candidates) {
        const contact: TranslationSnapContact = {
          movingId: body.id,
          targetId: target.id,
          axis,
          side,
        }
        const preferred = sameContact(contact, preferredContact)
        const limit = preferred ? searchDistance : threshold
        const distance = offset.length()
        if (distance > limit) continue
        if (!preferred && best && distance >= best.distance - EPSILON) continue

        const result = { offset, contact, distance }
        if (preferred) return result
        best = result
      }
    }
  }

  return best
}

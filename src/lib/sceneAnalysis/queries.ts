import {
  SceneAnalysisError,
  type AnalysisBox,
  type AnalysisPage,
  type AnalysisPageRequest,
  type AnalysisSnapshot,
} from './types'
import { freezeAnalysisValue, invalidInput } from './validation'

export function analysisPage<T>(
  items: readonly T[],
  request: AnalysisPageRequest
): AnalysisPage<T> {
  const { offset = 0, limit = 100 } = request
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    invalidInput('offset must be nonnegative; limit must be a positive integer')
  }
  const page = items.slice(offset, offset + limit)
  return freezeAnalysisValue({
    total: items.length,
    offset,
    nextOffset: offset + page.length < items.length ? offset + page.length : null,
    items: page,
  })
}

export function assertScopedIds<T extends string | number>(
  ids: readonly T[],
  available: ReadonlySet<T>
) {
  for (const id of ids) {
    if (!available.has(id))
      throw new SceneAnalysisError('out_of_scope', `ID is not in this snapshot: ${id}`)
  }
}

function unionBounds(boxes: readonly AnalysisBox[]): AnalysisBox | null {
  if (!boxes.length) return null
  const min = { ...boxes[0]!.min },
    max = { ...boxes[0]!.max }
  for (const box of boxes) {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], box.min[axis])
      max[axis] = Math.max(max[axis], box.max[axis])
    }
  }
  return { min, max }
}

export function getAnalysisSummary(snapshot: AnalysisSnapshot) {
  const boundsSources: Record<string, number> = {}
  const heights = new Map<number, number>()
  for (const item of snapshot.items) {
    const source = item.bounds?.source ?? 'unavailable'
    boundsSources[source] = (boundsSources[source] ?? 0) + 1
    heights.set(item.position.z, (heights.get(item.position.z) ?? 0) + 1)
  }
  return freezeAnalysisValue({
    snapshotId: snapshot.id,
    schemeId: snapshot.schemeId,
    coordinateSystem: snapshot.coordinateSystem,
    itemCount: snapshot.items.length,
    furnitureTypeCount: snapshot.furniture.length,
    groupCount: snapshot.groups.length,
    partialGroupCount: snapshot.groups.filter(
      (group) => group.scopedMemberCount < group.totalMemberCount
    ).length,
    ungroupedItemCount: snapshot.items.filter((item) => item.groupId <= 0).length,
    bounds: unionBounds(snapshot.items.flatMap((item) => (item.bounds ? [item.bounds] : []))),
    boundsSources,
    distinctOriginHeights: heights.size,
    commonOriginHeights: [...heights]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 20)
      .map(([z, count]) => ({ z, count })),
  })
}

import type { AppItem } from '@/types/editor'
import { buildDisplayWorldMatrixFromItem } from '@/lib/scaleRenderCompensation'
import { getSlidePathWorldPoints, isSlidePathItem } from '@/lib/slidePath'
import type { AnalysisSnapshot } from './types'
import type { AnalysisRenderSnapshot } from './images'
import { freezeAnalysisValue } from './validation'

/** Private, detached render inputs, captured in the same synchronous turn as the DTO.
 * Dye textures stay with the renderer; capture is allowed only while its projection
 * and this session are current. No GPU objects or mutable editor references escape.
 */
export function createAnalysisRenderSnapshot(
  snapshot: AnalysisSnapshot,
  items: readonly AppItem[],
  context: Omit<Parameters<typeof buildDisplayWorldMatrixFromItem>[1], 'currentMode'>
): AnalysisRenderSnapshot {
  const byId = new Map(items.map((item) => [item.internalId, item]))
  return freezeAnalysisValue({
    snapshotId: snapshot.id,
    items: snapshot.items.map((entry) => {
      const item = byId.get(entry.id)!
      const points = isSlidePathItem(item)
        ? getSlidePathWorldPoints(item).map(({ x, y, z }) => ({ x, y, z }))
        : null
      return {
        itemId: entry.id,
        gameId: entry.gameId,
        bounds: entry.bounds,
        points,
        worldMatrix:
          !points && entry.bounds?.source === 'model-aabb'
            ? buildDisplayWorldMatrixFromItem(item, {
                ...context,
                currentMode: 'model',
              }).worldMatrix.toArray()
            : null,
      }
    }),
  })
}

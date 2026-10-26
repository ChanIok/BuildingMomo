import { Vector3 } from 'three'
import type { AppItem } from '@/types/editor'
import { buildDisplayWorldMatrixFromItem } from '@/lib/scaleRenderCompensation'
import { getAABBFromMatrix, getAABBFromMatrixAndModelBox } from '@/lib/collision'
import { getSlidePathWorldBox, isSlidePathItem } from '@/lib/slidePath'
import type { AnalysisBounds } from './types'

type GeometryContext = Parameters<typeof buildDisplayWorldMatrixFromItem>[1]

/** Does not load or own models. Missing metadata/geometry is reported, not guessed. */
export function getAnalysisBounds(
  item: AppItem,
  context: Omit<GeometryContext, 'currentMode'>
): AnalysisBounds | null {
  const pathBox = isSlidePathItem(item) ? getSlidePathWorldBox(item) : null
  if (pathBox)
    return {
      source: 'slide-path',
      min: { x: pathBox.min.x, y: pathBox.min.y, z: pathBox.min.z },
      max: { x: pathBox.max.x, y: pathBox.max.y, z: pathBox.max.z },
    }
  const size = context.getFurnitureSize(item.gameId)
  const modelBox = context.getModelBoundingBox?.(item.gameId) ?? null
  if (!size && !modelBox) return null
  const result = buildDisplayWorldMatrixFromItem(item, { ...context, currentMode: 'model' })
  if (!size && !result.modelBox) return null
  const box = result.modelBox
    ? getAABBFromMatrixAndModelBox(result.worldMatrix, result.modelBox)
    : getAABBFromMatrix(result.worldMatrix, new Vector3(1, 1, 1))
  return {
    source: result.modelBox ? 'model-aabb' : 'furniture-box',
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  }
}

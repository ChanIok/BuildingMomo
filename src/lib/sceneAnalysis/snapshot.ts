import { collectionAncestors, isCollectionTree } from '@/lib/collectionTree'
import { matrixTransform } from '@/lib/matrixTransform'
import { visualScaleAxisToDataAxis } from '@/lib/selectionScaleTransform'
import {
  SceneAnalysisError,
  type AnalysisGroup,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
} from './types'
import {
  freezeAnalysisValue,
  invalidInput,
  readBox,
  readString,
  readStrings,
  readVector,
} from './validation'

/** Detached, frozen DTO. Capture scope is explicit; selection is not read here. */
export function createAnalysisSnapshot(input: AnalysisSnapshotInput): AnalysisSnapshot {
  readString(input.id, 'snapshot ID')
  readString(input.schemeId, 'scheme ID')
  const ids = new Set(readStrings(input.itemIds, 'item IDs'))
  if (!ids.size) invalidInput('Analysis scope is empty')
  if (!isCollectionTree(input.collectionTree)) invalidInput('Invalid source collection tree')
  const byId = new Map(input.items.map((item) => [item.internalId, item]))
  if (byId.size !== input.items.length) invalidInput('Duplicate source item IDs')
  for (const id of ids) {
    if (!byId.has(id)) throw new SceneAnalysisError('out_of_scope', `Unknown scope item: ${id}`)
  }

  const instanceIds = new Set<number>()
  for (const item of input.items) {
    if (!ids.has(item.internalId)) continue
    if (
      !Number.isSafeInteger(item.instanceId) ||
      item.instanceId <= 0 ||
      instanceIds.has(item.instanceId)
    ) {
      invalidInput(
        'Analysis scope requires unique positive InstanceIDs; resolve duplicate or invalid game IDs first'
      )
    }
    instanceIds.add(item.instanceId)
  }

  const counts = new Map<number, number>()
  const scopedGroups = new Map<number, number>()
  const totalGroups = new Map<number, number>()
  const items = input.items
    .filter((item) => ids.has(item.internalId))
    .map((item) => {
      counts.set(item.gameId, (counts.get(item.gameId) ?? 0) + 1)
      if (item.groupId > 0)
        scopedGroups.set(item.groupId, (scopedGroups.get(item.groupId) ?? 0) + 1)
      const rawBounds = input.getBounds(item)
      const bounds = rawBounds
        ? { ...readBox({ min: rawBounds.min, max: rawBounds.max }), source: rawBounds.source }
        : null
      return {
        id: item.internalId,
        instanceId: item.instanceId,
        gameId: item.gameId,
        groupId: item.groupId,
        position: readVector(matrixTransform.dataPositionToWorld(item)),
        rotation: readVector(matrixTransform.dataRotationToVisual(item.rotation)),
        scale: readVector(
          Object.fromEntries(
            (['x', 'y', 'z'] as const).map((axis) => [
              axis,
              item.extra.Scale?.[visualScaleAxisToDataAxis(axis)] ?? 1,
            ])
          )
        ),
        bounds,
      }
    })
  for (const item of input.items) {
    if (item.groupId > 0) totalGroups.set(item.groupId, (totalGroups.get(item.groupId) ?? 0) + 1)
  }
  const metadata = new Map(input.collectionTree.groups.map((group) => [group.groupId, group]))
  const groups: AnalysisGroup[] = [...scopedGroups].map(([groupId, scopedMemberCount]) => {
    const origin = input.groupOrigins.get(groupId)
    const group = metadata.get(groupId)
    return {
      groupId,
      name: group?.name ?? null,
      collectionId: group?.collectionId ?? null,
      scopedMemberCount,
      totalMemberCount: totalGroups.get(groupId)!,
      hasOrigin: origin !== undefined,
      originItemId: origin && ids.has(origin) ? origin : null,
    }
  })
  const nodes = new Map(input.collectionTree.nodes.map((node) => [node.id, node]))
  const ancestors = new Set(
    groups.flatMap((group) => collectionAncestors(nodes, group.collectionId))
  )
  const furniture = [...counts].map(([gameId, instanceCount]) => {
    const info = input.getFurniture(gameId)
    if (info && info.gameId !== gameId) invalidInput('Furniture ID does not match requested type')
    return {
      gameId,
      instanceCount,
      nameZh: info?.nameZh ?? null,
      nameEn: info?.nameEn ?? null,
      category: info?.category ? { ...info.category } : null,
      sizeCm: info?.sizeCm ? ([...info.sizeCm] as [number, number, number]) : null,
      iconUrl: info?.iconUrl ?? null,
    }
  })
  return freezeAnalysisValue({
    version: 1,
    id: input.id,
    schemeId: input.schemeId,
    coordinateSystem: {
      position: 'world-z-up',
      lengthUnit: 'cm',
      rotation: 'visual-degrees',
      scale: 'visual-axes',
    },
    items,
    furniture,
    groups,
    collections: input.collectionTree.nodes
      .filter((node) => ancestors.has(node.id))
      .map((node) => {
        const { originItemId, ...rest } = node
        return originItemId && ids.has(originItemId) ? { ...rest, originItemId } : rest
      }),
  } satisfies AnalysisSnapshot)
}

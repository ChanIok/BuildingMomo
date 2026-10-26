import { createAnalysisSnapshot } from '@/lib/sceneAnalysis/snapshot'
import type { AnalysisFurniture, AnalysisSnapshotInput } from '@/lib/sceneAnalysis/types'
import { makeAppItem } from './item'

export const analysisFurniture: AnalysisFurniture = {
  gameId: 1170000010,
  nameZh: '田园地板',
  nameEn: 'Pastoral Floor',
  category: { id: 5001, nameZh: '地板', nameEn: 'Floor', parentId: 5000 },
  sizeCm: [200, 200, 10],
  iconUrl: '/assets/furniture-icon/floor.webp',
}

export function analysisInput(): AnalysisSnapshotInput {
  return {
    id: 'snapshot-1',
    schemeId: 'scheme-1',
    itemIds: ['a', 'b', 'c'],
    items: [
      makeAppItem({ internalId: 'a', instanceId: 1000, x: 0, y: 20, z: 102, groupId: 7 }),
      makeAppItem({ internalId: 'b', instanceId: 1001, x: 220, y: 20, z: 102, groupId: 7 }),
      makeAppItem({ internalId: 'c', instanceId: 1002, gameId: 999, x: 400, y: 20, z: 502 }),
      makeAppItem({ internalId: 'outside', instanceId: 1003, gameId: 123, x: 1000, groupId: 7 }),
    ],
    collectionTree: {
      nodes: [
        { id: 'house', name: 'House', parentId: null, order: 0 },
        { id: 'room', name: 'Room', parentId: 'house', order: 0 },
        { id: 'private', name: 'Not in scope', parentId: null, order: 1 },
      ],
      groups: [{ groupId: 7, name: 'Existing floors', collectionId: 'room', order: 0 }],
    },
    groupOrigins: new Map([[7, 'outside']]),
    getFurniture: (id) => (id === analysisFurniture.gameId ? analysisFurniture : null),
    getBounds: (item) =>
      item.internalId === 'c'
        ? null
        : {
            min: { x: item.x - 100, y: -item.y - 100, z: item.z - 5 },
            max: { x: item.x + 100, y: -item.y + 100, z: item.z + 5 },
            source: 'furniture-box',
          },
  }
}

export function analysisSnapshot() {
  return createAnalysisSnapshot(analysisInput())
}

/** Editor-side command: internal UUIDs, consumed by readOrganizeItems. */
export function organizationCommand() {
  return {
    collections: [{ id: 'new-house', name: 'House', parentId: null, order: 0 }],
    groups: [
      { id: 'floor', name: 'Floor assembly', collectionId: 'new-house', itemIds: ['a', 'b'] },
    ],
  }
}

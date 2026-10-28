import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createAnalysisSnapshot } from '@/lib/sceneAnalysis/snapshot'
import { getAnalysisBounds } from '@/lib/sceneAnalysis/geometry'
import { SLIDE_PATH_GAME_ID } from '@/lib/slidePath'
import { analysisInput } from '../../fixtures/sceneAnalysis'
import { makeAppItem } from '../../fixtures/item'
import { createAnalysisRenderSnapshot } from '@/lib/sceneAnalysis/renderSnapshot'
import { buildDisplayWorldMatrixFromItem } from '@/lib/scaleRenderCompensation'

describe('analysis snapshot', () => {
  it('captures a detached explicit scope, deduplicated catalog and only relevant metadata', () => {
    const input = analysisInput()
    input.collectionTree.nodes[0]!.originItemId = 'outside'
    input.collectionTree.nodes[1]!.originItemId = 'a'
    const snapshot = createAnalysisSnapshot(input)
    expect(snapshot.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(snapshot.items[0]?.position).toEqual({ x: 0, y: -20, z: 102 })
    expect(snapshot.furniture.map((item) => [item.gameId, item.instanceCount])).toEqual([
      [1170000010, 2],
      [999, 1],
    ])
    expect(snapshot.furniture[1]?.nameZh).toBeNull()
    expect(snapshot.collections.map((node) => node.id)).toEqual(['house', 'room'])
    expect(snapshot.groups[0]).toMatchObject({
      totalMemberCount: 3,
      scopedMemberCount: 2,
      hasOrigin: true,
      originItemId: null,
    })
    expect(JSON.stringify(snapshot)).not.toContain('outside')
    expect(snapshot.collections[1]?.originItemId).toBe('a')
    input.items[0]!.rotation.x = 99
    input.collectionTree.nodes[0]!.name = 'Changed source'
    expect(snapshot.items[0]?.rotation.x).toBe(0)
    expect(snapshot.collections[0]?.name).toBe('House')
    expect(Object.isFrozen(input.items[0])).toBe(false)
    expect(Object.isFrozen(snapshot.furniture[0]?.sizeCm)).toBe(true)
    expect(() => {
      ;(snapshot.items[0]!.position as any).x = 99
    }).toThrow()
  })

  it('uses existing visual rotation and scale-axis semantics without changing the source', () => {
    const input = analysisInput()
    input.items[0] = makeAppItem({
      internalId: 'a',
      rotation: { x: 10, y: 20, z: 30 },
      extra: { AttachID: 0, Scale: { X: 2, Y: 3, Z: 4 } },
    })
    const first = createAnalysisSnapshot(input).items[0]!
    expect(first.rotation).toEqual({ x: 10, y: -20, z: 30 })
    expect(first.scale).toEqual({ x: 3, y: 2, z: 4 })
    expect(input.items[0].extra.Scale).toEqual({ X: 2, Y: 3, Z: 4 })
  })

  it('rejects empty, missing, duplicate scope IDs and invalid coordinates instead of silently dropping members', () => {
    for (const itemIds of [[], ['missing'], ['a', 'a']]) {
      expect(() => createAnalysisSnapshot({ ...analysisInput(), itemIds })).toThrow()
    }
    const input = analysisInput()
    input.items[0]!.x = Number.NaN
    expect(() => createAnalysisSnapshot(input)).toThrow(/finite/)
  })
})

describe('analysis geometry', () => {
  const context = {
    getFurnitureSize: () => [200, 100, 400] as [number, number, number],
    getModelConfig: () => ({ meshes: [{}] }),
    getModelBoundingBox: () => new Box3(new Vector3(-100, -50, 0), new Vector3(100, 50, 400)),
  }

  it('uses the production display matrix and reports the origin of conservative bounds', () => {
    const item = makeAppItem({
      gameId: 1170000318,
      x: 10,
      y: 20,
      z: 30,
      extra: { AttachID: 0, Scale: { X: 2, Y: 3, Z: 4 } },
    })
    expect(getAnalysisBounds(item, context)).toEqual({
      source: 'model-aabb',
      min: { x: -290, y: -120, z: 30 },
      max: { x: 310, y: 80, z: 1630 },
    })
    expect(getAnalysisBounds(item, { ...context, getModelBoundingBox: () => null })?.source).toBe(
      'furniture-box'
    )
    expect(
      getAnalysisBounds(item, {
        ...context,
        getFurnitureSize: () => null,
        getModelBoundingBox: () => null,
      })
    ).toBeNull()
    expect(
      getAnalysisBounds(item, {
        ...context,
        getFurnitureSize: () => null,
        getModelConfig: () => null,
      })
    ).toBeNull()
  })

  it('includes the existing floor XY anchor compensation for nonuniform scale', () => {
    const floor = makeAppItem({
      x: 10,
      y: 20,
      z: 30,
      extra: { AttachID: 0, Scale: { X: 2, Y: 3, Z: 4 } },
    })
    // Floor 1170000010 belongs to SCALE_RENDER_COMPENSATION_XY_GAME_IDS.
    // Its displayed origin shifts (-100, -50) relative to the raw world position.
    expect(getAnalysisBounds(floor, context)).toEqual({
      source: 'model-aabb',
      min: { x: -390, y: -170, z: 30 },
      max: { x: 210, y: 30, z: 1630 },
    })
  })

  it('keeps slide path geometry on the shared path-bounds entry point', () => {
    const item = makeAppItem({
      gameId: SLIDE_PATH_GAME_ID,
      extra: {
        AttachID: 0,
        Scale: { X: 1, Y: 1, Z: 1 },
        TempInfo: {
          points: [
            [0, 0, 0],
            [100, 0, 0],
          ],
        },
      },
    })
    expect(getAnalysisBounds(item, context)?.source).toBe('slide-path')
  })

  it('freezes matching display matrices and path points without upgrading fallback bounds later', () => {
    const input = analysisInput()
    input.items[0] = makeAppItem({
      internalId: 'a',
      extra: { AttachID: 0, Scale: { X: 2, Y: 3, Z: 4 } },
    })
    input.items[1] = makeAppItem({
      internalId: 'b',
      instanceId: 1001,
      gameId: SLIDE_PATH_GAME_ID,
      extra: {
        AttachID: 0,
        TempInfo: {
          points: [
            [0, 0, 0],
            [100, 0, 0],
          ],
        },
      },
    })
    input.getBounds = (item) =>
      getAnalysisBounds(
        item,
        item.internalId === 'c' ? { ...context, getModelBoundingBox: () => null } : context
      )
    const snapshot = createAnalysisSnapshot(input)
    const captured = createAnalysisRenderSnapshot(snapshot, input.items, context)
    expect(captured.items[0]?.worldMatrix).toEqual(
      buildDisplayWorldMatrixFromItem(input.items[0]!, {
        ...context,
        currentMode: 'model',
      }).worldMatrix.toArray()
    )
    expect(captured.items[1]?.points).toHaveLength(2)
    expect(captured.items[2]?.worldMatrix).toBeNull()
    const json = JSON.stringify(captured)
    input.items[0]!.x += 100
    input.items[1]!.extra.TempInfo!.points[1]![0] = 500
    expect(JSON.stringify(captured)).toBe(json)
    expect(Object.isFrozen(captured.items[0]?.worldMatrix)).toBe(true)
    expect(Object.isFrozen(input.items[1]!.extra.TempInfo!.points)).toBe(false)
  })
})

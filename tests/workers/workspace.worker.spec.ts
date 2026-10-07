import { describe, expect, it, vi } from 'vitest'
import { expose } from 'comlink'
import type { WorkspaceWorkerApi } from '@/workers/workspace.worker'
import { makeAppItem } from '../fixtures/item'

vi.mock('comlink', () => ({ expose: vi.fn() }))
vi.mock('@/lib/workspaceSnapshotStore', () => ({ saveWorkspaceSnapshot: vi.fn() }))

await import('@/workers/workspace.worker')
const api = vi.mocked(expose).mock.calls[0]![0] as WorkspaceWorkerApi

describe('workspace scale validation', () => {
  it.each(['X', 'Y', 'Z'] as const)('matches server rounding on Scale.%s', (axis) => {
    api.updateFurnitureConstraints({
      '1170000010': {
        scaleRange: [0.699999988079071, 1.2999999523162842],
        colorSchemes: [],
      },
    })
    const values = [0.699999958276, 0.699999958277, 0.7, 1.3, 1.30000001192, 1.300000011921]
    const items = values.map((value, i) =>
      makeAppItem({
        internalId: String(i),
        extra: { Scale: { X: 1, Y: 1, Z: 1, [axis]: value }, AttachID: 0 },
      })
    )

    const result = api.validate(items, {
      enableDuplicateDetection: false,
      enableLimitDetection: true,
    })
    expect(result.limitIssues.invalidScaleItemIds).toEqual(['0', '5'])
    expect(items.map((item) => item.extra.Scale[axis])).toEqual(values)
    expect(
      api.validate(items, {
        enableDuplicateDetection: false,
        enableLimitDetection: false,
      }).limitIssues.invalidScaleItemIds
    ).toEqual([])
  })

  it('accepts both midpoint ties for a fixed scale of 1', () => {
    api.updateFurnitureConstraints({
      '1170000010': { scaleRange: [1, 1], colorSchemes: [] },
    })
    const values = [
      0.999999970197, 0.9999999701976776123046875, 1.000000059604644775390625, 1.000000059605,
    ]
    const items = values.map((value, i) =>
      makeAppItem({
        internalId: String(i),
        extra: { Scale: { X: value, Y: value, Z: value }, AttachID: 0 },
      })
    )
    expect(
      api.validate(items, {
        enableDuplicateDetection: false,
        enableLimitDetection: true,
      }).limitIssues.invalidScaleItemIds
    ).toEqual(['0', '3'])
  })
})

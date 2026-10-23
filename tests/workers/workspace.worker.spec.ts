import { describe, expect, it, vi } from 'vitest'
import { expose } from 'comlink'
import type { WorkspaceWorkerApi } from '@/workers/workspace.worker'
import type { WorkspaceSnapshot } from '@/types/persistence'
import { saveWorkspaceSnapshot } from '@/lib/workspaceSnapshotStore'
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

it('persists directory folds without furniture validation, replacement or modification timestamps', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('postMessage', vi.fn())
  const items = [makeAppItem({ internalId: 'one' }), makeAppItem({ internalId: 'two' })]
  const snapshot: WorkspaceSnapshot = {
    version: 1,
    updatedAt: 0,
    editor: {
      schemes: [
        {
          id: 'scheme',
          name: 'Scheme',
          items,
          selectedItemIds: new Set(),
          groupOrigins: new Map(),
          lastModified: 10,
        },
      ],
    },
    tab: {
      tabs: [{ id: 'tab', type: 'scheme', title: 'Scheme', schemeId: 'scheme' }],
      activeTabId: 'tab',
    },
  }
  const meta = {
    tabs: snapshot.tab.tabs,
    activeTabId: 'tab',
    schemes: [{ id: 'scheme', name: 'Scheme', lastModified: 10 }],
  }
  try {
    await api.initWorkspace(snapshot)
    api.updateSettings({
      enableAutoSave: true,
      enableDuplicateDetection: true,
      enableLimitDetection: true,
    })
    vi.mocked(saveWorkspaceSnapshot).mockClear()
    const result = await api.updateState({
      meta,
      collectionViewStates: [{ id: 'scheme', collapsedCollectionIds: new Set(['house']) }],
    })
    expect(result).toEqual({})
    expect(snapshot.editor.schemes[0]!.items).toBe(items)
    expect(snapshot.editor.schemes[0]!.lastModified).toBe(10)
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveWorkspaceSnapshot).toHaveBeenCalledOnce()
    expect(
      vi.mocked(saveWorkspaceSnapshot).mock.calls[0]![0].editor.schemes[0]!.collapsedCollectionIds
    ).toEqual(new Set(['house']))
    const fullUpdate = await api.updateState({
      meta,
      activeSchemeData: {
        id: 'scheme',
        items,
        selectedItemIds: new Set(),
        currentViewConfig: undefined,
        viewState: undefined,
        groupOrigins: new Map(),
      },
      collectionViewStates: [],
    })
    expect(fullUpdate.validation?.duplicateGroups).toEqual([['one', 'two']])
    // 原有仅更新结构的调用方仍按既定契约执行校验。
    expect((await api.updateState({ meta })).validation).toBeDefined()
  } finally {
    api.updateSettings({ enableAutoSave: false })
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

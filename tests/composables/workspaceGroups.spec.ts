import { UNCLASSIFIED } from '@/lib/collectionTree'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useWorkspaceWorker } from '@/composables/useWorkspaceWorker'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTabStore } from '@/stores/tabStore'
import { makeAppItem, groupNamesOf, setGroupNames } from '../fixtures/item'
import type { WorkspaceSnapshot } from '@/types/persistence'
import type { WorkspaceWorkerApi } from '@/workers/workspace.worker'
import { useEditorOrganization } from '@/composables/editor/useEditorOrganization'

const state = vi.hoisted(() => ({
  disposers: [] as Array<() => void>,
  load: vi.fn(),
  api: {
    initWorkspace: vi
      .fn<(snapshot: WorkspaceSnapshot) => Promise<void>>()
      .mockResolvedValue(undefined),
    updateState: vi.fn<WorkspaceWorkerApi['updateState']>().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({}),
  },
}))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onUnmounted: (dispose: () => void) => state.disposers.push(dispose),
}))
vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/workers/client', () => ({ workerApi: state.api }))
vi.mock('@/lib/workspaceSnapshotStore', () => ({ loadWorkspaceSnapshot: state.load }))

let scope: EffectScope
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  scope = effectScope()
  state.disposers = []
  vi.clearAllMocks()
})
afterEach(() => {
  for (const dispose of state.disposers) dispose()
  scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('saves names and personal group flags in workspace snapshots and restores protected selections safely', async () => {
  const store = useEditorStore()
  store.createScheme('groups')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({ groupId: 7 }),
    makeAppItem({ internalId: 'loose', groupId: 0 }),
  ]
  scheme.hiddenGroupIds.value = new Set([0, 7])
  scheme.lockedGroupIds.value = new Set([0, 7])
  scheme.collectionTree.value = {
    nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
    groups: [{ groupId: 7, collectionId: 'house', order: 0 }],
  }
  setGroupNames(scheme, [[7, 'Walls']])
  scheme.collapsedCollectionIds.value = new Set(['house', UNCLASSIFIED])
  scheme.hiddenCollectionIds.value = new Set(['house', UNCLASSIFIED])
  scheme.lockedCollectionIds.value = new Set(['house', UNCLASSIFIED])
  scheme.selectedItemIds.value = new Set(['item-1'])
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  const snapshot = structuredClone(state.api.initWorkspace.mock.calls[0]![0])
  expect(snapshot.editor.schemes[0]!.collectionTree?.groups).toContainEqual({
    groupId: 7,
    name: 'Walls',
    collectionId: 'house',
    order: 0,
  })
  expect(snapshot.editor.schemes[0]!.hiddenGroupIds).toEqual(new Set([0, 7]))
  expect(snapshot.editor.schemes[0]!.collectionTree).toEqual(scheme.collectionTree.value)
  expect(snapshot.editor.schemes[0]!.collapsedCollectionIds).toEqual(
    new Set(['house', UNCLASSIFIED])
  )
  await vi.runOnlyPendingTimersAsync()
  expect(state.api.updateState.mock.calls.at(-1)![0].schemeData?.[0]).toMatchObject({
    collectionTree: scheme.collectionTree.value,
    lockedGroupIds: new Set([0, 7]),
  })
  state.load.mockResolvedValue({ snapshot, source: 'primary' })
  await workspace.restore()
  expect(groupNamesOf(store.activeScheme!).get(7)).toBe('Walls')
  expect(store.activeScheme!.hiddenGroupIds.value).toEqual(new Set([0, 7]))
  expect(store.isItemVisible('loose')).toBe(false)
  expect(store.effectiveLockedGroupIds.has(0)).toBe(true)
  expect(store.renderItemIds).toEqual(new Set())
  expect(store.activeScheme!.lockedGroupIds.value).toEqual(new Set([0, 7]))
  expect(store.activeScheme!.collectionTree.value.groups[0]?.collectionId).toBe('house')
  expect(store.activeScheme!.hiddenCollectionIds.value).toEqual(new Set(['house', UNCLASSIFIED]))
  expect(store.activeScheme!.lockedCollectionIds.value).toEqual(new Set(['house', UNCLASSIFIED]))
  expect(store.activeScheme!.collapsedCollectionIds.value).toEqual(new Set(['house', UNCLASSIFIED]))
  expect(store.activeScheme!.selectedItemIds.value.size).toBe(0)
})

it('persists and restores a direct organization with collection IDs, member assignments and unaffected origins', async () => {
  const store = useEditorStore()
  store.createScheme('organized')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({ internalId: 'a' }),
    makeAppItem({ internalId: 'b', instanceId: 1001, groupId: 7 }),
  ]
  scheme.groupOrigins.value = new Map([[7, 'b']])
  const organization = scope.run(() => useEditorOrganization())!
  const result = organization.organize(
    {
      collections: [{ id: 'house', name: 'House', parentId: null }],
      groups: [{ id: 'single', name: 'Single', collectionId: 'house', itemIds: ['a'] }],
    },
    { schemeId: scheme.id, sceneVersion: store.sceneVersion }
  )
  expect(result.regroupedItemCount).toBe(1)
  const expected = structuredClone({
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
  })
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  const saved = structuredClone(state.api.initWorkspace.mock.calls[0]![0])
  expect(saved.editor.schemes[0]!.collectionTree).toEqual(expected.tree)
  state.load.mockResolvedValue({ snapshot: saved, source: 'primary' })
  await workspace.restore()
  expect(store.activeScheme!.items.value).toEqual(expected.items)
  expect(store.activeScheme!.collectionTree.value).toEqual(expected.tree)
  expect(store.activeScheme!.groupOrigins.value).toEqual(expected.origins)
  expect(store.activeScheme!.maxGroupId.value).toBe(8)
})

it('coalesces folds into lightweight state without resending furniture or clearing validation', async () => {
  const store = useEditorStore()
  store.createScheme('folds')
  const scheme = store.activeScheme!
  scheme.items.value = Array.from({ length: 500 }, (_, i) =>
    makeAppItem({ internalId: `item-${i}`, groupId: i + 1 })
  )
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  await vi.advanceTimersByTimeAsync(300)
  state.api.updateState.mockClear()
  scheme.collapsedCollectionIds.value = new Set(['a'])
  scheme.collapsedCollectionIds.value = new Set(['b'])
  await vi.advanceTimersByTimeAsync(300)
  expect(state.api.updateState).toHaveBeenCalledTimes(1)
  const payload = state.api.updateState.mock.calls[0]![0]
  expect(payload.schemeData).toBeUndefined()
  expect(payload.collectionViewStates).toEqual([
    { id: scheme.id, collapsedCollectionIds: new Set(['b']) },
  ])
})

it('retains pending folds across a scheme switch and merges content with view updates', async () => {
  const store = useEditorStore()
  store.createScheme('first')
  const first = store.activeScheme!
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  await vi.advanceTimersByTimeAsync(300)
  state.api.updateState.mockClear()
  first.collapsedCollectionIds.value = new Set(['first-folder'])
  store.createScheme('second')
  const second = store.activeScheme!
  second.collapsedCollectionIds.value = new Set(['second-folder'])
  second.items.value = [makeAppItem()]
  store.triggerSceneUpdate()
  await nextTick()
  await vi.advanceTimersByTimeAsync(300)
  expect(state.api.updateState).toHaveBeenCalledTimes(1)
  const payload = state.api.updateState.mock.calls[0]![0]
  expect(payload.schemeData?.find((s) => s.id === second.id)?.items).toEqual(second.items.value)
  expect(payload.collectionViewStates).toEqual([
    { id: first.id, collapsedCollectionIds: new Set(['first-folder']) },
    { id: second.id, collapsedCollectionIds: new Set(['second-folder']) },
  ])
  expect(payload.immediate).toBe(true)
})

it('reads the latest folds after monitoring is disabled and resumed instead of replaying an old queued value', async () => {
  const store = useEditorStore()
  store.createScheme('resume')
  const scheme = store.activeScheme!
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  await vi.advanceTimersByTimeAsync(300)
  state.api.updateState.mockClear()
  scheme.collapsedCollectionIds.value = new Set(['old'])
  const settings = useSettingsStore().settings
  settings.enableAutoSave = false
  settings.enableDuplicateDetection = false
  settings.enableLimitDetection = false
  await nextTick()
  scheme.collapsedCollectionIds.value = new Set(['latest'])
  settings.enableAutoSave = true
  await nextTick()
  await vi.advanceTimersByTimeAsync(300)
  const payload = state.api.updateState.mock.calls.at(-1)![0]
  expect(payload.schemeData?.find((s) => s.id === scheme.id)?.collapsedCollectionIds).toEqual(
    new Set(['latest'])
  )
  expect(payload.collectionViewStates).toEqual([
    { id: scheme.id, collapsedCollectionIds: new Set(['latest']) },
  ])
})

it('restores a published version-1 workspace without collection metadata', async () => {
  const store = useEditorStore()
  store.createScheme('legacy')
  const scheme = store.activeScheme!
  scheme.items.value = [makeAppItem({ groupId: 7 })]
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  const legacy = structuredClone(state.api.initWorkspace.mock.calls[0]![0]) as WorkspaceSnapshot
  legacy.version = 1
  delete legacy.editor.schemes[0]!.collectionTree
  state.load.mockResolvedValue({ snapshot: legacy, source: 'primary' })
  await workspace.restore()
  expect(store.activeScheme!.collectionTree.value).toEqual({ nodes: [], groups: [] })
  setGroupNames(store.activeScheme!, [[7, 'Walls']])
  await vi.runOnlyPendingTimersAsync()
  const update = state.api.updateState.mock.calls.at(-1)![0].schemeData![0]!
  expect(update.collectionTree?.groups[0]?.name).toBe('Walls')
})

it('syncs a background organization before switching back and keeps unrelated furniture out of later updates', async () => {
  const editor = useEditorStore()
  editor.createScheme('A')
  const a = editor.activeScheme!
  a.items.value = [makeAppItem({ internalId: 'a' })]
  editor.createScheme('B')
  const b = editor.activeScheme!
  b.items.value = [makeAppItem({ internalId: 'b' })]
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()
  await vi.advanceTimersByTimeAsync(300)
  const saved = structuredClone(state.api.initWorkspace.mock.calls[0]![0])
  state.api.updateState.mockClear()
  const organization = scope.run(() => useEditorOrganization())!
  organization.organize(
    {
      collections: [],
      groups: [{ id: 'x', name: 'Background', collectionId: null, itemIds: ['a'] }],
    },
    { schemeId: a.id, sceneVersion: editor.sceneVersion }
  )
  await vi.advanceTimersByTimeAsync(300)
  const payload = state.api.updateState.mock.calls[0]![0]
  const content = payload.schemeData!.find((s) => s.id === a.id)!
  expect(content.items[0]?.groupId).toBe(1)
  expect(content.collectionTree?.groups[0]?.name).toBe('Background')
  expect(editor.activeScheme).toBe(b)
  Object.assign(
    saved.editor.schemes.find((s) => s.id === a.id)!,
    structuredClone(content)
  )
  state.load.mockResolvedValue({ snapshot: saved, source: 'primary' })
  await workspace.restore()
  expect(editor.getSchemeById(a.id)!.items.value[0]?.groupId).toBe(1)
  expect(editor.getSchemeById(a.id)!.collectionTree.value.groups[0]?.name).toBe('Background')
  await vi.advanceTimersByTimeAsync(300)
  state.api.updateState.mockClear()
  editor.triggerSceneUpdate()
  await vi.advanceTimersByTimeAsync(300)
  expect(state.api.updateState.mock.calls.at(-1)![0].schemeData?.map((s) => s.id)).toEqual([b.id])

  // A background edit also reaches the worker while a document is in focus.
  useTabStore().openDocTab('faq')
  organization.organize(
    {
      collections: [],
      groups: [{ id: 'y', name: 'From document', collectionId: null, itemIds: ['a'] }],
    },
    { schemeId: a.id, sceneVersion: editor.sceneVersion }
  )
  await vi.advanceTimersByTimeAsync(300)
  expect(editor.activeScheme).toBeNull()
  expect(
    state.api.updateState.mock.calls.at(-1)![0].schemeData?.find((s) => s.id === a.id)?.items[0]
      ?.groupId
  ).toBe(2)
})

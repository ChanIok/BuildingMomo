import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useWorkspaceWorker } from '@/composables/useWorkspaceWorker'
import { makeAppItem } from '../fixtures/item'
import type { WorkspaceSnapshot } from '@/types/persistence'
import type { WorkspaceWorkerApi } from '@/workers/workspace.worker'

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

it('omits per-scheme local scopes from full and incremental workspace snapshots and restores normal mode', async () => {
  const store = useEditorStore()
  store.createScheme('test')
  store.activeScheme!.items.value = [makeAppItem()]
  store.enterLocalEditing(['item-1'])
  const workspace = scope.run(() => useWorkspaceWorker())!
  await workspace.startMonitoring()

  const snapshot: WorkspaceSnapshot = state.api.initWorkspace.mock.calls[0]![0]
  expect(snapshot.editor.schemes[0]).not.toHaveProperty('localEditingItemIds')
  await vi.runOnlyPendingTimersAsync()
  expect(state.api.updateState).toHaveBeenCalled()
  const update = state.api.updateState.mock.calls[0]![0]
  expect(update.activeSchemeData).not.toHaveProperty('localEditingItemIds')
  expect(update.meta.schemes[0]).not.toHaveProperty('localEditingItemIds')

  state.load.mockResolvedValue({ snapshot: structuredClone(snapshot), source: 'primary' })
  await workspace.restore()
  expect(store.localEditingItemIds).toBeNull()
  store.enterLocalEditing(['item-1'])
  expect(store.localEditingItemIds).toEqual(new Set(['item-1']))
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, shallowRef, type EffectScope } from 'vue'
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThreeInstancedRenderer } from '@/composables/renderer/core'
import { makeAppItem } from '../fixtures/item'

const state = vi.hoisted(() => ({
  model: null as any,
  disposers: [] as Array<() => void>,
  outline: {
    reconcileMaskMeshes: vi.fn(),
    updateMasks: vi.fn(),
    updateMatrices: vi.fn(),
    renderMaskPass: vi.fn(),
    renderOverlay: vi.fn(),
    syncSceneTransform: vi.fn(),
    dispose: vi.fn(),
  },
}))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onUnmounted: (dispose: () => void) => state.disposers.push(dispose),
}))
vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => ({ isInitialized: true, furnitureDBRevision: 1 }),
}))
vi.mock('@/composables/renderer/modes/useModelMode', () => ({
  MODEL_FALLBACK_MESH_KEY: '-1',
  useModelMode: () => state.model,
}))
vi.mock('@/composables/renderer/shared/useSelectionOutline', () => ({
  useSelectionOutline: () => state.outline,
}))

let scope: EffectScope
let mesh: InstancedMesh

beforeEach(() => {
  vi.clearAllMocks()
  state.disposers = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('window', globalThis)
  setActivePinia(createPinia())
  scope = effectScope()
  mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3)
  mesh.count = 3
  for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, new Matrix4())
  const ids = new Map([
    [0, 'selected'],
    [1, 'a'],
    [2, 'b'],
  ])
  state.model = {
    meshMap: shallowRef(new Map([['model', mesh]])),
    meshToLocalIndexMap: shallowRef(new Map([[mesh, ids]])),
    indexToIdMap: shallowRef(ids),
    internalIdToMeshInfo: shallowRef(
      new Map([...ids].map(([localIndex, id]) => [id, { meshKey: 'model', localIndex }]))
    ),
    fallbackMesh: shallowRef(null),
    structureChanged: true,
    cancelPending: vi.fn(),
    clearScene: vi.fn(),
    hideInstances: vi.fn(),
    dispose: vi.fn(),
    rebuild: vi.fn(async () => true),
  }
})

afterEach(() => {
  scope.stop()
  for (const dispose of state.disposers) dispose()
  mesh.geometry.dispose()
  ;(mesh.material as MeshBasicMaterial).dispose()
  mesh.dispose()
  vi.unstubAllGlobals()
})

it('updates model sidebar type hover outlines without rebuilding or changing scene data', async () => {
  const store = useEditorStore()
  store.createScheme('hover')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({ internalId: 'selected', groupId: 1 }),
    makeAppItem({ internalId: 'a', groupId: 2 }),
    makeAppItem({ internalId: 'b', groupId: 3, gameId: 1170000020 }),
  ]
  scheme.selectedItemIds.value = new Set(['selected', 'b'])
  useSettingsStore().settings.threeDisplayMode = 'model'
  const ui = useUIStore()
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  const colors = vi.spyOn(mesh, 'setColorAt')
  const matrices = vi.spyOn(mesh, 'setMatrixAt')
  state.outline.updateMasks.mockClear()
  const rebuildCount = state.model.rebuild.mock.calls.length
  const sceneVersion = store.sceneVersion
  const selectionVersion = store.selectionVersion

  ui.sidebarHoveredGameId = 1170000020
  await nextTick()
  expect(state.outline.updateMasks).toHaveBeenCalledExactlyOnceWith(
    new Set(['selected', 'b']),
    new Set(['b']),
    state.model.meshMap.value,
    state.model.internalIdToMeshInfo.value,
    null
  )
  ui.sidebarHoveredGameId = null
  await nextTick()
  expect(state.outline.updateMasks).toHaveBeenLastCalledWith(
    new Set(['selected', 'b']),
    null,
    state.model.meshMap.value,
    state.model.internalIdToMeshInfo.value,
    null
  )
  expect(colors).not.toHaveBeenCalled()
  expect(matrices).not.toHaveBeenCalled()
  expect(state.model.rebuild).toHaveBeenCalledTimes(rebuildCount)
  expect(scheme.selectedItemIds.value).toEqual(new Set(['selected', 'b']))
  expect(store.sceneVersion).toBe(sceneVersion)
  expect(store.selectionVersion).toBe(selectionVersion)
})

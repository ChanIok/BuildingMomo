import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { Color, Matrix4, OrthographicCamera, Raycaster, Vector3 } from 'three'
import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { useTabStore } from '@/stores/tabStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useThreeInstancedRenderer } from '@/composables/renderer/core'
import { useSlidePathRenderer } from '@/composables/renderer/useSlidePathRenderer'
import { diffRenderItems, selectRenderItems } from '@/composables/renderer/shared/renderItems'
import { MAX_RENDER_INSTANCES } from '@/lib/renderInstanceBudget'
import { SLIDE_PATH_GAME_ID } from '@/lib/slidePath'
import { SELECTED_ITEM_COLOR } from '@/composables/renderer/shared/interactionColors'

const state = vi.hoisted(() => ({
  disposers: [] as Array<() => void>,
  load: null as null | ((ids: number[]) => Promise<void>),
}))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onUnmounted: (dispose: () => void) => state.disposers.push(dispose),
}))
vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => ({
    isInitialized: true,
    furnitureDBRevision: 1,
    getFurnitureSize: () => [100, 100, 100],
    getFurnitureModelConfig: () => undefined,
  }),
}))
vi.mock('@/composables/useThreeIconManager', async () => {
  const { Data3DTexture } = await import('three')
  const texture = new Data3DTexture()
  return {
    getThreeIconManager: () => ({
      initTextureArray: () => texture,
      getTextureArray: () => texture,
      getCurrentCapacity: () => 32,
      getUnloadedIcons: (ids: number[]) => ids,
      preloadIcons: async (
        ids: number[],
        progress: (current: number, total: number, failed: number) => void
      ) => {
        await state.load?.(ids)
        progress(ids.length, ids.length, 0)
      },
      getTextureIndex: () => 0,
    }),
    disposeThreeIconManager: () => {},
  }
})

let scope: EffectScope
beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  scope = effectScope()
  state.disposers = []
  state.load = null
})
afterEach(() => {
  scope.stop()
  useLoadingStore().cancelLoading()
  for (const dispose of state.disposers) dispose()
  vi.unstubAllGlobals()
})

function item(id: string, groupId: number, x = 0, z = 0): AppItem {
  return {
    internalId: id,
    groupId,
    gameId: 1,
    instanceId: 1000 + id.length,
    x,
    y: 0,
    z,
    rotation: { x: 0, y: 0, z: 0 },
    extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: { '0': 0 } },
  }
}

function setup() {
  const store = useEditorStore()
  store.createScheme('visibility')
  const scheme = store.activeScheme!
  const items = [item('outside', 8, 0, 300), item('inside', 7), item('peer', 0, 300)]
  scheme.items.value = items
  store.triggerSceneUpdate()
  return { store, scheme, items }
}

describe('render input projection', () => {
  it('retains original item references and filters before the render budget', () => {
    const outside = item('outside', 8),
      inside = item('inside', 7)
    const items = [outside, inside]
    expect(selectRenderItems(items, null)).toBe(items)
    expect(selectRenderItems(items, new Set(['inside', 'peer']))).toEqual([inside])
    expect(selectRenderItems(items, new Set(['inside', 'peer']))[0]).toBe(inside)
    const large = [...Array<AppItem>(MAX_RENDER_INSTANCES).fill(outside), inside]
    expect(selectRenderItems(large, null)).toHaveLength(MAX_RENDER_INSTANCES)
    expect(selectRenderItems(large, new Set(['inside']))).toEqual([inside])
    expect(large).toHaveLength(MAX_RENDER_INSTANCES + 1)
  })

  it('treats visibility changes as instance additions/removals without changing the document', () => {
    const { items } = setup()
    const full = new Map(items.map((item) => [item.internalId, item]))
    const subset = selectRenderItems(items, new Set(['inside', 'peer']))
    expect(diffRenderItems(full, subset)).toEqual(new Map([['outside', null]]))
    const previous = new Map(subset.map((item) => [item.internalId, item]))
    expect(diffRenderItems(previous, items)).toEqual(new Map([['outside', items[0]]]))
    expect(items.map((item) => item.groupId)).toEqual([8, 7, 0])
  })
})

describe.each(['box', 'simple-box', 'icon'] as const)('%s visibility and indices', (mode) => {
  it('hides group instances and pick candidates without touching data', async () => {
    const { store, scheme, items } = setup()
    useSettingsStore().settings.threeDisplayMode = mode
    const renderer = scope.run(() => useThreeInstancedRenderer())!
    const meshRef =
      mode === 'box'
        ? renderer.instancedMesh
        : mode === 'icon'
          ? renderer.iconInstancedMesh
          : renderer.simpleBoxInstancedMesh
    const ray = new Raycaster(new Vector3(0, 0, 1000), new Vector3(0, 0, -1))
    await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    store.setGroupHidden(8, true)
    await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
    expect(meshRef.value!.count).toBe(2)
    expect(renderer.interactionAdapter.value.pick(ray)?.internalId).toBe('inside')
    expect(scheme.items.value).toBe(items)
    store.showOnly({ kind: 'group', id: 7 })
    await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
    expect(meshRef.value!.count).toBe(1)
    expect(renderer.interactionAdapter.value.pick(ray)?.internalId).toBe('inside')
    const peerRay = new Raycaster(new Vector3(300, 0, 1000), new Vector3(0, 0, -1))
    expect(renderer.interactionAdapter.value.pick(peerRay)).toBeNull()
    store.setGroupLocked(7, true)
    expect(meshRef.value!.count).toBe(1)
    store.showAllGroups()
    await vi.waitFor(() => expect(meshRef.value!.count).toBe(3))
    expect(store.isItemEditable('inside')).toBe(false)
  })

  it('retains visible furniture when showing all instead of resetting its instance count', async () => {
    const { store } = setup()
    useSettingsStore().settings.threeDisplayMode = mode
    const renderer = scope.run(() => useThreeInstancedRenderer())!
    const meshRef =
      mode === 'box'
        ? renderer.instancedMesh
        : mode === 'icon'
          ? renderer.iconInstancedMesh
          : renderer.simpleBoxInstancedMesh
    await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
    store.setGroupHidden(8, true)
    await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
    const mesh = meshRef.value!
    const counts: number[] = []
    let count = mesh.count
    Object.defineProperty(mesh, 'count', {
      configurable: true,
      get: () => count,
      set: (value) => {
        count = value
        counts.push(value)
      },
    })
    store.showAllGroups()
    expect(meshRef.value).toBe(mesh)
    expect(mesh.count).toBeGreaterThanOrEqual(2)
    await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
    expect(counts).not.toContain(0)
    expect(mesh.count).toBe(3)
  })

  it('keeps visibility and interaction consistent through tab switches, previews and showing all', async () => {
    const { store, scheme, items } = setup()
    const tabs = useTabStore()
    const settings = useSettingsStore()
    settings.settings.threeDisplayMode = mode
    const renderer = scope.run(() => useThreeInstancedRenderer())!
    const meshRef =
      mode === 'box'
        ? renderer.instancedMesh
        : mode === 'icon'
          ? renderer.iconInstancedMesh
          : renderer.simpleBoxInstancedMesh
    const ray = (x = 0) => new Raycaster(new Vector3(x, 0, 1000), new Vector3(0, 0, -1))
    await vi.waitFor(() =>
      expect(renderer.interactionAdapter.value.pick(ray())?.internalId).toBe('outside')
    )
    const material = meshRef.value!.material
    store.setGroupHidden(8, true)
    await vi.waitFor(() =>
      expect(renderer.interactionAdapter.value.pick(ray())?.internalId).toBe('inside')
    )
    expect(meshRef.value!.count).toBe(2)
    expect(meshRef.value!.material).toBe(material)
    expect(meshRef.value!.children).toHaveLength(0)
    expect(scheme.items.value).toBe(items)
    scheme.selectedItemIds.value = new Set(['inside'])
    store.triggerSelectionUpdate()
    store.createScheme('other')
    expect(renderer.interactionAdapter.value.pick(ray())).toBeNull()
    const other = store.activeScheme!
    other.items.value = [item('other-hidden', 8, 0, 300), item('other-visible', 0)]
    store.triggerSceneUpdate()
    store.setGroupHidden(8, true)
    await vi.waitFor(() =>
      expect(renderer.interactionAdapter.value.pick(ray())?.internalId).toBe('other-visible')
    )
    tabs.openDocTab('guide')
    expect(renderer.interactionAdapter.value.pick(ray())).toBeNull()
    tabs.openSchemeTab(scheme.id, 'visibility')
    await vi.waitFor(() =>
      expect(renderer.interactionAdapter.value.pick(ray())?.internalId).toBe('inside')
    )
    expect(meshRef.value!.count).toBe(2)
    const selected = new Color()
    meshRef.value!.getColorAt(0, selected)
    expect(selected.getHex()).toBe(SELECTED_ITEM_COLOR)
    const camera = new OrthographicCamera(-1000, 1000, 1000, -1000, 1, 2000)
    camera.position.set(0, 0, 1000)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const candidates: string[] = []
    renderer.interactionAdapter.value.forEachRegionCenterCandidate(
      camera,
      { width: 100, height: 100 },
      (candidate) => candidates.push(candidate.internalId)
    )
    expect(candidates).toEqual(['inside', 'peer'])
    renderer.updateSelectedInstancesMatrix(
      new Map([['inside', new Matrix4().makeScale(100, 100, 100).setPosition(600, 0, 0)]])
    )
    expect(renderer.interactionAdapter.value.pick(ray(600))?.internalId).toBe('inside')
    expect(store.itemsMap.get('inside')!.x).toBe(0)
    store.showAllGroups()
    await vi.waitFor(() =>
      expect(renderer.interactionAdapter.value.pick(ray())?.internalId).toBe('outside')
    )
    expect(meshRef.value!.count).toBe(3)
    expect(meshRef.value!.material).toBe(material)
    tabs.openSchemeTab(other.id, 'other')
    await vi.waitFor(() =>
      expect(renderer.interactionAdapter.value.pick(ray())?.internalId).toBe('other-visible')
    )
    expect(meshRef.value!.count).toBe(1)
  })
})

it('never publishes a group hidden during asynchronous icon loading', async () => {
  const { store } = setup()
  useSettingsStore().settings.threeDisplayMode = 'icon'
  let finish!: () => void
  state.load = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  store.setGroupHidden(8, true)
  state.load = null
  finish()
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  expect(renderer.iconInstancedMesh.value!.count).toBe(2)
  const ray = new Raycaster(new Vector3(0, 0, 1000), new Vector3(0, 0, -1))
  expect(renderer.interactionAdapter.value.pick(ray)?.internalId).toBe('inside')
})

it('retains icon matrices, colors and texture slots while an expanding pool waits for textures', async () => {
  const { store, scheme, items } = setup()
  useSettingsStore().settings.threeDisplayMode = 'icon'
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  const mesh = renderer.iconInstancedMesh.value!
  const attributes = mesh.geometry.getAttribute('textureIndex')
  attributes.setX(1, 7)
  attributes.setX(2, 11)
  mesh.setColorAt(2, new Color(0x123456))
  let finish: (() => void) | undefined
  state.load = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  store.setGroupHidden(8, true)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(mesh.count).toBe(2)
  expect(attributes.getX(0)).toBe(7)
  expect(attributes.getX(1)).toBe(11)
  const color = new Color()
  mesh.getColorAt(1, color)
  expect(color.getHex()).toBe(0x123456)
  const matrix = new Matrix4()
  mesh.getMatrixAt(1, matrix)
  expect(matrix.elements[12]).toBe(300)
  state.load = null
  finish!()
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))

  // 模拟实例池建立后，又有隐藏家具通过远端更新加入。
  scheme.items.value = [
    ...items,
    ...Array.from({ length: 80 }, (_, i) => item(`remote${i}`, 8, i * 300)),
  ]
  store.triggerSceneUpdate()
  await nextTick()
  await vi.waitFor(() => expect(mesh.count).toBe(2))
  finish = undefined
  state.load = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  store.showAllGroups()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(false))
  expect(renderer.iconInstancedMesh.value).toBe(mesh)
  expect(mesh.count).toBe(2)
  const ray = new Raycaster(new Vector3(0, 0, 1000), new Vector3(0, 0, -1))
  expect(renderer.interactionAdapter.value.pick(ray)).toBeNull()
  mesh.getMatrixAt(0, matrix)
  const before = matrix.clone()
  renderer.updateSelectedInstancesMatrix(
    new Map([['inside', new Matrix4().makeTranslation(900, 0, 0)]])
  )
  mesh.getMatrixAt(0, matrix)
  expect(matrix.equals(before)).toBe(true)
  state.load = null
  finish!()
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  expect(renderer.iconInstancedMesh.value!.count).toBe(83)
  expect(renderer.iconInstancedMesh.value).not.toBe(mesh)
})

it('keeps the latest icon intersection visible when show-all is superseded by show-only', async () => {
  const { store } = setup()
  useSettingsStore().settings.threeDisplayMode = 'icon'
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  store.setGroupHidden(8, true)
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  const mesh = renderer.iconInstancedMesh.value!
  let finish!: () => void
  state.load = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  store.showAllGroups()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(mesh.count).toBe(2)
  store.showOnly({ kind: 'ungrouped', id: 0 })
  expect(renderer.iconInstancedMesh.value).toBe(mesh)
  expect(mesh.count).toBe(1)
  const matrix = new Matrix4()
  mesh.getMatrixAt(0, matrix)
  expect(matrix.elements[12]).toBe(300)
  state.load = null
  finish()
  await vi.waitFor(() => expect(renderer.isInteractionReady.value).toBe(true))
  expect(mesh.count).toBe(1)
  const ray = new Raycaster(new Vector3(300, 0, 1000), new Vector3(0, 0, -1))
  expect(renderer.interactionAdapter.value.pick(ray)?.internalId).toBe('peer')
})

it('updates the visible subset after transactions, undo and redo without modifying outsiders', async () => {
  const { store, scheme, items } = setup()
  useSettingsStore().settings.threeDisplayMode = 'simple-box'
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  store.setGroupHidden(8, true)
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(2))
  const history = useEditorHistory()
  history.recordTransaction('remove.peer', () => {
    scheme.items.value = scheme.items.value.filter((item) => item.internalId !== 'peer')
    store.triggerSceneUpdate()
  })
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(1))
  history.undo()
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(2))
  history.redo()
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(1))
  expect(scheme.hiddenGroupIds.value).toEqual(new Set([8]))
  expect(scheme.items.value[0]).toBe(items[0])
})

it('keeps other group visibility unchanged when moving and regrouping visible furniture', async () => {
  const { store, scheme, items } = setup()
  useSettingsStore().settings.threeDisplayMode = 'simple-box'
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  store.setGroupHidden(8, true)
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(2))
  const hidden = scheme.hiddenGroupIds.value
  const history = useEditorHistory()
  history.recordTransaction('regroup.and.move', () => {
    scheme.items.value = scheme.items.value.map((item) =>
      item.internalId === 'inside' ? { ...item, groupId: 42, x: 900 } : item
    )
    store.triggerSceneUpdate()
  })
  const ray = new Raycaster(new Vector3(900, 0, 1000), new Vector3(0, 0, -1))
  await vi.waitFor(() =>
    expect(renderer.interactionAdapter.value.pick(ray)?.internalId).toBe('inside')
  )
  expect(renderer.simpleBoxInstancedMesh.value!.count).toBe(2)
  expect(scheme.hiddenGroupIds.value).toBe(hidden)
  expect(scheme.items.value[0]).toBe(items[0])
})

it('renders new furniture, keeps hidden furniture after deleting visible items, and restores on undo', async () => {
  const { store, scheme, items } = setup()
  useSettingsStore().settings.threeDisplayMode = 'simple-box'
  const renderer = scope.run(() => useThreeInstancedRenderer())!
  store.setGroupHidden(8, true)
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(2))
  const added = useEditorItemAdd().addFurnitureItem(1)!
  expect(added.groupId).toBe(0)
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(3))
  useEditorSelection().selectAll()
  useEditorManipulation().deleteSelected()
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(0))
  expect(scheme.items.value).toEqual([items[0]])
  useEditorHistory().undo()
  await vi.waitFor(() => expect(renderer.simpleBoxInstancedMesh.value?.count).toBe(3))
})

it('filters slide-path segments and nodes through group visibility', () => {
  const { store, scheme } = setup()
  scheme.items.value = [7, 8].map((group, index) => ({
    ...item(`path${group}`, group, index * 1000),
    gameId: SLIDE_PATH_GAME_ID,
    extra: {
      Scale: { X: 1, Y: 1, Z: 1 },
      TempInfo: {
        points: [
          [0, 0, 0],
          [100, 0, 0],
        ],
      },
    },
  }))
  store.triggerSceneUpdate()
  const renderer = scope.run(() => useSlidePathRenderer())!
  expect(renderer.segmentMesh.value!.count).toBe(2)
  expect(renderer.pointMesh.value!.count).toBe(4)
  store.setGroupHidden(8, true)
  expect(renderer.segmentMesh.value!.count).toBe(1)
  expect(renderer.pointMesh.value!.count).toBe(2)
  store.showAllGroups()
  expect(renderer.segmentMesh.value!.count).toBe(2)
  expect(renderer.pointMesh.value!.count).toBe(4)
})

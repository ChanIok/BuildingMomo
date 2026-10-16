import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BoxGeometry, Group, InstancedMesh, MeshBasicMaterial } from 'three'
import { useLoadingStore } from '../../src/stores/loadingStore'
import { useModelMode } from '../../src/composables/renderer/modes/useModelMode'

const state = vi.hoisted(() => ({
  editor: {
    activeScheme: null as any,
    sceneVersion: 0,
    getRenderChanges: vi.fn(() => null as any),
  },
  settings: { modelAssetProfile: 'full', materialAssetProfile: 'full' },
  layer: null as any,
  available: true,
  ready: vi.fn(),
  prepare: vi.fn(),
}))
vi.mock('@/stores/editorStore', () => ({ useEditorStore: () => state.editor }))
vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => ({
    furnitureDBRevision: 1,
    getFurnitureModelConfig: () => undefined,
    getFurnitureSize: () => [100, 100, 100],
  }),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: state.settings,
  }),
}))
vi.mock('@/composables/useFurnitureRender', () => ({
  furnitureRender: {
    get value() {
      return state.available ? state.layer : null
    },
  },
  readyFurnitureRender: () => state.ready(),
}))
vi.mock('@/composables/useSceneInvalidate', () => ({ invalidateScene: vi.fn() }))

function item(id: string, gameId = 1) {
  return {
    internalId: id,
    gameId,
    x: 0,
    y: 0,
    z: 0,
    rotation: { x: 0, y: 0, z: 0 },
    extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: {} },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('window', globalThis)
  vi.useFakeTimers()
  state.settings.modelAssetProfile = 'full'
  state.settings.materialAssetProfile = 'full'
  state.editor.activeScheme = { id: 'scheme-a', items: { value: [item('a')] } }
  state.editor.sceneVersion = 0
  state.editor.getRenderChanges.mockReset().mockReturnValue(null)
  state.prepare.mockReset().mockResolvedValue(undefined)
  state.available = true
  state.ready.mockReset().mockImplementation(async () => state.layer)
  const batches = new Map<number, InstancedMesh>(),
    instances = new Map<string, { mesh: InstancedMesh; index: number }>()
  const insert = (items: any[]) => {
    for (const entry of items) {
      let mesh = batches.get(entry.assetId)
      if (!mesh) {
        mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 32)
        mesh.count = 0
        batches.set(entry.assetId, mesh)
      }
      const existing = instances.get(entry.id)
      const index = existing?.index ?? mesh.count++
      mesh.setMatrixAt(index, entry.matrix)
      instances.set(entry.id, { mesh, index })
    }
  }
  state.layer = {
    root: new Group(),
    batches,
    getConfig: () => ({ componentCount: 1, customData: [0], colorings: {} }),
    getModelBounds: () => undefined,
    getInstance: (id: string) => instances.get(id),
    getBatchInstances: (id: number) =>
      [...instances].filter(([, entry]) => entry.mesh === batches.get(id)).map(([id]) => id),
    load: vi.fn(async () => {}),
    setTiers: vi.fn(async (_selection, task) => {
      const total = batches.size
      if (total) {
        task.onProgress?.({ phase: 'loading', completed: total, total })
        task.onProgress?.({ phase: 'preparing', completed: total, total })
        await state.prepare()
        task.signal?.throwIfAborted()
      }
      task.onProgress?.({ phase: 'ready', completed: instances.size, total: instances.size })
    }),
    replaceAll: vi.fn(async (items, task) => {
      const total = new Set(items.map((item: any) => item.assetId)).size
      for (let completed = 1; completed <= total; completed++) {
        task.onProgress?.({ phase: 'loading', completed, total })
      }
      if (total) {
        task.onProgress?.({ phase: 'preparing', completed: total, total })
        await state.prepare()
      }
      task.signal?.throwIfAborted()
      batches.clear()
      instances.clear()
      insert(items)
      task.onProgress?.({ phase: 'ready', completed: items.length, total: items.length })
    }),
    upsert: vi.fn(async (items, task) => {
      insert(items)
      task.onProgress?.({ phase: 'ready', completed: items.length, total: items.length })
    }),
    updateMatrices: vi.fn(),
    updateDyes: vi.fn(),
    remove: vi.fn((ids: string[]) => {
      for (const id of ids) {
        const entry = instances.get(id)
        if (!entry) continue
        instances.delete(id)
        entry.mesh.count--
        if (!entry.mesh.count) {
          for (const [assetId, mesh] of batches) if (mesh === entry.mesh) batches.delete(assetId)
        }
      }
    }),
  }
})
afterEach(() => {
  useLoadingStore().cancelLoading()
  for (const mesh of state.layer.batches.values()) {
    mesh.geometry.dispose()
    mesh.material.dispose()
    mesh.dispose()
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('publishes mappings after readiness and hides the layer when leaving a scheme', async () => {
  state.editor.activeScheme.items.value = [item('a'), item('b'), item('c', 2)]
  let finish!: () => void
  state.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const mode = useModelMode(),
    loading = useLoadingStore()
  const pending = mode.rebuild()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(mode.meshMap.value.size).toBe(0)
  expect(loading.phase).toBe('shaders')
  expect(loading.current).toBe(2)
  expect(loading.total).toBe(2)
  expect(loading.isLoading).toBe(true)
  vi.advanceTimersByTime(1000)
  expect(loading.isVisible).toBe(true)
  finish()
  expect(await pending).toBe(true)
  expect(mode.idToIndexMap.value.has('a')).toBe(true)
  expect(loading.isLoading).toBe(false)
  expect(loading.current).toBe(2)
  expect(loading.total).toBe(2)
  expect(loading.progress).toBe(100)
  mode.clearScene()
  expect(state.layer.root.visible).toBe(false)
  expect(mode.idToIndexMap.value.size).toBe(0)
  mode.dispose()
})

it('sends ordinary edits through the incremental API without replacing meshes or reloading assets', async () => {
  const mode = useModelMode()
  await mode.rebuild()
  const visible = mode.meshMap.value
  const next = { ...item('a'), x: 42 }
  state.editor.activeScheme.items.value = [next]
  state.editor.sceneVersion++
  state.editor.getRenderChanges.mockReturnValue(new Map([['a', next]]))
  expect(await mode.rebuild()).toBe(true)
  expect(mode.meshMap.value).toBe(visible)
  expect(mode.structureChanged).toBe(false)
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  expect(state.layer.load).toHaveBeenCalledTimes(1)
  expect(state.layer.updateMatrices.mock.calls[0][0][0].matrix.elements[12]).toBe(42)
  expect(state.layer.updateDyes).toHaveBeenCalledTimes(1)
  mode.dispose()
})

it("does not clear another owner's loading session when leaving a scheme", async () => {
  const mode = useModelMode(),
    loading = useLoadingStore()
  await mode.rebuild()
  const session = loading.startLoading('environment', 10, 'staged', { showDelayMs: 0 })
  loading.setPhase('shaders', 10, session)
  loading.updateProgress(4, 0, session)
  mode.clearScene()
  expect(loading.isLoading).toBe(true)
  expect(loading.loadingType).toBe('environment')
  expect(loading.current).toBe(4)
  expect(loading.total).toBe(10)
  mode.dispose()
  expect(loading.isLoading).toBe(true)
})

it('retires hidden batches before preloading and preserves progress across a scheme switch', async () => {
  state.editor.activeScheme.items.value = [item('a'), item('a2'), item('a3')]
  const mode = useModelMode(),
    loading = useLoadingStore()
  await mode.rebuild()
  mode.clearScene()
  state.editor.activeScheme = { id: 'scheme-b', items: { value: [item('b', 2), item('c', 3)] } }
  state.layer.load.mockImplementation(async () => {
    expect(state.layer.batches.size).toBe(0)
  })
  const reports: Array<{ phase: string; progress: number }> = []
  const stop = loading.$onAction(({ name, after }) => {
    if (name === 'setPhase' || name === 'updateProgress') {
      after(() => reports.push({ phase: loading.phase, progress: loading.progress }))
    }
  })
  try {
    expect(await mode.rebuild()).toBe(true)
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]!.progress).toBeGreaterThanOrEqual(reports[i - 1]!.progress)
    }
    expect(reports.some((report) => report.phase === 'processing')).toBe(true)
    expect(state.layer.replaceAll).toHaveBeenCalledTimes(2)
    expect(state.layer.remove).toHaveBeenCalledExactlyOnceWith(['a3', 'a2', 'a'])
  } finally {
    stop()
    mode.dispose()
  }
})

it('reconciles editor mappings when resuming model mode without replacing cached instances', async () => {
  const mode = useModelMode()
  await mode.rebuild()
  const mesh = state.layer.getInstance('a').mesh
  state.editor.getRenderChanges.mockReturnValue(new Map())
  mode.setVisible(false)
  await mode.rebuild()
  expect(mode.structureChanged).toBe(true)
  expect(state.layer.root.visible).toBe(true)
  expect(state.layer.getInstance('a').mesh).toBe(mesh)
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  expect(state.layer.upsert).not.toHaveBeenCalled()
  expect(useLoadingStore().isVisible).toBe(false)
  mode.dispose()
})

it('retains asset counts across both material tiers without an empty loading stage', async () => {
  state.editor.activeScheme.items.value = [item('a'), item('b'), item('c', 2)]
  const mode = useModelMode(),
    loading = useLoadingStore()
  await mode.rebuild()
  const setPhase = vi.spyOn(loading, 'setPhase')
  const updateProgress = vi.spyOn(loading, 'updateProgress')

  for (const material of ['lite', 'full']) {
    setPhase.mockClear()
    updateProgress.mockClear()
    let finish!: () => void
    state.prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    state.settings.materialAssetProfile = material
    const pending = mode.rebuild()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    vi.advanceTimersByTime(1000)
    expect(loading.isLoading).toBe(true)
    expect(loading.isVisible).toBe(true)
    expect(loading.current).toBe(2)
    expect(loading.total).toBe(2)
    finish()
    expect(await pending).toBe(true)
    expect(loading.isLoading).toBe(false)
    expect(loading.progress).toBe(100)
    expect(loading.current).toBe(2)
    expect(loading.total).toBe(2)
    expect(setPhase.mock.calls.map(([phase, total]) => [phase, total])).toEqual([
      ['network', 2],
      ['shaders', 2],
    ])
    expect(updateProgress.mock.calls.map(([completed]) => completed)).toEqual([2, 2])
  }
  expect(state.layer.load).toHaveBeenCalledTimes(2)
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  expect(state.layer.upsert).not.toHaveBeenCalled()
  expect(mode.idToIndexMap.value.size).toBe(3)
  mode.dispose()
})

it('keeps asset failures visible when committing fallback furniture', async () => {
  state.editor.activeScheme.items.value = [item('a'), item('b', 2)]
  state.layer.load.mockImplementation(async ([id]: number[]) => {
    if (id === 2) throw new Error('missing model')
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let finish!: () => void
  state.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const mode = useModelMode(),
    loading = useLoadingStore()
  try {
    const pending = mode.rebuild()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    vi.advanceTimersByTime(200)
    finish()
    expect(await pending).toBe(true)
    expect(loading.isLoading).toBe(false)
    expect(loading.progress).toBe(100)
    expect(loading.failedCount).toBe(1)
    expect(mode.idToIndexMap.value.size).toBe(2)
    expect(mode.fallbackMesh.value?.count).toBe(1)
  } finally {
    warning.mockRestore()
    mode.dispose()
  }
})

it('does not invent model loading work for an all-fallback scheme', async () => {
  state.layer.getConfig = () => undefined
  const mode = useModelMode(),
    loading = useLoadingStore()
  const updateProgress = vi.spyOn(loading, 'updateProgress')
  expect(await mode.rebuild()).toBe(true)
  expect(loading.isLoading).toBe(false)
  expect(loading.isVisible).toBe(false)
  expect(loading.total).toBe(0)
  expect(updateProgress).not.toHaveBeenCalled()
  expect(mode.idToIndexMap.value.has('a')).toBe(true)
  mode.dispose()
})

it('does not cancel another task when an untracked fallback build is aborted', async () => {
  state.layer.getConfig = () => undefined
  let finish!: () => void
  state.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  state.layer.replaceAll.mockImplementationOnce(
    async (_items: unknown, task: { signal: AbortSignal }) => {
      await state.prepare()
      task.signal.throwIfAborted()
    }
  )
  const mode = useModelMode(),
    loading = useLoadingStore()
  const pending = mode.rebuild()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const session = loading.startLoading('environment', 10, 'staged', { showDelayMs: 0 })
  mode.clearScene()
  finish()
  expect(await pending).toBe(false)
  expect(loading.isLoading).toBe(true)
  expect(loading.loadingType).toBe('environment')
  loading.updateProgress(3, 0, session)
  expect(loading.current).toBe(3)
  mode.dispose()
})

it('cancels an old scheme before it can publish and reports real preparation failures', async () => {
  let finish!: () => void
  state.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const mode = useModelMode()
  const pending = mode.rebuild()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  mode.clearScene()
  state.editor.activeScheme = { id: 'scheme-b', items: { value: [item('b')] } }
  finish()
  expect(await pending).toBe(false)
  state.prepare.mockRejectedValueOnce(new Error('shader link failed'))
  await expect(mode.rebuild()).rejects.toThrow('shader link failed')
  expect(useLoadingStore().error).toBe('shader link failed')
  expect(await mode.rebuild()).toBe(true)
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['b'])
  mode.dispose()
})

it.each(['resolve', 'reject'] as const)(
  'ends loading immediately on a mode switch and ignores a late download %s',
  async (outcome) => {
    let finish!: () => void
    state.layer.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = outcome === 'resolve' ? resolve : () => reject(new Error('Aborted download'))
        })
    )
    const mode = useModelMode(),
      loading = useLoadingStore()
    try {
      const pending = mode.rebuild()
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      expect(loading.isLoading).toBe(true)
      mode.cancelPending()
      expect(loading.isLoading).toBe(false)
      expect(loading.isVisible).toBe(false)

      const session = loading.startLoading('environment', 10, 'staged', { showDelayMs: 0 })
      loading.updateProgress(4, 0, session)
      finish()
      expect(await pending).toBe(false)
      expect(loading.loadingType).toBe('environment')
      expect(loading.isLoading).toBe(true)
      expect(loading.current).toBe(4)
      expect(state.layer.replaceAll).not.toHaveBeenCalled()
    } finally {
      mode.dispose()
    }
  }
)

it('cleans up loading on a stale early return even without an explicit cancellation', async () => {
  let finish!: () => void
  let stale = false
  state.layer.load.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const mode = useModelMode(),
    loading = useLoadingStore()
  try {
    const pending = mode.rebuild({ isStale: () => stale })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    stale = true
    finish()
    expect(await pending).toBe(false)
    expect(loading.isLoading).toBe(false)
    expect(loading.isVisible).toBe(false)
  } finally {
    mode.dispose()
  }
})

it('reports a manifest failure and clears the error on a successful rebuild', async () => {
  state.available = false
  state.ready.mockRejectedValueOnce(new Error('Furniture manifest HTTP 503'))
  const mode = useModelMode(),
    loading = useLoadingStore()
  try {
    await expect(mode.rebuild()).rejects.toThrow('Furniture manifest HTTP 503')
    expect(loading.error).toBe('Furniture manifest HTTP 503')
    expect(loading.isVisible).toBe(true)
    expect(loading.isLoading).toBe(false)
    state.ready.mockImplementationOnce(async () => {
      state.available = true
      return state.layer
    })
    expect(await mode.rebuild()).toBe(true)
    expect(loading.error).toBeNull()
    expect(loading.isLoading).toBe(false)
    expect(mode.idToIndexMap.value.has('a')).toBe(true)
  } finally {
    mode.dispose()
  }
})

it('ignores a cancelled manifest failure without overwriting a newer loading session', async () => {
  state.available = false
  let fail!: (error: Error) => void
  state.ready.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  const mode = useModelMode(),
    loading = useLoadingStore()
  try {
    const pending = mode.rebuild()
    expect(loading.isLoading).toBe(true)
    mode.cancelPending()
    const session = loading.startLoading('environment', 10, 'staged', { showDelayMs: 0 })
    loading.updateProgress(4, 0, session)
    fail(new Error('Furniture manifest HTTP 503'))
    expect(await pending).toBe(false)
    expect(loading.error).toBeNull()
    expect(loading.loadingType).toBe('environment')
    expect(loading.isLoading).toBe(true)
    expect(loading.current).toBe(4)
  } finally {
    mode.dispose()
  }
})

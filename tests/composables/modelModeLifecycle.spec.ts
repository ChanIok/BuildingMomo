import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three'
import { useLoadingStore } from '../../src/stores/loadingStore'
import { useModelMode } from '../../src/composables/renderer/modes/useModelMode'
import { invalidateScene } from '../../src/composables/useSceneInvalidate'

const state = vi.hoisted(() => ({
  editor: {
    activeScheme: null as any,
    sceneVersion: 0,
    renderItemIds: null as ReadonlySet<string> | null,
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

function item(id: string, gameId = 1, groupId = 0) {
  return {
    internalId: id,
    gameId,
    groupId,
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
  state.editor.renderItemIds = null
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
      [...instances]
        .filter(([, entry]) => entry.mesh === batches.get(id))
        .sort(([, left], [, right]) => left.index - right.index)
        .map(([id]) => id),
    load: vi.fn(async (ids, task) => {
      task.onProgress?.({ phase: 'loading', completed: ids.length, total: ids.length })
      task.onProgress?.({ phase: 'preparing', completed: ids.length, total: ids.length })
    }),
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
        const last = [...instances.values()].find(
          (candidate) => candidate.mesh === entry.mesh && candidate.index === entry.mesh.count - 1
        )
        if (last && last !== entry) {
          const matrix = new Matrix4()
          entry.mesh.getMatrixAt(last.index, matrix)
          entry.mesh.setMatrixAt(entry.index, matrix)
          last.index = entry.index
        }
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
  expect(loading.current).toBe(4)
  expect(loading.total).toBe(4)
  expect(loading.isLoading).toBe(true)
  vi.advanceTimersByTime(1000)
  expect(loading.isVisible).toBe(true)
  finish()
  expect(await pending).toBe(true)
  expect(mode.idToIndexMap.value.has('a')).toBe(true)
  expect(loading.isLoading).toBe(false)
  expect(loading.current).toBe(4)
  expect(loading.total).toBe(4)
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

it('invalidates shadows only when the furniture layer visibility changes', async () => {
  const mode = useModelMode()
  await mode.rebuild()
  vi.mocked(invalidateScene).mockClear()
  mode.setVisible(false)
  expect(invalidateScene).toHaveBeenCalledExactlyOnceWith({ shadows: true })
  mode.setVisible(false)
  expect(invalidateScene).toHaveBeenCalledOnce()
  vi.mocked(invalidateScene).mockClear()
  mode.setVisible(true)
  expect(invalidateScene).toHaveBeenCalledExactlyOnceWith({ shadows: true })
  vi.mocked(invalidateScene).mockClear()
  mode.clearScene()
  expect(invalidateScene).toHaveBeenCalledExactlyOnceWith({ shadows: true })
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
    expect(reports.some((report) => report.phase === 'shaders')).toBe(true)
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

it('retains combined work counts across both material tiers without an empty loading stage', async () => {
  state.editor.activeScheme.items.value = [item('a'), item('b'), item('c', 2)]
  const mode = useModelMode(),
    loading = useLoadingStore()
  await mode.rebuild()
  const setPhase = vi.spyOn(loading, 'setPhase')
  const updateProgress = vi.spyOn(loading, 'updateParallelProgress')

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
    expect(loading.current).toBe(4)
    expect(loading.total).toBe(4)
    finish()
    expect(await pending).toBe(true)
    expect(loading.isLoading).toBe(false)
    expect(loading.progress).toBe(100)
    expect(loading.current).toBe(4)
    expect(loading.total).toBe(4)
    expect(setPhase.mock.calls.map(([phase, total]) => [phase, total])).toEqual([
      ['shaders', 4],
      ['shaders', 4],
    ])
    expect(
      updateProgress.mock.calls.map(([resources, rendering]) => [resources, rendering])
    ).toEqual([
      [2, 0],
      [2, 2],
    ])
  }
  expect(state.layer.load).toHaveBeenCalledTimes(2)
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  expect(state.layer.upsert).not.toHaveBeenCalled()
  expect(mode.idToIndexMap.value.size).toBe(3)
  mode.dispose()
})

it('adds interleaved loading and GPU preparation to one total without publishing early', async () => {
  state.editor.activeScheme.items.value = [item('a'), item('b', 2)]
  const tasks = new Map<number, { report: (phase: string) => void; finish: () => void }>()
  state.layer.load.mockImplementation(
    ([id]: number[], task: any) =>
      new Promise<void>((resolve) => {
        tasks.set(id!, {
          report: (phase) => task.onProgress({ phase, completed: 1, total: 1 }),
          finish: resolve,
        })
      })
  )
  const mode = useModelMode()
  const loading = useLoadingStore()
  const pending = mode.rebuild()
  await vi.waitFor(() => expect(tasks.size).toBe(2))
  tasks.get(1)!.report('loading')
  expect(loading.progress).toBe(25)
  expect(loading.stageCounts).toEqual({ resources: 1, rendering: 0 })
  tasks.get(1)!.report('preparing')
  expect(loading.progress).toBe(50)
  expect(loading.stageCounts).toEqual({ resources: 1, rendering: 1 })
  tasks.get(2)!.report('loading')
  expect(loading.progress).toBe(75)
  expect(loading.stageCounts).toEqual({ resources: 2, rendering: 1 })
  tasks.get(2)!.report('preparing')
  expect(loading.progress).toBe(100)
  expect(loading.isLoading).toBe(true)
  expect(mode.meshMap.value.size).toBe(0)
  tasks.forEach((task) => task.finish())
  expect(await pending).toBe(true)
  expect(mode.idToIndexMap.value.size).toBe(2)
  expect(loading.isLoading).toBe(false)
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

it('projects mixed model/fallback batches on scope changes without a scene transaction or asset replacement', async () => {
  const items = [
    item('outside', 1, 8),
    item('inside', 1, 7),
    item('fallback', 99, 0),
    item('hidden-fallback', 99, 8),
  ]
  state.editor.activeScheme.items.value = items
  state.layer.getConfig = (id: number) =>
    id === 99 ? undefined : { componentCount: 1, customData: [0], colorings: {} }
  state.editor.getRenderChanges.mockReturnValue(new Map())
  const mode = useModelMode()
  await mode.rebuild()
  const mesh = state.layer.getInstance('inside').mesh
  expect(mode.fallbackMesh.value!.count).toBe(2)
  mode.fallbackMesh.value!.setColorAt(0, new Color(0x123456))
  state.editor.renderItemIds = new Set(['inside', 'fallback'])
  const pending = mode.rebuild()
  expect(state.layer.root.visible).toBe(true)
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['inside', 'fallback'])
  expect(mode.fallbackMesh.value!.count).toBe(1)
  const retainedColor = new Color()
  mode.fallbackMesh.value!.getColorAt(0, retainedColor)
  expect(retainedColor.getHex()).toBe(0x123456)
  expect(state.layer.getInstance('inside').mesh).toBe(mesh)
  expect(await pending).toBe(true)
  expect(state.layer.getInstance('outside')).toBeUndefined()
  expect(state.layer.getInstance('inside').mesh).toBe(mesh)
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['inside', 'fallback'])
  expect(mode.internalIdToMeshInfo.value.get('inside')!.localIndex).toBe(0)
  expect(mode.fallbackMesh.value!.count).toBe(1)
  expect(state.editor.activeScheme.items.value).toBe(items)
  expect(state.editor.sceneVersion).toBe(0)
  state.editor.renderItemIds = null
  await mode.rebuild()
  expect(mode.idToIndexMap.value.size).toBe(4)
  expect(mode.fallbackMesh.value!.count).toBe(2)
  expect(state.layer.getInstance('inside').mesh).toBe(mesh)
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  mode.dispose()
})

it('ignores hidden edits and updates membership through the normal incremental slot API', async () => {
  const inside = item('inside', 1, 7),
    outside = item('outside', 2, 8),
    peer = item('peer', 1, 0)
  state.editor.activeScheme.items.value = [outside, inside, peer]
  state.editor.renderItemIds = new Set(['inside', 'peer'])
  const mode = useModelMode()
  await mode.rebuild()
  state.layer.load.mockClear()
  state.layer.upsert.mockClear()
  const hiddenChange = { ...outside, x: 300 }
  state.editor.activeScheme.items.value = [hiddenChange, inside, peer]
  state.editor.sceneVersion++
  state.editor.getRenderChanges.mockReturnValue(new Map([['outside', hiddenChange]]))
  await mode.rebuild()
  expect(state.layer.load).not.toHaveBeenCalled()
  expect(state.layer.upsert).not.toHaveBeenCalled()
  expect(state.layer.getInstance('outside')).toBeUndefined()
  const moved = { ...inside, x: 42 }
  state.editor.activeScheme.items.value = [hiddenChange, moved, peer]
  state.editor.sceneVersion++
  await mode.rebuild()
  expect(state.layer.updateMatrices.mock.calls.at(-1)[0][0].matrix.elements[12]).toBe(42)
  const incoming = { ...hiddenChange, groupId: 7 }
  state.editor.activeScheme.items.value = [incoming, { ...moved, groupId: 8 }, peer]
  state.editor.renderItemIds = new Set(['outside', 'peer'])
  state.editor.sceneVersion++
  await mode.rebuild()
  expect(state.layer.getInstance('inside')).toBeUndefined()
  expect(state.layer.getInstance('outside')).toBeDefined()
  expect([...mode.idToIndexMap.value.keys()].sort()).toEqual(['outside', 'peer'])
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  mode.dispose()
})

it('retains visible models and fallbacks while preparing newly shown furniture', async () => {
  state.editor.activeScheme.items.value = [
    item('outside', 2),
    item('inside', 1),
    item('fallback', 99),
    item('hidden-fallback', 99),
  ]
  state.layer.getConfig = (id: number) =>
    id === 99 ? undefined : { componentCount: 1, customData: [0], colorings: {} }
  const mode = useModelMode()
  await mode.rebuild()
  state.editor.renderItemIds = new Set(['inside', 'fallback'])
  await mode.rebuild()
  const mesh = state.layer.getInstance('inside').mesh
  const fallback = mode.fallbackMesh.value
  state.layer.load.mockClear()
  let finish!: () => void
  state.layer.load.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  state.editor.renderItemIds = null
  const pending = mode.rebuild()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(state.layer.root.visible).toBe(true)
  expect(state.layer.getInstance('inside').mesh).toBe(mesh)
  expect(mesh.count).toBe(1)
  expect(fallback!.count).toBe(1)
  expect(mode.fallbackMesh.value).toBe(fallback)
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['inside', 'fallback'])
  expect(state.layer.load.mock.calls[0][0]).toEqual([2])
  expect(state.layer.getInstance('outside')).toBeUndefined()
  expect(useLoadingStore().isLoading).toBe(true)
  finish()
  expect(await pending).toBe(true)
  expect(useLoadingStore().isLoading).toBe(false)
  expect(state.layer.root.visible).toBe(true)
  expect(state.layer.getInstance('inside').mesh).toBe(mesh)
  expect(state.layer.getInstance('outside')).toBeDefined()
  expect(mode.fallbackMesh.value).toBe(fallback)
  expect(fallback!.count).toBe(2)
  expect(mode.idToIndexMap.value.size).toBe(4)
  expect(state.layer.replaceAll).toHaveBeenCalledTimes(1)
  mode.dispose()
})

it('restores pruned instances when a cancelled visibility change returns to the last committed range', async () => {
  state.editor.activeScheme.items.value = [item('inside', 1), item('outside', 2)]
  const mode = useModelMode()
  await mode.rebuild()
  const mesh = state.layer.getInstance('inside').mesh
  let finish!: (layer: typeof state.layer) => void
  state.ready.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  state.editor.renderItemIds = new Set(['inside'])
  const obsolete = mode.rebuild()
  expect(state.layer.root.visible).toBe(true)
  expect(state.layer.getInstance('outside')).toBeUndefined()
  state.editor.renderItemIds = null
  expect(await mode.rebuild()).toBe(true)
  expect(state.layer.getInstance('inside').mesh).toBe(mesh)
  expect(state.layer.getInstance('outside')).toBeDefined()
  finish(state.layer)
  expect(await obsolete).toBe(false)
  expect(mode.idToIndexMap.value.size).toBe(2)
  mode.dispose()
})

it('does not let a late load restore an outdated visible range', async () => {
  state.editor.activeScheme.items.value = [item('inside', 1, 7), item('outside', 2, 8)]
  const mode = useModelMode()
  await mode.rebuild()
  state.editor.renderItemIds = new Set(['inside'])
  await mode.rebuild()
  let finish!: () => void
  state.layer.load.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  state.editor.renderItemIds = null
  const obsolete = mode.rebuild()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  state.editor.renderItemIds = new Set(['inside'])
  expect(await mode.rebuild()).toBe(true)
  finish()
  expect(await obsolete).toBe(false)
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['inside'])
  expect(state.layer.getInstance('outside')).toBeUndefined()
  expect(state.layer.root.visible).toBe(true)
  mode.dispose()
})

it('reconciles actual layer slots after a cancelled build removed a previously committed instance', async () => {
  state.editor.activeScheme.items.value = [item('a', 1, 7), item('b', 2, 8)]
  const mode = useModelMode()
  await mode.rebuild()
  const remove = state.layer.remove.getMockImplementation()!
  state.layer.remove.mockImplementationOnce((ids: string[]) => {
    remove(ids)
    state.editor.renderItemIds = new Set(['b'])
  })
  state.editor.renderItemIds = new Set(['a'])
  expect(await mode.rebuild()).toBe(false)
  expect(state.layer.getInstance('b')).toBeUndefined()
  expect(await mode.rebuild()).toBe(true)
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['b'])
  expect(state.layer.getInstance('a')).toBeUndefined()
  expect(state.layer.getInstance('b')).toBeDefined()
  mode.dispose()
})

it('fills newly visible slots when a previously capped scene shrinks back under its budget', async () => {
  const a = item('a'),
    b = item('b'),
    c = item('c')
  state.editor.activeScheme.items.value = [a, b, c]
  const mode = useModelMode()
  // Supply a small capped projection to exercise the boundary without allocating 500k matrices.
  await mode.rebuild({ items: [a, b] })
  expect([...mode.idToIndexMap.value.keys()]).toEqual(['a', 'b'])
  state.editor.activeScheme.items.value = [b, c]
  state.editor.sceneVersion++
  state.editor.getRenderChanges.mockReturnValue(new Map([['a', null]]))
  const pending = mode.rebuild()
  expect(state.layer.root.visible).toBe(true)
  expect(state.layer.getInstance('b')).toBeDefined()
  expect(state.layer.getInstance('a')).toBeUndefined()
  expect(await pending).toBe(true)
  expect([...mode.idToIndexMap.value.keys()].sort()).toEqual(['b', 'c'])
  expect(state.layer.getInstance('c')).toBeDefined()
  mode.dispose()
})

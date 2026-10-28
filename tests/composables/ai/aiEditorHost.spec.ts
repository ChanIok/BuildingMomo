import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { useAiEditorHost } from '@/composables/ai/useAiEditorHost'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { makeAppItem } from '../../fixtures/item'
import { analysisInput } from '../../fixtures/sceneAnalysis'
import { createAnalysisSnapshot } from '@/lib/sceneAnalysis/snapshot'
import type { AnalysisImageOutput } from '@/lib/sceneAnalysis/images'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  useSettingsStore().isAuthenticated = true
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function setup(options?: Parameters<typeof useAiEditorHost>[0]) {
  const store = useEditorStore()
  store.createScheme('house')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({ internalId: 'a', groupId: 7 }),
    makeAppItem({ internalId: 'b', instanceId: 1001 }),
  ]
  scheme.selectedItemIds.value = new Set(['a'])
  const scope = effectScope()
  scopes.push(scope)
  const { host } = scope.run(() => useAiEditorHost(options))!
  return { store, scheme, host, scope }
}
it('captures selection cheaply per operation, excluding selection and camera from scene revision', () => {
  const { store, scheme, host } = setup(),
    before = host.revision(scheme.id),
    items = scheme.items.value
  const first = host.selection(scheme.id)
  scheme.selectedItemIds.value = new Set(['b'])
  store.triggerSelectionUpdate()
  scheme.viewState.value = { position: [1, 2, 3], target: [0, 0, 0], preset: null, zoom: 1 }
  expect(host.selection(scheme.id)).toEqual(['b'])
  expect(first).toEqual(['a'])
  expect(host.revision(scheme.id)).toBe(before)
  expect(host.snapshot(scheme.id, first).items.map((i) => i.id)).toEqual(['a'])
  expect(scheme.items.value).toBe(items)
  expect(scheme.history.value).toBeUndefined()
})
it.each(['items', 'metadata', 'hidden', 'locked', 'catalog', 'dispose'])(
  'invalidates pending evidence on %s changes',
  (action) => {
    const { store, scheme, host, scope } = setup(),
      version = host.revision(scheme.id)
    if (action === 'items') scheme.items.value = scheme.items.value.map((i) => ({ ...i, x: 10 }))
    if (action === 'metadata')
      scheme.collectionTree.value = {
        nodes: [],
        groups: [{ groupId: 7, name: 'New', collectionId: null, order: 0 }],
      }
    if (action === 'hidden') scheme.hiddenGroupIds.value = new Set([7])
    if (action === 'locked') scheme.lockedGroupIds.value = new Set([7])
    if (action === 'catalog') useGameDataStore().furnitureDBRevision++
    if (action === 'dispose') scope.stop()
    if (action === 'dispose') expect(() => host.revision(scheme.id)).toThrow()
    else expect(host.revision(scheme.id)).not.toBe(version)
  }
)
it('rejects the whole explicit set instead of silently filtering missing/hidden/locked members', () => {
  const { scheme, host } = setup()
  scheme.hiddenGroupIds.value = new Set([7])
  expect(() => host.snapshot(scheme.id, ['a', 'b'])).toThrow(/visible and unlocked/)
  scheme.hiddenGroupIds.value = new Set()
  scheme.lockedGroupIds.value = new Set([7])
  expect(() => host.snapshot(scheme.id, ['a'])).toThrow()
  expect(() => host.snapshot(scheme.id, ['missing', 'b'])).toThrow()
  expect(host.snapshot(scheme.id, ['b']).items).toHaveLength(1)
})
it.each(['abort', 'edit', 'dispose'])(
  'rejects a pending capture after %s, before composing or publishing',
  async (action) => {
    let release!: (output: AnalysisImageOutput) => void
    const render = vi.fn(
      () =>
        new Promise<AnalysisImageOutput>((resolve) => {
          release = resolve
        })
    )
    const provider = { render }
    const { host, scheme, scope } = setup({ getCaptureProvider: () => provider }),
      controller = new AbortController()
    const run = host.render(
      scheme.id,
      [{ label: 'Only A', kind: 'scene', members: ['a'] }],
      controller.signal
    )
    expect(render).toHaveBeenCalledOnce()
    expect(Object.isFrozen(render.mock.calls[0]?.[0])).toBe(true)
    if (action === 'abort') controller.abort()
    if (action === 'edit') scheme.items.value = scheme.items.value.map((i) => ({ ...i, x: 1 }))
    if (action === 'dispose') scope.stop()
    release({ blob: new Blob(['png']), width: 10, height: 10, details: {} })
    await expect(run).rejects.toBeDefined()
    expect(scheme.history.value).toBeUndefined()
  }
)

it('keeps per-scheme data revisions stable across focus and render-policy changes and reads the named scheme', () => {
  const { store, scheme, host } = setup()
  const before = host.revision(scheme.id)
  store.createScheme('Other')
  useSettingsStore().settings.todMinute++
  expect(host.revision(scheme.id)).toBe(before)
  expect(host.selection(scheme.id)).toEqual(['a'])
  expect(host.snapshot(scheme.id).items).toHaveLength(2)
  expect(host.snapshot(scheme.id, []).items).toEqual([])
  expect(host.schemes()).toHaveLength(2)
})

it('never borrows another scheme viewport even if its instance IDs overlap the requested members', async () => {
  const render = vi.fn(),
    provider = { render }
  const { store, scheme, host } = setup({ getCaptureProvider: () => provider })
  store.createScheme('Other')
  store.activeScheme!.items.value = [makeAppItem({ internalId: 'a', gameId: 99 })]
  await expect(
    host.render(
      scheme.id,
      [{ label: 'A', kind: 'scene', members: ['a'] }],
      new AbortController().signal
    )
  ).rejects.toThrow('Open the target scheme')
  expect(render).not.toHaveBeenCalled()
})

function imageEnvironment() {
  const context = {
    fillStyle: '',
    font: '',
    textAlign: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    save() {},
    restore() {},
    translate() {},
    scale() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  }
  const encode = vi.fn(),
    close = vi.fn()
  const canvases: { width: number; height: number }[] = []
  const createElement = vi.fn(() => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob(callback: (blob: Blob) => void) {
        encode()
        callback(new Blob([JSON.stringify({ width: canvas.width, height: canvas.height })]))
      },
    }
    canvases.push(canvas)
    return canvas
  })
  vi.stubGlobal('document', { createElement })
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (blob: Blob) => ({ ...JSON.parse(await blob.text()), close }))
  )
  return { context, encode, close, canvases, createElement }
}
const sceneImage = (): AnalysisImageOutput => ({
  blob: new Blob([JSON.stringify({ width: 320, height: 240 })], { type: 'image/webp' }),
  width: 320,
  height: 240,
  details: { renderedItemIds: ['a'], missingItemIds: [], camera: { azimuth: 0 } },
})

it('renders six panels in order into one full-resolution board with matching titles and views', async () => {
  const env = imageEnvironment()
  const render = vi.fn(async (_snapshot, request) => ({
    ...sceneImage(),
    details: {
      renderedItemIds: request.itemIds,
      missingItemIds: [],
      camera: request.camera,
    },
  }))
  const provider = { render }
  const actual = setup({ getCaptureProvider: () => provider })
  const snapshot = vi.spyOn(actual.host, 'snapshot')
  const panels = ['a', 'b'].flatMap((id) =>
    [0, 90, 180].map((azimuth) => ({
      label: `${id} · ${azimuth}`,
      kind: 'scene' as const,
      members: [id],
      camera: { azimuth, elevation: 25 },
      width: 320,
      height: 240,
    }))
  )
  const result = await actual.host.render(actual.scheme.id, panels, new AbortController().signal, {
    columns: 3,
  })
  expect(render).toHaveBeenCalledTimes(6)
  expect(snapshot).toHaveBeenCalledTimes(2)
  expect(render.mock.calls[0]![0]).toBe(render.mock.calls[2]![0])
  expect(render.mock.calls[3]![0]).toBe(render.mock.calls[5]![0])
  expect(render.mock.calls.map(([, request]) => request.itemIds)).toEqual([
    ['a'],
    ['a'],
    ['a'],
    ['b'],
    ['b'],
    ['b'],
  ])
  expect(render.mock.calls.map(([, request]) => request.camera.azimuth)).toEqual([
    0, 90, 180, 0, 90, 180,
  ])
  expect(result).toMatchObject({
    width: 960,
    height: 544,
    details: {
      layout: { columns: 3, cellWidth: 320, cellHeight: 272 },
      panels: panels.map((p, i) => ({
        panel: i + 1,
        label: p.label,
        requested: 1,
        rendered: 1,
        camera: p.camera,
        width: 320,
        height: 240,
      })),
    },
  })
  expect(env.context.drawImage).toHaveBeenCalledTimes(6)
  expect(env.context.drawImage.mock.calls[5]?.slice(1)).toEqual([640, 304, 320, 240])
  expect(env.context.fillText.mock.calls.map(([text]) => text)).toEqual(
    panels.map((p, i) => `${i + 1} · ${p.label}`)
  )
  expect(env.encode).toHaveBeenCalledOnce()
  expect(env.close).toHaveBeenCalledTimes(6)
})

it('returns the original single scene blob, with panel metadata and no composition work', async () => {
  const env = imageEnvironment(),
    output = sceneImage(),
    provider = { render: vi.fn(async () => output) }
  const { host, scheme } = setup({ getCaptureProvider: () => provider })
  const result = await host.render(
    scheme.id,
    [{ label: 'Selected', kind: 'scene', members: ['a'] }],
    new AbortController().signal
  )
  expect(result.blob).toBe(output.blob)
  expect(result.details).toMatchObject({
    panels: [{ panel: 1, label: 'Selected', requested: 1, rendered: 1, width: 320, height: 240 }],
  })
  expect(env.createElement).not.toHaveBeenCalled()
  expect(env.encode).not.toHaveBeenCalled()
})

it('preflights a later inaccessible member set before capturing the first panel', async () => {
  const provider = { render: vi.fn(async () => sceneImage()) }
  const { host, scheme } = setup({ getCaptureProvider: () => provider })
  await expect(
    host.render(
      scheme.id,
      [
        { label: 'Valid', kind: 'scene', members: ['a'] },
        { label: 'Missing', kind: 'scene', members: ['missing'] },
      ],
      new AbortController().signal
    )
  ).rejects.toThrow('Members must exist')
  expect(provider.render).not.toHaveBeenCalled()
})

it('composes scene and atlas panels with independent internal and external layouts', async () => {
  const env = imageEnvironment(),
    provider = { render: vi.fn(async () => sceneImage()) }
  const { host, scheme } = setup({ getCaptureProvider: () => provider })
  vi.spyOn(host, 'snapshot').mockImplementation((_id, members) => {
    const input = analysisInput()
    return createAnalysisSnapshot({
      ...input,
      itemIds: members ?? input.itemIds,
      getFurniture(id) {
        const furniture = input.getFurniture(id)
        return furniture ? { ...furniture, iconUrl: null } : null
      },
    })
  })
  const result = await host.render(
    scheme.id,
    [
      { label: 'Shape', kind: 'scene', members: ['a'] },
      { label: 'Dictionary', kind: 'atlas', members: ['b'], layout: { columns: 1 } },
    ],
    new AbortController().signal,
    { columns: 2 }
  )
  expect(result).toMatchObject({
    width: 640,
    height: 272,
    details: {
      panels: [
        { panel: 1, label: 'Shape', rendered: 1 },
        { panel: 2, label: 'Dictionary', labels: [{ gameId: 1170000010, instanceCount: 1 }] },
      ],
    },
  })
  expect(env.canvases).toMatchObject([
    { width: 240, height: 232 },
    { width: 640, height: 272 },
  ])
  expect(provider.render).toHaveBeenCalledOnce()
})

it.each(['abort', 'edit', 'switch', 'resources'])(
  'discards the whole batch after %s, without rendering later panels or encoding a partial board',
  async (action) => {
    const env = imageEnvironment(),
      controller = new AbortController()
    let generation = 0,
      change!: () => void
    const render = vi.fn(async () => {
      if (render.mock.calls.length === 2) change()
      return sceneImage()
    })
    const provider = { render, revision: () => generation }
    const { host, scheme, store } = setup({ getCaptureProvider: () => provider })
    change = () => {
      if (action === 'abort') controller.abort()
      if (action === 'edit')
        scheme.items.value = scheme.items.value.map((item) => ({ ...item, x: 1 }))
      if (action === 'switch') store.createScheme('Other')
      if (action === 'resources') generation++
    }
    await expect(
      host.render(
        scheme.id,
        [0, 90, 180].map((azimuth) => ({
          kind: 'scene',
          label: String(azimuth),
          members: ['a'],
          camera: { azimuth },
        })),
        controller.signal
      )
    ).rejects.toBeDefined()
    expect(render).toHaveBeenCalledTimes(2)
    expect(env.encode).not.toHaveBeenCalled()
    expect(env.createElement).not.toHaveBeenCalled()
  }
)

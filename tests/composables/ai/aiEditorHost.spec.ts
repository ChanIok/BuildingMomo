import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { useAiEditorHost } from '@/composables/ai/useAiEditorHost'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { makeAppItem } from '../../fixtures/item'
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
    before = host.current().version,
    items = scheme.items.value
  const first = host.selection()
  scheme.selectedItemIds.value = new Set(['b'])
  store.triggerSelectionUpdate()
  scheme.viewState.value = { position: [1, 2, 3], target: [0, 0, 0], preset: null, zoom: 1 }
  expect(host.selection().members).toEqual(['b'])
  expect(first.members).toEqual(['a'])
  expect(host.current().version).toBe(before)
  expect(host.snapshot(first.members).items.map((i) => i.id)).toEqual(['a'])
  expect(scheme.items.value).toBe(items)
  expect(scheme.history.value).toBeUndefined()
})
it.each([
  'items',
  'metadata',
  'hidden',
  'locked',
  'catalog',
  'render-policy',
  'display-mode',
  'scheme',
  'dispose',
])('invalidates pending evidence on %s changes', (action) => {
  const { store, scheme, host, scope } = setup(),
    version = host.current().version
  if (action === 'items') scheme.items.value = scheme.items.value.map((i) => ({ ...i, x: 10 }))
  if (action === 'metadata')
    scheme.collectionTree.value = {
      nodes: [],
      groups: [{ groupId: 7, name: 'New', collectionId: null, order: 0 }],
    }
  if (action === 'hidden') scheme.hiddenGroupIds.value = new Set([7])
  if (action === 'locked') scheme.lockedGroupIds.value = new Set([7])
  if (action === 'catalog') useGameDataStore().furnitureDBRevision++
  if (action === 'render-policy') useSettingsStore().settings.todMinute++
  if (action === 'display-mode') useSettingsStore().settings.threeDisplayMode = 'model'
  if (action === 'scheme') store.createScheme('Other')
  if (action === 'dispose') scope.stop()
  expect(() => host.assertCurrent(version)).toThrow()
})
it('rejects the whole explicit set instead of silently filtering missing/hidden/locked members', () => {
  const { scheme, host } = setup()
  scheme.hiddenGroupIds.value = new Set([7])
  expect(() => host.snapshot(['a', 'b'])).toThrow(/visible and unlocked/)
  scheme.hiddenGroupIds.value = new Set()
  scheme.lockedGroupIds.value = new Set([7])
  expect(() => host.snapshot(['a'])).toThrow()
  expect(() => host.snapshot(['missing', 'b'])).toThrow()
  expect(host.snapshot(['b']).items).toHaveLength(1)
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
    const run = host.render([{ label: 'Only A', kind: 'scene', members: ['a'] }], controller.signal)
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

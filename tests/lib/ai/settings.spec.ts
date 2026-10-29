import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  DEFAULT_AI_PREFERENCES,
  getModelSettings,
  resolveConnection,
  setModelSettings,
} from '@/lib/ai/connection'
import { resolveAiConfig } from '@/lib/ai/context'

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useLocalStorage: (key: string, value: unknown, options?: object) =>
      actual.useStorage(key, value, globalThis.localStorage, options),
  }
})
const instances: ReturnType<typeof createPinia>[] = []
function store() {
  const pinia = createPinia()
  instances.push(pinia)
  setActivePinia(pinia)
  return useSettingsStore()
}
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})
afterEach(() => {
  instances.splice(0).forEach(disposePinia)
  vi.unstubAllGlobals()
})

it('persists credentials and per-model settings without sharing options across connections', async () => {
  localStorage.setItem('buildingmomo_ai_settings', JSON.stringify({ apiKey: 'key' }))
  const settings = store().ai
  expect(() => resolveAiConfig(settings)).toThrow()
  expect(settings.apiKey).toBe('key')
  const target = { apiUrl: 'https://proxy.test/v1', model: 'custom-alias' }
  setModelSettings(
    settings,
    { ...target, provider: 'compatible' },
    { requestBody: { thinking: { type: 'enabled' } }, replayReasoning: true }
  )
  setModelSettings(
    settings,
    { ...target, provider: 'anthropic' },
    { providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } } } }
  )
  settings.connection = { ...target, provider: 'anthropic' }
  expect(resolveConnection(settings).requestBody).toBeUndefined()
  expect(resolveConnection(settings).providerOptions).toHaveProperty('anthropic')
  const copy = getModelSettings(settings, settings.connection)
  copy.providerOptions!.anthropic!.thinking = { type: 'disabled' }
  expect(resolveConnection(settings).providerOptions!.anthropic!.thinking).toMatchObject({
    type: 'enabled',
  })
  const connection = { ...settings.connection }
  for (const target of [
    { ...connection, model: 'other' },
    { ...connection, apiUrl: 'https://other.test/v1' },
  ]) {
    expect(getModelSettings(settings, target)).toEqual({})
  }
  await nextTick()
  const restored = store().ai
  expect(resolveAiConfig(restored)).toEqual(resolveAiConfig(settings))
})

it('resets preferences and budgets without clearing connections, credentials or model settings', async () => {
  const settings = store(),
    ai = settings.ai
  settings.settings.theme = 'dark'
  Object.assign(ai, {
    apiKey: 'kept-key',
    connection: {
      provider: 'compatible',
      apiUrl: 'https://proxy.test/v1',
      model: 'alias',
      headers: { 'X-Project': 'kept' },
    },
    contextWindow: 64000,
    maxTokens: 4000,
    imageBudgetMiB: 12,
  })
  setModelSettings(ai, ai.connection, { reasoning: 'high', requestBody: { custom: true } })
  const connection = resolveConnection(ai),
    options = JSON.stringify(ai.modelSettings)
  settings.resetSettings()
  expect(settings.settings.theme).toBe('light')
  expect(ai).toMatchObject(DEFAULT_AI_PREFERENCES)
  expect(resolveConnection(ai)).toEqual(connection)
  expect(JSON.stringify(ai.modelSettings)).toBe(options)
  await nextTick()
  expect(store().ai).toEqual(ai)
})

it('persists externalPort and panelMode in the unified ai settings store', async () => {
  const current = store()
  current.ai.externalPort = 52000
  current.ai.panelMode = 'external'
  await nextTick()
  const raw = JSON.parse(localStorage.getItem('buildingmomo_ai_settings') ?? '{}')
  expect(raw.externalPort).toBe(52000)
  expect(raw.panelMode).toBe('external')
  const restored = store()
  expect(restored.ai.externalPort).toBe(52000)
  expect(restored.ai.panelMode).toBe('external')
})

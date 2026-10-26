import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useLocalStorage: (key: string, value: unknown, options?: object) =>
      actual.useStorage(key, value, globalThis.localStorage, options),
  }
})

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  disposePinia(pinia)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each([
  { secure: false, authenticated: false, allowed: false },
  { secure: false, authenticated: true, allowed: false },
  { secure: true, authenticated: false, allowed: false },
  { secure: true, authenticated: true, allowed: true },
])(
  'gates experimental features and restored settings for secure=$secure authenticated=$authenticated',
  ({ secure, authenticated, allowed }) => {
    vi.stubEnv('VITE_ENABLE_SECURE_MODE', String(secure))
    if (authenticated) localStorage.setItem('momo_lab_password', 'test-access-code')
    localStorage.setItem(
      'buildingmomo_settings',
      JSON.stringify({
        threeDisplayMode: 'model',
        lightingMode: 'home',
        homeTerrainEnabled: true,
        showBackground: true,
      })
    )
    const store = useSettingsStore()
    expect(store.canUseExperimentalFeatures).toBe(allowed)
    expect(store.settings).toMatchObject({
      threeDisplayMode: allowed ? 'model' : 'simple-box',
      lightingMode: allowed ? 'home' : 'studio',
      homeTerrainEnabled: allowed,
      showBackground: true,
    })
  }
)

it('corrects restricted edits, replacement settings and defaults without changing public display preferences', () => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  const store = useSettingsStore()
  for (const mode of ['box', 'icon', 'simple-box'] as const) {
    store.settings.threeDisplayMode = mode
    expect(store.settings.threeDisplayMode).toBe(mode)
  }
  store.settings.lightingMode = 'home'
  expect(store.settings.lightingMode).toBe('studio')
  store.settings.homeTerrainEnabled = true
  expect(store.settings.homeTerrainEnabled).toBe(false)
  store.settings.threeDisplayMode = 'model'
  expect(store.settings.threeDisplayMode).toBe('simple-box')
  store.settings = {
    ...store.settings,
    threeDisplayMode: 'model',
    lightingMode: 'home',
    homeTerrainEnabled: true,
    showBackground: false,
    theme: 'dark',
  }
  expect(store.settings).toMatchObject({
    threeDisplayMode: 'simple-box',
    lightingMode: 'studio',
    homeTerrainEnabled: false,
    showBackground: false,
    theme: 'dark',
  })
  store.resetSettings()
  expect(store.settings).toMatchObject({
    threeDisplayMode: 'simple-box',
    lightingMode: 'studio',
    homeTerrainEnabled: false,
    showBackground: true,
  })
})

it('disables restricted rendering immediately on revocation and does not restore it automatically on reauthorization', () => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  localStorage.setItem('momo_lab_password', 'test-access-code')
  const store = useSettingsStore()
  Object.assign(store.settings, {
    threeDisplayMode: 'model',
    lightingMode: 'home',
    homeTerrainEnabled: true,
  })
  expect(store.settings).toMatchObject({
    threeDisplayMode: 'model',
    lightingMode: 'home',
    homeTerrainEnabled: true,
  })
  store.isAuthenticated = false
  expect(store.settings).toMatchObject({
    threeDisplayMode: 'simple-box',
    lightingMode: 'studio',
    homeTerrainEnabled: false,
  })
  store.isAuthenticated = true
  expect(store.settings).toMatchObject({
    threeDisplayMode: 'simple-box',
    lightingMode: 'studio',
    homeTerrainEnabled: false,
  })
  store.settings.threeDisplayMode = 'model'
  expect(store.settings.threeDisplayMode).toBe('model')
})

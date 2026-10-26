import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  disposePinia(pinia)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('rejects an AI panel request without experimental access and keeps the current panel', () => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  const ui = useUIStore()
  ui.setSidebarView('transform')
  ui.setSidebarView('ai')
  expect(ui.sidebarView).toBe('transform')
})

it('returns an active AI panel to structure on revocation without reopening it or changing other panels', () => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  const settings = useSettingsStore()
  const ui = useUIStore()
  settings.isAuthenticated = true
  ui.setSidebarView('ai')
  expect(ui.sidebarView).toBe('ai')
  settings.isAuthenticated = false
  expect(ui.sidebarView).toBe('structure')
  settings.isAuthenticated = true
  expect(ui.sidebarView).toBe('structure')
  ui.setSidebarView('displaySettings')
  settings.isAuthenticated = false
  expect(ui.sidebarView).toBe('displaySettings')
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { useDesktopStore } from '@/stores/desktopStore'

vi.mock('@vueuse/core', () => ({
  useLocalStorage: (_key: string, defaults: object) => ref({ ...defaults }),
}))
const notification = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('@/composables/useNotification', () => ({ useNotification: () => notification }))
vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let pinia: ReturnType<typeof createPinia>
let scope: ReturnType<typeof effectScope>
let receive: (event: MessageEvent) => void
const postMessage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  scope = effectScope()
  vi.stubGlobal('window', {
    chrome: {
      webview: {
        postMessage,
        addEventListener: (_type: string, listener: typeof receive) => {
          receive = listener
        },
      },
    },
  })
})

afterEach(() => {
  scope.stop()
  disposePinia(pinia)
  vi.unstubAllGlobals()
})

function connect() {
  const store = useDesktopStore()
  scope.run(() => store.init())
  return store
}

function status(highPerformanceGpuEnabled?: boolean) {
  receive({
    data: {
      type: 'desktopStatus',
      status: {
        isElevated: false,
        runAsAdminEnabled: true,
        rtssAvailable: false,
        gameRunning: false,
        gameFocused: false,
        isLimiting: false,
        highPerformanceGpuEnabled,
      },
    },
  } as MessageEvent)
}

it('reads native startup settings without overwriting them during page initialization', () => {
  const store = connect()
  status(false)
  expect(store.status.highPerformanceGpuEnabled).toBe(false)
  expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
    'getDesktopConfig',
    'updateDesktopConfig',
  ])
  expect(postMessage.mock.calls[1]![0]).not.toHaveProperty('highPerformanceGpuEnabled')
})

it('updates the switch and prompts for restart only after native save confirmation', () => {
  const store = connect()
  status(true)
  store.setHighPerformanceGpu(false)
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'setHighPerformanceGpu', enabled: false })
  expect(store.status.highPerformanceGpuEnabled).toBe(true)
  expect(notification.info).not.toHaveBeenCalled()
  receive({
    data: { type: 'highPerformanceGpuResult', success: true, enabled: false },
  } as MessageEvent)
  expect(store.status.highPerformanceGpuEnabled).toBe(false)
  expect(notification.info).toHaveBeenCalledWith('sidebar.desktop.runAsAdminRestartHint')
})

it('reports save failure without claiming the requested setting was saved', () => {
  const store = connect()
  status(true)
  store.setHighPerformanceGpu(false)
  receive({
    data: { type: 'highPerformanceGpuResult', success: false, enabled: true },
  } as MessageEvent)
  expect(store.status.highPerformanceGpuEnabled).toBe(true)
  expect(notification.error).toHaveBeenCalledWith('sidebar.desktop.gpuPreferenceSaveFailed')
  expect(notification.info).not.toHaveBeenCalled()
})

it('leaves older desktop shells usable without claiming GPU preference support', () => {
  const store = connect()
  status()
  expect(store.isDesktop).toBe(true)
  expect(store.status.highPerformanceGpuEnabled).toBeNull()
  postMessage.mockClear()
  store.setHighPerformanceGpu(false)
  expect(postMessage).not.toHaveBeenCalled()
})

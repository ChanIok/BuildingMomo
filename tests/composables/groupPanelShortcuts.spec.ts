import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useCommandStore } from '@/stores/commandStore'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'

const keyboard = vi.hoisted(() => ({ listener: null as ((event: KeyboardEvent) => void) | null }))
vi.mock('@vueuse/core', async (original) => ({
  ...(await original<typeof import('@vueuse/core')>()),
  onKeyStroke: (listener: (event: KeyboardEvent) => void) => {
    keyboard.listener = listener
  },
}))
vi.mock('@/composables/useFileOperations', () => ({
  useFileOperations: () => ({ canRestoreWatchMode: ref(false), isWatchModeBusy: ref(false) }),
}))
vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let scope: EffectScope

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { activeElement: null })
  setActivePinia(createPinia())
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

function setup() {
  const commands = useCommandStore()
  const shortcuts = scope.run(() =>
    useKeyboardShortcuts({ commands: commands.commands, executeCommand: commands.executeCommand })
  )!
  return { ui: useUIStore(), store: useEditorStore(), commands, ...shortcuts }
}

function pressO(extra: Partial<KeyboardEvent> = {}) {
  const event = { key: 'o', repeat: false, preventDefault: vi.fn(), ...extra }
  keyboard.listener!(event as KeyboardEvent)
  return event
}

it('toggles the group panel through the shared command and ignores held-key repeats', () => {
  const { ui, store, commands, shortcutMap } = setup()
  store.createScheme('keyboard')
  expect(shortcutMap.value.get('o')?.id).toBe('tool.toggleGroupPanel')
  expect(shortcutMap.value.get('control+o')?.id).toBe('file.startWatchMode')
  expect(ui.groupPanelOpen).toBe(false)
  pressO()
  expect(ui.groupPanelOpen).toBe(true)
  pressO({ repeat: true })
  expect(ui.groupPanelOpen).toBe(true)
  pressO()
  expect(ui.groupPanelOpen).toBe(false)
  commands.executeCommand('tool.toggleGroupPanel')
  expect(ui.groupPanelOpen).toBe(true)
})

it.each(['INPUT', 'TEXTAREA', 'contenteditable'])(
  'does not intercept text typed into %s',
  (tag) => {
    const { ui, store } = setup()
    store.createScheme('typing')
    vi.stubGlobal('document', {
      activeElement: { tagName: tag, hasAttribute: () => tag === 'contenteditable' },
    })
    const event = pressO()
    expect(ui.groupPanelOpen).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  }
)

it('is disabled without a scheme or a 3D viewport', () => {
  const { ui, store, commands } = setup()
  expect(commands.isCommandEnabled('tool.toggleGroupPanel')).toBe(false)
  pressO()
  expect(ui.groupPanelOpen).toBe(false)
  store.createScheme('2d')
  ui.viewMode = '2d'
  expect(commands.isCommandEnabled('tool.toggleGroupPanel')).toBe(false)
  pressO()
  expect(ui.groupPanelOpen).toBe(false)
})

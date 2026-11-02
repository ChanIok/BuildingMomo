import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useCommandStore } from '@/stores/commandStore'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useClipboard } from '@/composables/useClipboard'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { makeAppItem } from '../fixtures/item'

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

it('enables shared paste and advanced paste for an empty collection clipboard', () => {
  const { store, commands } = setup()
  store.createScheme('empty collection clipboard')
  store.activeScheme!.collectionTree.value = {
    nodes: [{ id: 'empty', name: 'Empty', parentId: null, order: 0 }],
    groups: [],
  }
  const clipboard = useClipboard()
  clipboard.copy([{ kind: 'collection', id: 'empty' }])
  expect(commands.isCommandEnabled('edit.paste')).toBe(true)
  expect(commands.isCommandEnabled('edit.advancedPaste')).toBe(true)
  commands.executeCommand('edit.paste')
  expect(store.activeScheme!.collectionTree.value.nodes).toHaveLength(2)
})

it.each([0, 7])(
  'duplicates a canvas item from group %s repeatedly with E and after undo/redo',
  (groupId) => {
    const { store, shortcutMap } = setup()
    store.createScheme('continuous duplicate')
    const scheme = store.activeScheme!
    const original = makeAppItem({ internalId: 'source', instanceId: 1, groupId })
    scheme.items.value = [original]
    scheme.maxInstanceId.value = 1
    scheme.maxGroupId.value = groupId
    scheme.selectedItemIds.value = new Set(['source'])
    store.triggerSceneUpdate()
    store.triggerSelectionUpdate()
    const clipboard = useClipboard().clipboard.value
    expect(shortcutMap.value.get('e')?.id).toBe('edit.duplicate')

    function duplicate(total: number) {
      keyboard.listener!({ key: 'e', repeat: false, preventDefault() {} } as KeyboardEvent)
      expect(scheme.items.value).toHaveLength(total)
      const copy = scheme.items.value.at(-1)!
      expect(copy.groupId).toBe(0)
      expect(scheme.selectedItemIds.value).toEqual(new Set([copy.internalId]))
      expect(scheme.selectedEntries.value).toBeNull()
      expect(scheme.items.value[0]).toBe(original)
    }

    duplicate(2)
    duplicate(3)
    duplicate(4)
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(3)
    const selection = new Set(scheme.selectedItemIds.value)
    const history = useEditorHistory()
    history.undo()
    expect(scheme.items.value).toHaveLength(3)
    history.redo()
    expect(scheme.selectedItemIds.value).toEqual(selection)
    expect(scheme.selectedEntries.value).toBeNull()
    duplicate(5)
    expect(useClipboard().clipboard.value).toBe(clipboard)
  }
)

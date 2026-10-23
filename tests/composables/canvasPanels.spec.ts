import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, reactive, type EffectScope } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasPanels } from '@/composables/editor/useCanvasPanels'

let scope: EffectScope

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

function setup(width = 960) {
  const ui = useUIStore()
  ui.updateEditorContainerRect({ left: 8, top: 80, width, height: 800 })
  const panels = reactive({ showFurnitureLibrary: false, showDyePanel: false })
  const layout = scope.run(() => useCanvasPanels(panels))!
  return { ui, panels, ...layout }
}

it('starts closed and switches groups and the furniture library in both directions', () => {
  const { ui, panels } = setup()
  expect(ui.groupPanelOpen).toBe(false)
  ui.groupPanelOpen = true
  panels.showFurnitureLibrary = true
  expect(ui.groupPanelOpen).toBe(false)
  ui.groupPanelOpen = true
  expect(panels.showFurnitureLibrary).toBe(false)
  expect(ui.groupPanelOpen).toBe(true)
})

it.each(['groups', 'dye'])(
  'keeps group selection available while dyeing, opening %s first',
  (first) => {
    const { ui, panels, dyePanelStyle } = setup()
    if (first === 'groups') {
      ui.groupPanelOpen = true
      panels.showDyePanel = true
    } else {
      panels.showDyePanel = true
      ui.groupPanelOpen = true
    }
    expect(ui.groupPanelOpen).toBe(true)
    expect(panels.showDyePanel).toBe(true)
    expect(dyePanelStyle.value).toEqual({ left: '308px', maxWidth: 'calc(100% - 324px)' })
    ui.groupPanelOpen = false
    expect(panels.showDyePanel).toBe(true)
    expect(dyePanelStyle.value).toBeUndefined()
  }
)

it('switches groups and dye instead of overlapping on narrow canvases', () => {
  const { ui, panels, dyePanelStyle } = setup(480)
  ui.groupPanelOpen = true
  panels.showDyePanel = true
  expect(ui.groupPanelOpen).toBe(false)
  ui.groupPanelOpen = true
  expect(panels.showDyePanel).toBe(false)
  expect(dyePanelStyle.value).toBeUndefined()
})

it('resolves an open pair on shrink without reopening tools on expansion', () => {
  const { ui, panels, dyePanelStyle } = setup(640)
  ui.groupPanelOpen = true
  panels.showDyePanel = true
  expect(ui.groupPanelOpen).toBe(true)
  ui.updateEditorContainerRect({ ...ui.editorContainerRect, width: 639 })
  expect(ui.groupPanelOpen).toBe(false)
  expect(panels.showDyePanel).toBe(true)
  expect(dyePanelStyle.value).toBeUndefined()
  ui.updateEditorContainerRect({ ...ui.editorContainerRect, width: 960 })
  expect(ui.groupPanelOpen).toBe(false)
})

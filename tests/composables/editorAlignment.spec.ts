import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorAlignment } from '@/composables/editor/useEditorAlignment'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { makeAppItem } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useThreeModelManager', () => ({
  getThreeModelManager: () => ({ getModelBoundingBox: () => null }),
}))

let scope: EffectScope
beforeEach(() => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  useSettingsStore().isAuthenticated = true
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function setup() {
  return scope.run(() => {
    const store = useEditorStore()
    store.createScheme('partial group editing')
    const scheme = store.activeScheme!
    const items = [
      makeAppItem({ internalId: 'a', instanceId: 1000, groupId: 7, x: 0 }),
      makeAppItem({ internalId: 'b', instanceId: 1001, groupId: 7, x: 40 }),
      makeAppItem({ internalId: 'c', instanceId: 1002, groupId: 7, x: 900 }),
      makeAppItem({ internalId: 'target', instanceId: 1003, x: 200 }),
    ]
    scheme.items.value = items
    scheme.maxInstanceId.value = 1003
    scheme.maxGroupId.value = 7
    scheme.groupOrigins.value = new Map([[7, 'c']])
    store.triggerSceneUpdate()
    store.autoExpandGroupSelection = false
    return {
      store,
      scheme,
      items,
      selection: useEditorSelection(),
      alignment: useEditorAlignment(),
      history: useEditorHistory(),
    }
  })!
}

describe('alignment with partial groups', () => {
  it.each(['simple-box', 'icon', 'box', 'model'] as const)(
    'aligns partial members independently in %s and preserves unselected furniture through history',
    (mode) => {
      const { store, scheme, items, selection, alignment, history } = setup()
      useSettingsStore().settings.threeDisplayMode = mode
      selection.updateSelection(['a', 'b', 'target'], false)
      alignment.alignSelectedItems('x', 'min')
      expect(store.itemsMap.get('b')!.x).toBeCloseTo(0)
      expect(store.itemsMap.get('target')!.x).toBeCloseTo(0)
      expect(store.itemsMap.get('c')).toBe(items[2])
      expect(store.itemsMap.get('b')!.groupId).toBe(7)
      expect(scheme.groupOrigins.value.get(7)).toBe('c')
      history.undo()
      expect(store.itemsMap.get('b')!.x).toBe(40)
      expect(store.itemsMap.get('target')!.x).toBe(200)
      history.redo()
      expect(store.itemsMap.get('b')!.x).toBeCloseTo(0)
      expect(store.itemsMap.get('c')!.x).toBe(900)
      expect(store.autoExpandGroupSelection).toBe(false)
    }
  )

  it.each(['simple-box', 'box'] as const)(
    'aligns a partial member to an unselected member of its own group in %s',
    (mode) => {
      const { store, items, selection, alignment } = setup()
      useSettingsStore().settings.threeDisplayMode = mode
      selection.updateSelection(['b'], false)
      const ui = useUIStore()
      ui.setAlignReferenceItem('a')
      ui.setAlignReferencePosition('center')
      alignment.alignSelectedItems('x', 'center')
      expect(store.itemsMap.get('b')!.x).toBeCloseTo(0)
      expect(store.itemsMap.get('a')).toBe(items[0])
      expect(store.itemsMap.get('c')).toBe(items[2])
      expect(store.itemsMap.get('target')).toBe(items[3])
    }
  )

  it('preserves complete groups as a single alignment unit even with expansion disabled', () => {
    const { store, scheme, selection, alignment } = setup()
    useSettingsStore().settings.threeDisplayMode = 'simple-box'
    scheme.items.value = scheme.items.value.map((item) =>
      item.internalId === 'c' ? { ...item, x: 80 } : item
    )
    store.triggerSceneUpdate()
    selection.updateSelection(['a', 'b', 'c', 'target'], false)
    alignment.alignSelectedItems('x', 'min')
    expect(['a', 'b', 'c'].map((id) => store.itemsMap.get(id)!.x)).toEqual([0, 40, 80])
    expect(store.itemsMap.get('target')!.x).toBe(40)
  })

  it('distributes partial members independently without moving the rest of the group', () => {
    const { store, items, selection, alignment, history } = setup()
    selection.updateSelection(['a', 'b', 'target'], false)
    alignment.distributeSelectedItems('x')
    expect(store.itemsMap.get('b')!.x).toBe(100)
    expect(store.itemsMap.get('c')).toBe(items[2])
    history.undo()
    expect(store.itemsMap.get('b')!.x).toBe(40)
    history.redo()
    expect(store.itemsMap.get('b')!.x).toBe(100)
    expect(store.itemsMap.get('c')!.x).toBe(900)
  })

  it('moves selected members without changing their group or moving an unselected origin', () => {
    const { store, scheme, items, selection, history } = setup()
    selection.updateSelection(['b'], false)
    useEditorManipulation().translateSelectedItems({ x: 10, y: 0, z: 0 })
    expect(store.itemsMap.get('b')!.x).toBe(50)
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
    expect(store.itemsMap.get('a')).toBe(items[0])
    expect(store.itemsMap.get('c')).toBe(items[2])
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    history.undo()
    expect(store.itemsMap.get('b')!.x).toBe(40)
    history.redo()
    expect(store.itemsMap.get('b')!.x).toBe(50)
  })
})

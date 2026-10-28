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
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
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

describe('distribution units', () => {
  it('updates availability when switching between group-internal and mixed selections', () => {
    const { selection, alignment } = setup()
    expect(alignment.canDistributeSelectedItems.value).toBe(false)
    selection.updateSelection(['a', 'b', 'c'], false)
    expect(alignment.canDistributeSelectedItems.value).toBe(true)
    selection.updateSelection(['target'], true)
    expect(alignment.canDistributeSelectedItems.value).toBe(false)
    selection.updateSelection(['a', 'b', 'target'], false)
    expect(alignment.canDistributeSelectedItems.value).toBe(true)
  })

  it.each([
    ['x', false],
    ['y', false],
    ['z', false],
    ['x', true],
    ['y', true],
    ['z', true],
  ] as const)(
    'distributes newly grouped members along %s with working coordinates %s',
    (axis, working) => {
      const { store, scheme, selection, alignment, history } = setup()
      const ui = useUIStore()
      ui.setWorkingCoordinateSystem(working, { x: 15, y: 25, z: 35 })
      scheme.items.value = scheme.items.value.map((item, index) =>
        index < 3
          ? {
              ...item,
              groupId: 0,
              ...ui.workingToData({ x: 10, y: 20, z: 30, [axis]: [0, 40, 200][index]! }),
            }
          : item
      )
      store.triggerSceneUpdate()
      selection.updateSelection(['a', 'b', 'c'], false)
      expect(alignment.canDistributeSelectedItems.value).toBe(true)
      expect(scope.run(() => useEditorGroups().groupSelected())).toBe(true)
      expect(alignment.canDistributeSelectedItems.value).toBe(true)
      const before = scheme.items.value
      const origins = scheme.groupOrigins.value
      const groupId = store.itemsMap.get('a')!.groupId
      const transactionCount = scheme.history.value!.transactionUndoStack.length

      alignment.distributeSelectedItems(axis)

      for (const [index, id] of ['a', 'b', 'c'].entries()) {
        const item = store.itemsMap.get(id)!
        const position = ui.dataToWorking(item)
        expect(position[axis]).toBeCloseTo([0, 100, 200][index]!)
        for (const otherAxis of ['x', 'y', 'z'] as const) {
          expect(Number.isFinite(item[otherAxis])).toBe(true)
          if (otherAxis !== axis) {
            expect(position[otherAxis]).toBeCloseTo(ui.dataToWorking(before[index]!)[otherAxis])
          }
        }
        expect(item.groupId).toBe(groupId)
      }
      expect(store.itemsMap.get('a')).toBe(before[0])
      expect(store.itemsMap.get('b')).not.toBe(before[1])
      expect(store.itemsMap.get('c')).toBe(before[2])
      expect(store.itemsMap.get('target')).toBe(before[3])
      expect(scheme.groupOrigins.value).toBe(origins)
      expect(scheme.history.value!.transactionUndoStack.length).toBe(transactionCount + 1)
      history.undo()
      expect(ui.dataToWorking(store.itemsMap.get('b')!)[axis]).toBeCloseTo(40)
      expect(store.itemsMap.get('b')!.groupId).toBe(groupId)
      history.redo()
      expect(ui.dataToWorking(store.itemsMap.get('b')!)[axis]).toBeCloseTo(100)
    }
  )

  it('distributes only selected members within one group', () => {
    const { store, scheme, items, selection, alignment } = setup()
    scheme.items.value = [
      ...scheme.items.value,
      makeAppItem({ internalId: 'd', instanceId: 1004, groupId: 7, x: 200 }),
    ]
    store.triggerSceneUpdate()
    selection.updateSelection(['a', 'b', 'd'], false)
    expect(alignment.canDistributeSelectedItems.value).toBe(true)
    alignment.distributeSelectedItems('x')
    expect(store.itemsMap.get('b')!.x).toBe(100)
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
    expect(store.itemsMap.get('c')).toBe(items[2])
    expect(store.itemsMap.get('target')).toBe(items[3])
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
  })

  it('distributes three complete groups as rigid units', () => {
    const { store, scheme, selection, alignment, history } = setup()
    scheme.items.value = [0, 20, 40, 60, 200, 220].map((x, index) =>
      makeAppItem({
        internalId: `g${index}`,
        instanceId: 1000 + index,
        groupId: 7 + Math.floor(index / 2),
        x,
      })
    )
    scheme.groupOrigins.value = new Map([
      [7, 'g0'],
      [8, 'g2'],
      [9, 'g4'],
    ])
    store.triggerSceneUpdate()
    selection.updateSelection(
      scheme.items.value.map((item) => item.internalId),
      false
    )
    const before = scheme.items.value
    const origins = scheme.groupOrigins.value
    expect(alignment.canDistributeSelectedItems.value).toBe(true)
    alignment.distributeSelectedItems('x')
    expect(scheme.items.value.map((item) => item.x)).toEqual([0, 20, 100, 120, 200, 220])
    expect(scheme.items.value.map((item) => item.groupId)).toEqual([7, 7, 8, 8, 9, 9])
    expect(store.itemsMap.get('g0')).toBe(before[0])
    expect(store.itemsMap.get('g5')).toBe(before[5])
    expect(scheme.groupOrigins.value).toBe(origins)
    history.undo()
    expect(scheme.items.value.map((item) => item.x)).toEqual([0, 20, 40, 60, 200, 220])
    history.redo()
    expect(scheme.items.value.map((item) => item.x)).toEqual([0, 20, 100, 120, 200, 220])
  })

  it('keeps a complete group rigid when mixed with independent furniture', () => {
    const { store, scheme, selection, alignment } = setup()
    scheme.items.value = [
      ...scheme.items.value.map((item, index) => ({ ...item, x: [40, 60, 80, 0][index]! })),
      makeAppItem({ internalId: 'far', instanceId: 1004, x: 200 }),
    ]
    store.triggerSceneUpdate()
    selection.updateSelection(
      scheme.items.value.map((item) => item.internalId),
      false
    )
    expect(alignment.canDistributeSelectedItems.value).toBe(true)
    alignment.distributeSelectedItems('x')
    expect(scheme.items.value.map((item) => item.x)).toEqual([80, 100, 120, 0, 200])
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
  })

  it.each([
    { ids: [] },
    { ids: ['a', 'b'] },
    { ids: ['a', 'b', 'c', 'target'] },
    { ids: ['a', 'b', 'c', 'd', 'e', 'f'] },
  ])(
    'does not edit or record history for fewer than three distribution units ($ids)',
    ({ ids }) => {
      const { store, scheme, selection, alignment } = setup()
      scheme.items.value = [
        ...scheme.items.value,
        ...['d', 'e', 'f'].map((internalId, index) =>
          makeAppItem({ internalId, instanceId: 1004 + index, groupId: 8, x: 1000 + index * 20 })
        ),
      ]
      store.triggerSceneUpdate()
      selection.updateSelection(ids, false)
      const items = scheme.items.value
      const version = store.sceneVersion
      const transactionCount = scheme.history.value!.transactionUndoStack.length
      expect(alignment.canDistributeSelectedItems.value).toBe(false)
      alignment.distributeSelectedItems('x')
      expect(scheme.items.value).toBe(items)
      expect(store.sceneVersion).toBe(version)
      expect(scheme.history.value!.transactionUndoStack.length).toBe(transactionCount)
    }
  )

  it('does not distribute a complete collection with an origin as a single unit', () => {
    const { store, scheme, selection, alignment } = setup()
    scheme.collectionTree.value = {
      nodes: [{ id: 'house', name: 'House', parentId: null, order: 0, originItemId: 'a' }],
      groups: [{ groupId: 7, collectionId: 'house', order: 0 }],
    }
    selection.updateSelection(['a', 'b', 'c'], false, {
      entries: [{ kind: 'collection', id: 'house' }],
    })
    const items = scheme.items.value
    const version = store.sceneVersion
    expect(alignment.canDistributeSelectedItems.value).toBe(false)
    alignment.distributeSelectedItems('x')
    expect(scheme.items.value).toBe(items)
    expect(store.sceneVersion).toBe(version)
  })
})

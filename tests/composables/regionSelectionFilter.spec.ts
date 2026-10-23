import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, shallowRef, type EffectScope } from 'vue'
import { OrthographicCamera } from 'three'
import { useEditorStore, type SelectionAction } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useUIStore } from '@/stores/uiStore'
import { useTabStore } from '@/stores/tabStore'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useThreeSelection } from '@/composables/useThreeSelection'
import { useThreeTooltip } from '@/composables/useThreeTooltip'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { SLIDE_PATH_GAME_ID } from '@/lib/slidePath'
import type { InteractionAdapter, RaycastHit } from '@/composables/renderer/types'
import type { FurnitureItem } from '@/types/furniture'
import { makeAppItem } from '../fixtures/item'

vi.mock('@vueuse/core', async (original) => ({
  ...(await original<typeof import('@vueuse/core')>()),
  useMagicKeys: () => ({ shift: ref(false), ctrl: ref(false), alt: ref(false) }),
}))
vi.mock('@/composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('zh') }),
}))

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

function furniture(categoryId: number): FurnitureItem {
  return {
    name_cn: '测试家具',
    name_en: 'Test furniture',
    icon: '',
    size: [100, 100, 100],
    scaleRange: [1, 2],
    rotationAllowed: { x: true, y: true, z: true },
    categoryId,
  }
}

function setupGameData() {
  const gameData = useGameDataStore()
  gameData.furnitureCategories = {
    5000: { id: 5000, name_cn: '结构', name_en: 'Structures', iconId: 5, parentId: null },
    5002: { id: 5002, name_cn: '墙', name_en: 'Wall', iconId: 27, parentId: 5000 },
    3000: {
      id: 3000,
      name_cn: '实用家具',
      name_en: 'Interactive Furniture',
      iconId: 3,
      parentId: null,
    },
    3005: { id: 3005, name_cn: '灯', name_en: 'Lamp', iconId: 19, parentId: 3000 },
    6000: { id: 6000, name_cn: '景观', name_en: 'Landscape', iconId: 6, parentId: null },
    6002: { id: 6002, name_cn: '树木', name_en: 'Tree', iconId: 32, parentId: 6000 },
    1000: { id: 1000, name_cn: '预设', name_en: 'Preset', iconId: 1, parentId: null },
    1001: { id: 1001, name_cn: '预设房屋', name_en: 'Preset House', iconId: 8, parentId: 1000 },
  }
  gameData.furnitureData = { 1: furniture(5002), 2: furniture(3005), 3: furniture(6002) }
  return gameData
}

function setup() {
  const gameData = setupGameData()
  const store = useEditorStore()
  store.createScheme('filter test')
  const scheme = store.activeScheme!
  const items = [
    makeAppItem({ internalId: 'wall', gameId: 1, groupId: 7 }),
    makeAppItem({ internalId: 'lamp', gameId: 2, groupId: 7 }),
    makeAppItem({ internalId: 'peer-wall', gameId: 1, groupId: 7 }),
    makeAppItem({ internalId: 'tree', gameId: 3 }),
    makeAppItem({ internalId: 'slide', gameId: SLIDE_PATH_GAME_ID }),
  ]
  scheme.items.value = items
  store.triggerSceneUpdate()
  return { store, scheme, items, gameData, selection: useEditorSelection() }
}

function setupPointer() {
  const context = setup()
  const { store } = context
  const ui = useUIStore()
  ui.updateEditorContainerRect({ left: 0, top: 0, width: 100, height: 100 })
  let hit: RaycastHit | null = { internalId: 'lamp', instanceId: 0, distance: 1 }
  const adapter = shallowRef<InteractionAdapter>({
    pick: () => hit,
    pickAsync: async () => hit,
    cancelPick: vi.fn(),
    forEachRegionCenterCandidate: (_camera, _viewport, visitor) => {
      for (const internalId of ['wall', 'lamp']) visitor({ internalId, center: { x: 50, y: 50 } })
    },
  })
  const controller = scope.run(() =>
    useThreeSelection(shallowRef(new OrthographicCamera()), adapter)
  )!
  const event = (x: number, y: number) => ({
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    pointerType: 'mouse',
    timeStamp: 1000,
  })
  function drag() {
    controller.handlePointerDown(event(10, 10))
    if (store.selectionMode === 'box') {
      controller.handlePointerMove(event(90, 90))
      controller.handlePointerUp(event(90, 90))
    } else {
      for (const [x, y] of [
        [90, 10],
        [90, 90],
        [10, 90],
        [10, 10],
      ] as const) {
        controller.handlePointerMove(event(x, y))
      }
      controller.handlePointerUp(event(20, 20))
    }
  }
  return {
    ...context,
    ui,
    drag,
    click: () => controller.performClickSelection(event(50, 50)),
    setHit: (value: RaycastHit | null) => {
      hit = value
    },
  }
}

describe('shared furniture categories', () => {
  it('sorts populated categories and resolves major IDs, including missing metadata', () => {
    const gameData = setupGameData()
    expect(gameData.majorCategories.map((category) => category.id)).toEqual([3000, 5000, 6000])
    expect(gameData.minorCategories.map((category) => category.id)).toEqual([3005, 5002, 6002])
    expect(gameData.getFurnitureSelectionCategoryId(1)).toBe(5000)
    expect(gameData.getFurnitureSelectionCategoryId(2)).toBe(3000)
    expect(gameData.getFurnitureSelectionCategoryId(SLIDE_PATH_GAME_ID)).toBe('uncategorized')
    gameData.furnitureData = { ...gameData.furnitureData, 4: furniture(9999), 5: furniture(5000) }
    expect(gameData.getFurnitureSelectionCategoryId(4)).toBe('uncategorized')
    expect(gameData.getFurnitureSelectionCategoryId(5)).toBe(5000)
    delete gameData.furnitureCategories[5000]
    expect(gameData.getFurnitureSelectionCategoryId(1)).toBe('uncategorized')
  })

  it('keeps presets in the library but classifies scene preset IDs as uncategorized', () => {
    const gameData = setupGameData()
    gameData.furnitureCategories[1003] = {
      id: 1003,
      name_cn: '智能笔刷',
      name_en: 'Smart Brush',
      iconId: 10,
      parentId: 1000,
    }
    gameData.furnitureData = {
      ...gameData.furnitureData,
      4: furniture(1001),
      1174100001: furniture(1003),
    }
    expect(gameData.majorCategories.map((category) => category.id)).toEqual([
      1000, 3000, 5000, 6000,
    ])
    expect(gameData.selectionCategories.map((category) => category.id)).toEqual([3000, 5000, 6000])
    expect(gameData.getFurnitureSelectionCategoryId(4)).toBe('uncategorized')
    expect(gameData.getFurnitureSelectionCategoryId(1174100001)).toBe('uncategorized')
    expect(gameData.furnitureData[1174100001]!.categoryId).toBe(1003)
  })
})

describe('shared category filtering', () => {
  it('defaults to existing group selection and does not change document data', () => {
    const { store, scheme, items, selection } = setup()
    expect(store.selectionCategoryIds).toBeNull()
    selection.updateSelection(['lamp'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'lamp', 'peer-wall']))
    expect(scheme.items.value).toBe(items)
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(0)
  })

  it.each([
    ['new', ['wall', 'peer-wall']],
    ['add', ['wall', 'lamp', 'tree', 'peer-wall']],
    ['subtract', ['lamp', 'tree']],
    ['intersect', ['wall']],
    ['toggle', ['lamp', 'tree']],
  ] as [SelectionAction, string[]][])(
    'filters hits and group members for %s',
    (action, expected) => {
      const { store, scheme, selection } = setup()
      selection.updateSelection(['wall', 'lamp', 'tree'], false, { skipGroupExpansion: true })
      store.selectionCategoryIds = new Set([5000])
      const before = scheme.history.value!.selectionUndoStack.length
      const hits = ['wall', 'lamp']
      const actions = {
        new: () => selection.updateSelection(hits, false),
        add: () => selection.updateSelection(hits, true),
        subtract: () => selection.deselectItems(hits),
        intersect: () => selection.intersectSelection(hits),
        toggle: () => selection.toggleItems(hits),
      }
      actions[action]()
      expect(scheme.selectedItemIds.value).toEqual(new Set(expected))
      expect(scheme.history.value!.selectionUndoStack).toHaveLength(before + 1)
    }
  )

  it('cannot trigger a group through an excluded hit', () => {
    const { store, scheme, selection } = setup()
    store.selectionCategoryIds = new Set([5000])
    selection.updateSelection(['lamp'], false)
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })

  it('ignores excluded hits when deciding which direction to toggle a partial group', () => {
    const { store, scheme, selection } = setup()
    selection.updateSelection(['wall'], false, { skipGroupExpansion: true })
    store.selectionCategoryIds = new Set([5000])
    selection.toggleItems(['wall', 'lamp'])
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })

  it('combines category and lock restrictions while preserving individual mode', () => {
    const { store, scheme, selection } = setup()
    store.setGroupLocked(0, true)
    store.selectionCategoryIds = new Set([5000])
    selection.updateSelection(['wall', 'lamp', 'tree'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'peer-wall']))
    selection.updateSelection(['wall', 'lamp'], false, { skipGroupExpansion: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall']))
  })

  it('treats categories as a union and makes explicit all equivalent to the default', () => {
    const { store, scheme, gameData, selection } = setup()
    store.selectionCategoryIds = new Set([5000, 'uncategorized'])
    selection.selectAll()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'peer-wall', 'slide']))
    store.selectionCategoryIds = new Set([6000])
    selection.selectAll()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['tree']))
    store.selectionCategoryIds = new Set([
      ...gameData.selectionCategories.map((category) => category.id),
      'uncategorized',
    ])
    selection.selectAll()
    const explicitAll = new Set(scheme.selectedItemIds.value)
    expect(explicitAll.size).toBe(5)
    store.selectionCategoryIds = null
    selection.selectAll()
    expect(scheme.selectedItemIds.value).toEqual(explicitAll)
  })
})

describe('region filter integration', () => {
  it.each(['box', 'lasso'] as const)('filters %s hits and expanded group members', (mode) => {
    const { store, scheme, drag } = setupPointer()
    store.selectionMode = mode
    store.selectionCategoryIds = new Set([5000])
    drag()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'peer-wall']))
  })

  it.each(['new', 'add', 'subtract', 'intersect', 'toggle'] as const)(
    'handles an empty filtered region for %s',
    (action) => {
      const { store, scheme, selection, drag } = setupPointer()
      selection.updateSelection(['wall', 'lamp'], false, { skipGroupExpansion: true })
      store.selectionMode = 'box'
      store.selectionCategoryIds = new Set()
      store.selectionAction = action
      drag()
      expect(scheme.selectedItemIds.value).toEqual(
        action === 'new' || action === 'intersect' ? new Set() : new Set(['wall', 'lamp'])
      )
    }
  )
})

describe('selection filter boundaries and history', () => {
  it('does not pick through excluded foreground hits on repeated clicks', () => {
    const { store, scheme, click } = setupPointer()
    store.selectionCategoryIds = new Set([5000])
    click()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    click()
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })

  it('filters group members when the nearest hit is selectable', () => {
    const { store, scheme, click, setHit } = setupPointer()
    store.selectionCategoryIds = new Set([5000])
    setHit({ internalId: 'wall', instanceId: 0, distance: 1 })
    click()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'peer-wall']))
  })

  it.each(['new', 'add', 'subtract', 'intersect', 'toggle'] as const)(
    'treats an excluded click as an empty hit for %s',
    (action) => {
      const { store, scheme, selection, click } = setupPointer()
      selection.updateSelection(['wall'], false, { skipGroupExpansion: true })
      store.selectionCategoryIds = new Set([5000])
      store.selectionAction = action
      click()
      expect(scheme.selectedItemIds.value).toEqual(action === 'new' ? new Set() : new Set(['wall']))
    }
  )

  it('does not filter reference picking even when no categories are enabled', () => {
    const { store, scheme, ui, click } = setupPointer()
    store.selectionCategoryIds = new Set()
    ui.setSelectingAlignReference(true)
    click()
    expect(ui.alignReferenceItemId).toBe('lamp')
    expect(ui.isSelectingAlignReference).toBe(false)
    ui.setSelectingGroupOrigin(true, 7)
    click()
    expect(scheme.groupOrigins.value.get(7)).toBe('lamp')
    ui.setSelectingPivotItem(true)
    click()
    expect(ui.selectedPivotPosition).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('filters slide-path node selection before activating node editing', () => {
    const { store, scheme, ui, click, setHit } = setupPointer()
    store.selectionCategoryIds = new Set()
    setHit({
      internalId: 'slide',
      instanceId: 0,
      distance: 1,
      kind: 'slide-path-point',
      pointIndex: 2,
    })
    click()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(ui.activeSlidePathPoint).toBeNull()
    store.selectionCategoryIds = new Set(['uncategorized'])
    click()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['slide']))
    expect(ui.activeSlidePathPoint).toEqual({ itemId: 'slide', pointIndex: 2 })
  })

  it.each([
    ['selectAll', ['wall', 'peer-wall', 'tree']],
    ['invertSelection', ['peer-wall', 'tree']],
    ['selectSameType', ['wall', 'peer-wall']],
  ] as const)('restricts %s to the enabled categories', (command, expected) => {
    const { store, scheme, selection } = setup()
    selection.updateSelection(['wall', 'lamp'], false, { skipGroupExpansion: true })
    store.selectionCategoryIds = new Set([5000, 6000])
    selection[command]()
    expect(scheme.selectedItemIds.value).toEqual(new Set(expected))
  })

  it('makes selection commands empty when no categories are enabled, but permits explicit deselection', () => {
    const { store, scheme, selection } = setup()
    selection.selectAll()
    store.selectionCategoryIds = new Set()
    selection.deselectItems(['lamp'], { skipGroupExpansion: true, ignoreSelectionFilter: true })
    expect(scheme.selectedItemIds.value.has('lamp')).toBe(false)
    expect(scheme.selectedItemIds.value.has('wall')).toBe(true)
    selection.selectAll()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    selection.invertSelection()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    selection.updateSelection(['lamp'], false, {
      ignoreSelectionFilter: true,
      skipGroupExpansion: true,
    })
    selection.selectSameType()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    selection.updateSelection(['wall'], false, {
      ignoreSelectionFilter: true,
      skipGroupExpansion: true,
    })
    selection.clearSelection()
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })

  it('does not filter the automatic selection of newly added furniture', () => {
    const { store, scheme } = setup()
    store.selectionCategoryIds = new Set([5000])
    const added = useEditorItemAdd().addFurnitureItem(2)!
    expect(scheme.selectedItemIds.value).toEqual(new Set([added.internalId]))
    expect(added.gameId).toBe(2)
  })

  it('does not change selection or history on filter changes and restores selection unfiltered', () => {
    const { store, scheme, selection } = setup()
    const history = useEditorHistory()
    selection.updateSelection(['lamp'], false, { skipGroupExpansion: true })
    const before = scheme.history.value!.selectionUndoStack.length
    const sceneVersion = store.sceneVersion
    store.selectionCategoryIds = new Set([5000])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['lamp']))
    expect(scheme.history.value!.selectionUndoStack).toHaveLength(before)
    expect(store.sceneVersion).toBe(sceneVersion)
    selection.updateSelection(['wall', 'lamp'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'peer-wall']))
    store.selectionCategoryIds = new Set()
    history.undo()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['lamp']))
    history.redo()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['wall', 'peer-wall']))
    expect(store.selectionCategoryIds?.size).toBe(0)
  })

  it('retains session filters across scheme switches', () => {
    const { store, scheme } = setup()
    store.selectionCategoryIds = new Set([5000])
    store.createScheme('second')
    expect(store.selectionCategoryIds).toEqual(new Set([5000]))
    useTabStore().openSchemeTab(scheme.id, 'filter test')
    expect(store.selectionCategoryIds).toEqual(new Set([5000]))
  })
})

function setupHover(
  pickAsync: InteractionAdapter['pickAsync'] = async () => ({
    internalId: 'lamp',
    instanceId: 0,
    distance: 1,
  })
) {
  const context = setup()
  const ui = useUIStore()
  ui.updateEditorContainerRect({ left: 0, top: 0, width: 100, height: 100 })
  const adapter = shallowRef<InteractionAdapter>({
    pick: () => null,
    pickAsync,
    cancelPick: vi.fn(),
    forEachRegionCenterCandidate: () => {},
  })
  const hovered = vi.fn()
  const tooltip = scope.run(() =>
    useThreeTooltip(
      shallowRef(new OrthographicCamera()),
      shallowRef({} as HTMLElement),
      adapter,
      ref(true),
      undefined,
      hovered
    )
  )!
  return {
    ...context,
    ui,
    hovered,
    tooltip,
    move: () =>
      tooltip.handlePointerMove({ clientX: 50, clientY: 50, buttons: 0 } as PointerEvent, false),
  }
}

describe('selection-filtered hover', () => {
  it('updates hover eligibility when categories or the picking purpose change', async () => {
    const { store, ui, hovered, tooltip, move } = setupHover()
    store.selectionCategoryIds = new Set([3000])
    await move()
    expect(tooltip.tooltipData.value?.gameId).toBe(2)
    expect(hovered).toHaveBeenLastCalledWith('lamp', expect.anything())
    store.selectionCategoryIds = new Set([5000])
    expect(tooltip.tooltipVisible.value).toBe(false)
    expect(hovered).toHaveBeenLastCalledWith(null, null)
    await move()
    expect(tooltip.tooltipData.value).toBeNull()
    store.selectionCategoryIds = new Set()
    ui.setSelectingAlignReference(true)
    await move()
    expect(tooltip.tooltipData.value?.gameId).toBe(2)
  })

  it('rejects an obsolete async hit even if it remains eligible under the new categories', async () => {
    let finish!: (hit: RaycastHit | null) => void
    const { store, hovered, tooltip, move } = setupHover(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = move()
    store.selectionCategoryIds = new Set([3000]) // lamp 仍可选，不能靠类别判断掩盖过期结果。
    finish({ internalId: 'lamp', instanceId: 0, distance: 1 })
    await pending
    expect(tooltip.tooltipVisible.value).toBe(false)
    expect(tooltip.tooltipData.value).toBeNull()
    expect(hovered).not.toHaveBeenCalledWith('lamp', expect.anything())
  })
})

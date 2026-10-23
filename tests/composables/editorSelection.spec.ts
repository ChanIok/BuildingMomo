import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../../src/stores/editorStore'
import { useEditorSelection } from '../../src/composables/editor/useEditorSelection'
import { useEditorHistory } from '../../src/composables/editor/useEditorHistory'
import { useEditorGroups } from '../../src/composables/editor/useEditorGroups'
import type { AppItem } from '../../src/types/editor'
import { OrthographicCamera } from 'three'
import { shallowRef, ref } from 'vue'
import { useThreeSelection } from '../../src/composables/useThreeSelection'
import { useUIStore } from '../../src/stores/uiStore'
import type { InteractionAdapter, RaycastHit } from '../../src/composables/renderer/types'
import { useCommandStore } from '../../src/stores/commandStore'
import { useKeyboardShortcuts } from '../../src/composables/useKeyboardShortcuts'

const keyboard = vi.hoisted(() => ({
  listener: null as ((event: KeyboardEvent) => void) | null,
  keys: { shift: { value: false }, ctrl: { value: false }, alt: { value: false } },
}))
vi.mock('@vueuse/core', async (original) => ({
  ...(await original<typeof import('@vueuse/core')>()),
  onKeyStroke: (listener: (event: KeyboardEvent) => void) => {
    keyboard.listener = listener
  },
  useMagicKeys: () => keyboard.keys,
}))
vi.mock('@/composables/useFileOperations', () => ({
  useFileOperations: () => ({
    canRestoreWatchMode: ref(false),
    isWatchModeBusy: ref(false),
  }),
}))

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

function item(id: string, groupId: number, gameId = 1): AppItem {
  return {
    internalId: id,
    instanceId: 1000 + id.charCodeAt(0),
    gameId,
    groupId,
    x: 0,
    y: 0,
    z: 0,
    rotation: { x: 0, y: 0, z: 0 },
    extra: { Scale: { X: 1, Y: 1, Z: 1 }, ColorMap: { '0': 0 } },
  }
}

function setup() {
  const store = useEditorStore()
  store.createScheme('test')
  const scheme = store.activeScheme!
  const items = [item('a', 7), item('b', 7), item('c', 8), item('d', 0)]
  scheme.items.value = items
  scheme.maxInstanceId.value = 1200
  scheme.maxGroupId.value = 8
  scheme.groupOrigins.value = new Map([
    [7, 'a'],
    [8, 'c'],
  ])
  store.triggerSceneUpdate()
  return { store, scheme, items, selection: useEditorSelection(), history: useEditorHistory() }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  keyboard.keys = { shift: ref(false), ctrl: ref(false), alt: ref(false) }
})

afterEach(() => vi.unstubAllGlobals())

describe('group selection actions', () => {
  it('lets explicit individual actions skip group expansion', () => {
    const { scheme, selection } = setup()
    selection.toggleSelection('a', false, { skipGroupExpansion: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a']))
    selection.updateSelection(['b'], false, { skipGroupExpansion: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
    selection.toggleItems(['a', 'b'], { skipGroupExpansion: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a']))
    selection.selectAll()
    selection.deselectItems(['a'], { skipGroupExpansion: true })
    selection.intersectSelection(['b'], { skipGroupExpansion: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
  })

  it('toggles each effective group once, completes partial groups, and records one selection step', () => {
    const { scheme, selection } = setup()
    selection.updateSelection(['a', 'c'], false, { skipGroupExpansion: true })
    const before = scheme.history.value!.selectionUndoStack.length
    selection.toggleItems(['a', 'b', 'a', 'c', 'd'])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b', 'd']))
    expect(scheme.history.value!.selectionUndoStack).toHaveLength(before + 1)
    selection.toggleItems(['b', 'a', 'b'])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['d']))
  })

  it('keeps invert and same-type selection exact instead of expanding their results to groups', () => {
    const { store, scheme, selection } = setup()
    scheme.items.value = scheme.items.value.map((entry) =>
      entry.internalId === 'b' ? { ...entry, gameId: 2 } : entry
    )
    store.triggerSceneUpdate()
    selection.updateSelection(['a'], false, { skipGroupExpansion: true })
    selection.selectSameType()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'c', 'd']))
    selection.invertSelection()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
  })

  it('preserves normal hit-based group toggling for partial selections', () => {
    const { scheme, selection } = setup()
    selection.updateSelection(['a'], false, { skipGroupExpansion: true })
    selection.toggleItems(['a'])
    expect(scheme.selectedItemIds.value.size).toBe(0)
    selection.updateSelection(['a'], false, { skipGroupExpansion: true })
    selection.toggleItems(['a', 'b'])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  })
})

describe('partial grouping and protected origins', () => {
  it('allows selected members of a partial group to form a new group through the command', () => {
    const { store, scheme, selection } = setup()
    const hidden = item('e', 7)
    scheme.items.value = [...scheme.items.value, hidden]
    store.triggerSceneUpdate()
    selection.updateSelection(['a', 'b'], false, { skipGroupExpansion: true })
    const commands = useCommandStore()
    expect(commands.isCommandEnabled('edit.group')).toBe(true)
    commands.executeCommand('edit.group')
    expect(store.itemsMap.get('a')!.groupId).toBe(9)
    expect(store.itemsMap.get('b')!.groupId).toBe(9)
    expect(store.itemsMap.get('e')).toBe(hidden)
    expect(commands.isCommandEnabled('edit.group')).toBe(false)
  })

  it('allows partial grouping and ungrouping without changing unselected furniture', () => {
    const { store, scheme, items, selection, history } = setup()
    selection.updateSelection(['b', 'd'], false, { skipGroupExpansion: true })
    const groups = useEditorGroups()
    groups.groupSelected()
    expect(store.itemsMap.get('b')!.groupId).toBe(9)
    expect(store.itemsMap.get('d')!.groupId).toBe(9)
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    expect(store.itemsMap.get('a')).toBe(items[0])
    expect(store.itemsMap.get('c')).toBe(items[2])
    history.undo()
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
    history.redo()
    groups.ungroupSelected()
    expect(store.itemsMap.get('b')!.groupId).toBe(0)
    expect(store.itemsMap.get('d')!.groupId).toBe(0)
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
  })

  it('preserves a remaining member origin when partially ungrouping', () => {
    const { store, scheme, items, selection, history } = setup()
    selection.updateSelection(['b'], false, { skipGroupExpansion: true })
    useEditorGroups().ungroupSelected()
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    expect(store.itemsMap.get('a')).toBe(items[0])
    history.undo()
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
  })

  it('clears the origin when its member leaves the group, for both grouping operations', () => {
    const { store, scheme, selection, history } = setup()
    selection.updateSelection(['a'], false, { skipGroupExpansion: true })
    useEditorGroups().ungroupSelected()
    expect(scheme.groupOrigins.value.has(7)).toBe(false)
    history.undo()
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    selection.updateSelection(['a', 'd'], false, { skipGroupExpansion: true })
    useEditorGroups().groupSelected()
    expect(scheme.groupOrigins.value.has(7)).toBe(false)
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
  })

  it('protects group origins and rejects hidden or locked external anchors', () => {
    const { store, scheme, history } = setup()
    const groups = useEditorGroups()
    groups.setGroupOrigin(7, 'c')
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    store.setGroupLocked(7, true)
    const length = scheme.history.value!.transactionUndoStack.length
    expect(groups.canEditGroupOrigin(7)).toBe(false)
    groups.setGroupOrigin(7, 'b')
    groups.clearGroupOrigin(7)
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(length)
    store.unlockAllGroups()
    groups.setGroupOrigin(7, 'b')
    store.setGroupHidden(8, true)
    groups.setGroupOrigin(7, 'c')
    expect(scheme.groupOrigins.value.get(7)).toBe('b')
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(length + 1)
    store.setGroupLocked(0, true)
    groups.setGroupOrigin(7, 'd')
    expect(scheme.groupOrigins.value.get(7)).toBe('b')
    store.unlockAllGroups()
    expect(groups.canEditGroupOrigin(7)).toBe(true)
    groups.setGroupOrigin(7, 'd')
    expect(scheme.groupOrigins.value.get(7)).toBe('d')
    history.undo()
    expect(scheme.groupOrigins.value.get(7)).toBe('b')
    groups.clearGroupOrigin(7)
    expect(scheme.groupOrigins.value.has(7)).toBe(false)
  })

  it('rejects instance-ID edits that would renumber hidden furniture', () => {
    const { store, scheme, items } = setup()
    store.setGroupHidden(8, true)
    expect(store.setItemInstanceId('a', items[2]!.instanceId)).toBe(false)
    expect(store.setItemInstanceId('c', 1500)).toBe(false)
    expect(scheme.items.value).toBe(items)
    expect(store.setItemInstanceId('a', items[1]!.instanceId)).toBe(true)
    expect(store.itemsMap.get('c')).toBe(items[2])
    expect(store.itemsMap.get('a')!.instanceId).toBe(items[1]!.instanceId)
    expect(store.itemsMap.get('b')!.instanceId).toBeGreaterThan(1200)
  })
})

describe('selection pointer gestures', () => {
  function pointerSetup() {
    const state = setup()
    useUIStore().updateEditorContainerRect({ left: 0, top: 0, width: 100, height: 100 })
    let hit: RaycastHit | null = { internalId: 'a', instanceId: 0, distance: 1 }
    let candidates = ['a', 'b', 'c']
    const adapter = shallowRef<InteractionAdapter>({
      pick: () => hit,
      pickAsync: async () => hit,
      cancelPick: vi.fn(),
      forEachRegionCenterCandidate: (_camera, _viewport, visitor) => {
        for (const id of candidates) visitor({ internalId: id, center: { x: 50, y: 50 } })
      },
    })
    const controller = useThreeSelection(shallowRef(new OrthographicCamera()), adapter)
    function click(timeStamp: number, extra = {}) {
      const evt = {
        type: 'pointerup',
        clientX: 50,
        clientY: 50,
        button: 0,
        pointerType: 'mouse',
        timeStamp,
        ...extra,
      }
      controller.handlePointerDown(evt)
      controller.handlePointerUp(evt)
    }
    return {
      ...state,
      controller,
      click,
      setCandidates: (ids: string[]) => {
        candidates = ids
      },
      setHit: (next: RaycastHit | null) => {
        hit = next
      },
    }
  }

  it('selects groups by default and lets the configured modifier pick an individual member', () => {
    const { scheme, click } = pointerSetup()
    click(1000)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    keyboard.keys.ctrl.value = true
    click(2000, { ctrlKey: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
    keyboard.keys.ctrl.value = false
    click(3000)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  })

  it('expands a box hit to all selectable group members', () => {
    const { store, scheme, selection, controller, setCandidates } = pointerSetup()
    scheme.items.value = [...scheme.items.value, item('e', 7)]
    store.triggerSceneUpdate()
    selection.updateSelection(['c'], false)
    setCandidates(['a', 'e'])
    const event = (x: number, y: number) => ({
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      type: 'pointerup',
      pointerType: 'mouse',
    })
    controller.handlePointerDown(event(10, 10))
    controller.handlePointerMove(event(90, 90))
    controller.handlePointerUp(event(90, 90))
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b', 'e']))
  })

  it('expands a lasso hit to other selectable group members', () => {
    const { store, scheme, controller, setCandidates } = pointerSetup()
    setCandidates(['a'])
    store.selectionMode = 'lasso'
    const event = (x: number, y: number) => ({
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      type: 'pointerup',
      pointerType: 'mouse',
    })
    controller.handlePointerDown(event(10, 10))
    for (const [x, y] of [
      [90, 10],
      [90, 90],
      [10, 90],
      [10, 10],
    ])
      controller.handlePointerMove(event(x!, y!))
    controller.handlePointerUp(event(20, 20))
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  })

  it('keeps repeated clicks as ordinary selections without changing visibility', () => {
    const { store, scheme, click, setHit } = pointerSetup()
    click(1000)
    click(1200)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    expect(store.renderItemIds).toBeNull()
    setHit(null)
    click(2000)
    click(2200)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(store.renderItemIds).toBeNull()
  })
})

describe('Escape priority', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { activeElement: null })
    const commands = useCommandStore()
    useKeyboardShortcuts({ commands: commands.commands, executeCommand: commands.executeCommand })
  })

  function pressKey(key: string, extra: Partial<KeyboardEvent> = {}) {
    const event = { key, repeat: false, preventDefault: vi.fn(), ...extra }
    keyboard.listener!(event as KeyboardEvent)
    return event
  }

  it('consumes Escape for temporary modes before clearing selection, respecting repeats and focus', () => {
    const { scheme, selection } = setup()
    const ui = useUIStore()
    selection.toggleSelection('a', false)
    ui.setSelectingQuickAlignTarget(true)
    pressKey('Escape')
    expect(ui.isSelectingQuickAlignTarget).toBe(false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    pressKey('Escape', { repeat: true })
    expect(scheme.selectedItemIds.value.size).toBe(2)
    pressKey('Escape', { defaultPrevented: true })
    expect(scheme.selectedItemIds.value.size).toBe(2)
    vi.stubGlobal('document', { activeElement: { tagName: 'INPUT' } })
    pressKey('Escape')
    expect(scheme.selectedItemIds.value.size).toBe(2)
    vi.stubGlobal('document', { activeElement: null })
    pressKey('Escape')
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../../src/stores/editorStore'
import { useTabStore } from '../../src/stores/tabStore'
import { useEditorSelection } from '../../src/composables/editor/useEditorSelection'
import { useEditorHistory } from '../../src/composables/editor/useEditorHistory'
import { useEditorGroups } from '../../src/composables/editor/useEditorGroups'
import { useEditorItemAdd } from '../../src/composables/editor/useEditorItemAdd'
import { useClipboard } from '../../src/composables/useClipboard'
import type { AppItem } from '../../src/types/editor'
import { OrthographicCamera } from 'three'
import { shallowRef, ref, nextTick } from 'vue'
import { useThreeSelection } from '../../src/composables/useThreeSelection'
import { useUIStore } from '../../src/stores/uiStore'
import type { InteractionAdapter, RaycastHit } from '../../src/composables/renderer/types'
import { useCommandStore } from '../../src/stores/commandStore'
import { useKeyboardShortcuts } from '../../src/composables/useKeyboardShortcuts'
import { createCodeImportOps } from '../../src/composables/fileOps/codeImport'
import { NEW_SNAPSHOTS_JSON } from '../fixtures/gameJson'
import { useEditorManipulation } from '../../src/composables/editor/useEditorManipulation'
import { useSettingsStore } from '../../src/stores/settingsStore'
import { buildSharedSchemeSnapshot } from '../../src/lib/schemeSnapshot'

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

describe('local group selection preference', () => {
  it('defaults to individual selection, changes only future actions, and leaves normal selection unchanged', async () => {
    const { store, scheme, selection } = setup()
    const settings = useSettingsStore()
    expect(settings.settings.localGroupSelection).toBe(false)
    store.enterLocalEditing(['a', 'b', 'c', 'd'])
    selection.updateSelection(['a'], false)
    settings.settings.localGroupSelection = true
    await nextTick()
    expect([...scheme.selectedItemIds.value]).toEqual(['a'])
    selection.updateSelection(['a'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    settings.settings.localGroupSelection = false
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    selection.updateSelection(['a'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a']))
    settings.settings.localGroupSelection = true
    store.exitLocalEditing()
    selection.updateSelection(['a'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  })

  it('expands all selection actions only to the intersection of groups and the working set', () => {
    const { store, scheme, selection } = setup()
    scheme.items.value = [...scheme.items.value, item('e', 8)]
    store.triggerSceneUpdate()
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c', 'd'])
    selection.updateSelection(['b', 'c'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b', 'c']))
    selection.deselectItems(['b'])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['c']))
    selection.updateSelection(['a'], true)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b', 'c']))
    selection.intersectSelection(['b', 'e'])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    selection.selectAll()
    selection.deselectItems(['e'])
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b', 'c', 'd']))
    selection.toggleSelection('c', false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['c']))
    store.exitLocalEditing()
    store.enterLocalEditing(['b', 'c', 'd'])
    selection.updateSelection(['b'], false)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
    expect(store.isItemEditable('a')).toBe(false)
    expect(store.isItemEditable('e')).toBe(false)
  })

  it('lets explicit individual actions override the saved preference', () => {
    const { store, scheme, selection } = setup()
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c'])
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
    const { store, scheme, selection } = setup()
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c', 'd'])
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
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c'])
    selection.updateSelection(['a'], false, { skipGroupExpansion: true })
    selection.selectSameType()
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'c']))
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

describe('local editing scope', () => {
  it('enters without changing furniture, origins, history or the normal group-selection contract', () => {
    const { store, scheme, items, selection } = setup()
    selection.toggleSelection('a', false)
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    const history = scheme.history.value
    const count = history!.selectionUndoStack.length
    store.enterLocalEditing(['a', 'b'])
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(scheme.items.value).toBe(items)
    expect(scheme.items.value[0]).toBe(items[0])
    expect(history!.selectionUndoStack).toHaveLength(count)
    expect(history!.transactionUndoStack).toHaveLength(0)
    store.exitLocalEditing()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    selection.toggleSelection('a', false)
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
  })

  it('restricts every selection action and does not expand individual members', () => {
    const { store, scheme, selection } = setup()
    store.enterLocalEditing(['a', 'b'])
    selection.toggleSelection('b', false)
    expect([...scheme.selectedItemIds.value]).toEqual(['b'])
    selection.toggleSelection('c', false, { skipGroupExpansion: true })
    expect([...scheme.selectedItemIds.value]).toEqual(['b'])
    selection.updateSelection(['a', 'c', 'd'], false, { skipGroupExpansion: true })
    expect([...scheme.selectedItemIds.value]).toEqual(['a'])
    selection.invertSelection()
    expect([...scheme.selectedItemIds.value]).toEqual(['b'])
    selection.selectAll()
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    selection.deselectItems(['a'])
    expect([...scheme.selectedItemIds.value]).toEqual(['b'])
    selection.selectSameType()
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    selection.intersectSelection(['b', 'c'])
    expect([...scheme.selectedItemIds.value]).toEqual(['b'])
    selection.updateSelection(['a'], true)
    expect([...scheme.selectedItemIds.value]).toEqual(['b', 'a'])
  })

  it('accepts mixed groups and singles, rejects empty/missing entry and does not nest', () => {
    const { store, scheme, items, selection } = setup()
    store.enterLocalEditing([])
    store.enterLocalEditing(['missing'])
    expect(store.localEditingItemIds).toBeNull()
    const ids = new Set(['b', 'c', 'd', 'missing'])
    store.enterLocalEditing(ids)
    ids.clear()
    expect(store.localEditingItemIds).toEqual(new Set(['b', 'c', 'd']))
    expect(store.localEditingItemCount).toBe(3)
    store.enterLocalEditing(['a'])
    selection.selectAll()
    expect([...scheme.selectedItemIds.value]).toEqual(['b', 'c', 'd'])
    expect(scheme.items.value).toBe(items)
    selection.toggleSelection('b', false)
    expect([...scheme.selectedItemIds.value]).toEqual(['b'])
    expect(store.isItemEditable('a')).toBe(false)
  })

  it('sanitizes restored selections, retains members across regrouping, and counts only live furniture', () => {
    const { store, scheme } = setup()
    store.enterLocalEditing(['a', 'b'])
    scheme.selectedItemIds.value = new Set(['a', 'c'])
    store.triggerSelectionUpdate()
    expect([...scheme.selectedItemIds.value]).toEqual(['a'])
    scheme.items.value = scheme.items.value.filter((item) => item.internalId !== 'a')
    store.triggerSceneUpdate()
    expect(store.localEditingItemCount).toBe(1)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    scheme.items.value = scheme.items.value.map((item) =>
      item.internalId === 'b' ? { ...item, groupId: 8 } : item
    )
    store.triggerSceneUpdate()
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(store.isItemEditable('b')).toBe(true)
    expect(store.isItemEditable('c')).toBe(false)
  })

  it('keeps each scheme scope and selection independently without adding history', () => {
    const { store, scheme, selection, items } = setup()
    const tabs = useTabStore()
    store.enterLocalEditing(['a', 'b'])
    selection.updateSelection(['b'], false)
    const scope = store.localEditingItemIds
    const historyLength = scheme.history.value!.selectionUndoStack.length
    store.createScheme('other')
    const other = store.activeScheme!
    // Even overlapping internal IDs must use the target scheme's own scope.
    other.items.value = items
    store.triggerSceneUpdate()
    expect(store.localEditingItemIds).toBeNull()
    expect(store.isItemEditable('c')).toBe(true)
    store.enterLocalEditing(['c'])
    selection.selectAll()
    store.includeInLocalEditing(['d'])
    const otherScope = store.localEditingItemIds
    tabs.openSchemeTab(scheme.id, 'test')
    expect(store.localEditingItemIds).toBe(scope)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
    expect(scheme.history.value!.selectionUndoStack).toHaveLength(historyLength)
    expect(store.isItemEditable('c')).toBe(false)
    store.exitLocalEditing()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    tabs.openSchemeTab(other.id, 'other')
    expect(store.localEditingItemIds).toBe(otherScope)
    expect(other.selectedItemIds.value).toEqual(new Set(['c']))
    expect(store.isItemEditable('a')).toBe(false)
    tabs.openSchemeTab(scheme.id, 'test')
    expect(store.localEditingItemIds).toBeNull()
  })

  it('retains the working set across a help tab and ignores local actions without a scheme', () => {
    const { store, scheme, selection } = setup()
    store.enterLocalEditing(['a', 'b'])
    selection.updateSelection(['a'], false)
    const scope = store.localEditingItemIds
    const tabs = useTabStore()
    tabs.openDocTab('guide')
    expect(store.activeScheme).toBeNull()
    expect(store.localEditingItemIds).toBeNull()
    expect(store.localEditingItemCount).toBe(0)
    expect(store.isItemEditable('a')).toBe(false)
    store.enterLocalEditing(['c'])
    store.includeInLocalEditing(['c'])
    store.exitLocalEditing()
    tabs.openSchemeTab(scheme.id, 'test')
    expect(store.localEditingItemIds).toBe(scope)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a']))
  })

  it('discards a closed scheme scope even when reopening with the same scheme ID', async () => {
    const { store, scheme } = setup()
    store.enterLocalEditing(['a', 'b'])
    store.createScheme('other')
    const other = store.activeScheme!
    other.items.value = [item('other', 0)]
    store.enterLocalEditing(['other'])
    const scope = store.localEditingItemIds
    const tabs = useTabStore()
    const closedTab = tabs.tabs.find((tab) => tab.schemeId === scheme.id)!
    tabs.closeTab(closedTab.id)
    store.closeScheme(scheme.id)
    expect(store.localEditingItemIds).toBe(scope)
    const result = await store.reopenClosedScheme()
    expect(result.success).toBe(true)
    expect(result.schemeId).toBe(scheme.id)
    expect(store.localEditingItemIds).toBeNull()
    expect(store.activeScheme!.items.value).toHaveLength(4)
    tabs.openSchemeTab(other.id, 'other')
    expect(store.localEditingItemIds).toBe(scope)
  })

  it('starts archived and cloud schemes outside local editing without sharing the source scope', () => {
    const { store, scheme } = setup()
    store.enterLocalEditing(['a', 'b'])
    const snapshot = buildSharedSchemeSnapshot(scheme)
    expect(snapshot).not.toHaveProperty('localEditingItemIds')
    store.openArchivedSchemeSnapshot(snapshot)
    expect(store.localEditingItemIds).toBeNull()
    store.enterLocalEditing(['c'])
    store.openCloudSchemeSnapshot(snapshot, 'room')
    expect(store.localEditingItemIds).toBeNull()
  })

  it('preserves the scope during cloud normalization and snapshot replacement on return', () => {
    const { store, scheme, selection } = setup()
    store.enterLocalEditing(['a', 'b'])
    selection.updateSelection(['b'], false)
    const scope = store.localEditingItemIds
    const snapshot = buildSharedSchemeSnapshot(scheme)
    expect(store.normalizeSchemeAsCloudRoom(scheme.id, 'room')).toBe('room')
    expect(store.localEditingItemIds).toBe(scope)
    expect(store.activeScheme!.selectedItemIds.value).toEqual(new Set(['b']))
    store.createScheme('other')
    store.openCloudSchemeSnapshot(snapshot, 'room')
    expect(store.localEditingItemIds).toBe(scope)
    // Full cloud snapshots keep their existing selection-reset behavior.
    expect(store.activeScheme!.selectedItemIds.value.size).toBe(0)
    expect(store.isItemEditable('b')).toBe(true)
    expect(store.isItemEditable('c')).toBe(false)
    store.replaceSchemeSnapshot('room', { ...snapshot, items: [] })
    expect(store.localEditingItemCount).toBe(0)
    expect(store.localEditingItemIds).toBe(scope)
    store.replaceSchemeSnapshot('room', snapshot)
    expect(store.localEditingItemCount).toBe(2)
    expect(store.localEditingItemIds).toBe(scope)
  })

  it('keeps the existing target scheme scope when cloud normalization merges tabs', () => {
    const { store, scheme } = setup()
    store.openCloudSchemeSnapshot(buildSharedSchemeSnapshot(scheme), 'room')
    store.enterLocalEditing(['c'])
    const targetScope = store.localEditingItemIds
    useTabStore().openSchemeTab(scheme.id, 'test')
    store.enterLocalEditing(['a', 'b'])
    store.normalizeSchemeAsCloudRoom(scheme.id, 'room')
    expect(store.activeSchemeId).toBe('room')
    expect(store.localEditingItemIds).toBe(targetScope)
    expect(store.getSchemeById(scheme.id)).toBeNull()
  })
})

describe('local editing insertions and history', () => {
  it('retains an empty working set through deletion, undo and redo, and allows new furniture', () => {
    const { store, scheme, selection, history, items } = setup()
    store.enterLocalEditing(['a', 'b'])
    selection.selectAll()
    useEditorManipulation().deleteSelected()
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(store.localEditingItemCount).toBe(0)
    expect(store.isItemEditable('a')).toBe(false)
    history.undo()
    expect(store.localEditingItemCount).toBe(2)
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    history.redo()
    expect(store.localEditingItemCount).toBe(0)
    const added = useEditorItemAdd().addFurnitureItem(10)!
    expect(store.localEditingItemCount).toBe(1)
    expect(store.isItemEditable(added.internalId)).toBe(true)
    expect(scheme.items.value[0]).toBe(items[2])
  })

  it('includes code-imported furniture in the working set through undo and redo', async () => {
    const { store, scheme, items, history } = setup()
    store.enterLocalEditing(['d'])
    const payload = JSON.parse(NEW_SNAPSHOTS_JSON)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ type: 'combination', data: payload.Snapshots }),
      })
    )
    const notification = { success: vi.fn(), error: vi.fn() }
    const ops = createCodeImportOps({
      editorStore: store,
      notification: notification as any,
      t: (key) => key,
      ensureResourcesReady: vi.fn(),
      preloadActiveSchemeResources: vi.fn(),
    })
    await ops.importFromCode('fixture')
    const added = scheme.items.value.slice(4)
    expect(added).toHaveLength(2)
    expect(added.every((item) => store.isItemEditable(item.internalId))).toBe(true)
    expect(scheme.items.value.slice(0, 4)).toEqual(items)
    history.undo()
    expect(store.localEditingItemCount).toBe(1)
    history.redo()
    expect(store.localEditingItemCount).toBe(3)
  })

  it('includes singles and library combinations in the working set', () => {
    const { store } = setup()
    store.enterLocalEditing(['a', 'b'])
    const add = useEditorItemAdd()
    const single = add.addFurnitureItem(10)!
    expect(store.localEditingItemIds!.has(single.internalId)).toBe(true)
    const combined = add.addFurnitureCombination([
      { itemId: 11, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { itemId: 12, position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ])!
    expect(combined.every((item) => store.isItemEditable(item.internalId))).toBe(true)
  })

  it('includes pasted furniture and its origin without changing existing furniture, and is reversible', () => {
    const { store, scheme, items, history } = setup()
    store.enterLocalEditing(['a', 'b'])
    const clipboard = useClipboard()
    const source = item('x', 42)
    const data = {
      sourceSchemeId: 'elsewhere',
      items: [source],
      groupOrigins: new Map([[42, 'x']]),
    }
    const ids = clipboard.pasteItems(data, 0, 0)
    const inserted = scheme.items.value.find((item) => item.internalId === ids[0])!
    expect(store.isItemEditable(inserted.internalId)).toBe(true)
    expect(scheme.groupOrigins.value.get(inserted.groupId)).toBe(inserted.internalId)
    expect(scheme.items.value[2]).toBe(items[2])
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    history.undo()
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b', inserted.internalId]))
    expect(store.isItemEditable(inserted.internalId)).toBe(false)
    history.redo()
    expect(store.isItemEditable(inserted.internalId)).toBe(true)
  })

  it('keeps step-repeat in the working set and blocks source-ID paste', () => {
    const { store } = setup()
    store.clipboardList = {
      sourceSchemeId: 'elsewhere',
      items: [item('x', 42)],
      groupOrigins: new Map(),
    }
    const clipboard = useClipboard()
    store.enterLocalEditing(['a', 'b'])
    expect(clipboard.canPreserveSourceIds.value).toBe(false)
    expect(clipboard.advancedPaste({ mode: 'preserveIds' })).toEqual([])
    const ids = clipboard.advancedPaste({
      mode: 'stepRepeat',
      stepRepeat: {
        repeatCount: 2,
        positionDelta: { x: 10, y: 0, z: 0 },
        rotationDelta: { x: 0, y: 0, z: 0 },
        scaleMultiplier: { x: 1, y: 1, z: 1 },
      },
    })
    expect(ids).toHaveLength(2)
    expect(ids.every(store.isItemEditable)).toBe(true)
  })

  it('recognizes outside furniture even when it belongs to the same group', () => {
    const { store, scheme, history } = setup()
    history.recordTransaction('outside.member.move', () => {
      scheme.items.value = scheme.items.value.map((item) =>
        item.internalId === 'a' ? { ...item, x: 10 } : item
      )
      store.triggerSceneUpdate()
    })
    store.enterLocalEditing(['b', 'c'])
    history.undo()
    expect(store.localEditingItemIds).toBeNull()
    expect(store.itemsMap.get('a')!.x).toBe(0)
    store.enterLocalEditing(['b', 'c'])
    history.redo()
    expect(store.localEditingItemIds).toBeNull()
    expect(store.itemsMap.get('a')!.x).toBe(10)
  })

  it('exits before replaying shared origins that affect outside group members', () => {
    const { store, scheme, history } = setup()
    useEditorGroups().setGroupOrigin(7, 'b')
    store.enterLocalEditing(['b'])
    history.undo()
    expect(store.localEditingItemIds).toBeNull()
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
  })
})

describe('local grouping and shared origins', () => {
  it('allows selected members of a partial group to form a new group through the command', () => {
    const { store, scheme, selection } = setup()
    const hidden = item('e', 7)
    scheme.items.value = [...scheme.items.value, hidden]
    store.triggerSceneUpdate()
    store.enterLocalEditing(['a', 'b'])
    selection.selectAll()
    const commands = useCommandStore()
    expect(commands.isCommandEnabled('edit.group')).toBe(true)
    commands.executeCommand('edit.group')
    expect(store.itemsMap.get('a')!.groupId).toBe(9)
    expect(store.itemsMap.get('b')!.groupId).toBe(9)
    expect(store.itemsMap.get('e')).toBe(hidden)
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(commands.isCommandEnabled('edit.group')).toBe(false)
  })

  it('allows grouping and ungrouping without changing the working set or outside references', () => {
    const { store, scheme, items, selection, history } = setup()
    store.enterLocalEditing(['b', 'd'])
    selection.selectAll()
    const groups = useEditorGroups()
    groups.groupSelected()
    expect(store.itemsMap.get('b')!.groupId).toBe(9)
    expect(store.itemsMap.get('d')!.groupId).toBe(9)
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    expect(store.itemsMap.get('a')).toBe(items[0])
    expect(store.itemsMap.get('c')).toBe(items[2])
    history.undo()
    expect(store.localEditingItemIds).toEqual(new Set(['b', 'd']))
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
    history.redo()
    groups.ungroupSelected()
    expect(store.itemsMap.get('b')!.groupId).toBe(0)
    expect(store.itemsMap.get('d')!.groupId).toBe(0)
    expect(store.localEditingItemIds).toEqual(new Set(['b', 'd']))
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
  })

  it('preserves a remaining member origin when partially ungrouping', () => {
    const { store, scheme, items, selection, history } = setup()
    store.enterLocalEditing(['b'])
    selection.selectAll()
    useEditorGroups().ungroupSelected()
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    expect(store.itemsMap.get('a')).toBe(items[0])
    history.undo()
    expect(store.localEditingItemIds).toEqual(new Set(['b']))
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
  })

  it('clears the origin when its member leaves the group, for both grouping operations', () => {
    const { store, scheme, selection, history } = setup()
    store.enterLocalEditing(['a', 'b', 'd'])
    selection.updateSelection(['a'], false)
    useEditorGroups().ungroupSelected()
    expect(scheme.groupOrigins.value.has(7)).toBe(false)
    history.undo()
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    selection.updateSelection(['a', 'd'], false)
    useEditorGroups().groupSelected()
    expect(scheme.groupOrigins.value.has(7)).toBe(false)
    expect(store.itemsMap.get('b')!.groupId).toBe(7)
    expect(store.localEditingItemCount).toBe(3)
  })

  it('protects shared origins for partial groups and preserves the external-anchor contract', () => {
    const { store, scheme, selection, history } = setup()
    const groups = useEditorGroups()
    groups.setGroupOrigin(7, 'c')
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    store.enterLocalEditing(['b'])
    const length = scheme.history.value!.transactionUndoStack.length
    expect(groups.canEditGroupOrigin(7)).toBe(false)
    groups.setGroupOrigin(7, 'b')
    groups.clearGroupOrigin(7)
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(length)
    selection.selectAll()
    groups.ungroupSelected()
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    history.undo()
    store.exitLocalEditing()
    store.enterLocalEditing(['a', 'b', 'd'])
    expect(groups.canEditGroupOrigin(7)).toBe(true)
    groups.setGroupOrigin(7, 'd')
    expect(scheme.groupOrigins.value.get(7)).toBe('d')
    history.undo()
    expect(store.localEditingItemIds).not.toBeNull()
    expect(scheme.groupOrigins.value.get(7)).toBe('c')
    groups.clearGroupOrigin(7)
    expect(scheme.groupOrigins.value.has(7)).toBe(false)
  })

  it('rejects instance-ID edits that would renumber hidden furniture', () => {
    const { store, scheme, items } = setup()
    store.enterLocalEditing(['a', 'b'])
    expect(store.setItemInstanceId('a', items[2]!.instanceId)).toBe(false)
    expect(store.setItemInstanceId('c', 1500)).toBe(false)
    expect(scheme.items.value).toBe(items)
    expect(store.setItemInstanceId('a', items[1]!.instanceId)).toBe(true)
    expect(store.itemsMap.get('c')).toBe(items[2])
    expect(store.itemsMap.get('a')!.instanceId).toBe(items[1]!.instanceId)
    expect(store.itemsMap.get('b')!.instanceId).toBeGreaterThan(1200)
  })
})

describe('local editing pointer gestures', () => {
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

  it('uses the saved preference for clicks and lets the configured modifier pick an individual member', () => {
    const { store, scheme, click } = pointerSetup()
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c'])
    click(1000)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    keyboard.keys.ctrl.value = true
    click(2000, { ctrlKey: true })
    expect(scheme.selectedItemIds.value).toEqual(new Set(['b']))
    keyboard.keys.ctrl.value = false
    click(3000)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  })

  it('expands a box hit only to in-scope group members', () => {
    const { store, scheme, selection, controller, setCandidates } = pointerSetup()
    scheme.items.value = [...scheme.items.value, item('e', 7)]
    store.triggerSceneUpdate()
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c'])
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
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  })

  it('expands a lasso hit to other in-scope group members', () => {
    const { store, scheme, controller, setCandidates } = pointerSetup()
    useSettingsStore().settings.localGroupSelection = true
    store.enterLocalEditing(['a', 'b', 'c'])
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

  it('keeps single-click group selection, enters on double click, and exits only on double blank', () => {
    const { store, scheme, click, setHit } = pointerSetup()
    click(1000)
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    expect(store.localEditingItemIds).toBeNull()
    click(1200)
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    setHit(null)
    click(2000)
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    click(2200)
    expect(store.localEditingItemIds).toBeNull()
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })

  it('does not interpret modified clicks, touch, cancellation or slow clicks as entry', () => {
    const { store, click, controller } = pointerSetup()
    click(1000, { ctrlKey: true })
    click(1100, { ctrlKey: true })
    expect(store.localEditingItemIds).toBeNull()
    click(2000, { pointerType: 'touch' })
    click(2100, { pointerType: 'touch' })
    expect(store.localEditingItemIds).toBeNull()
    click(3000)
    controller.cancelSelectionSession()
    click(3100)
    expect(store.localEditingItemIds).toBeNull()
    click(4000)
    expect(store.localEditingItemIds).toBeNull()
  })

  it('keeps group selection actions individual, including region selection', () => {
    const { store, scheme, click, controller } = pointerSetup()
    store.enterLocalEditing(['a', 'b'])
    click(1000)
    click(1100)
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect([...scheme.selectedItemIds.value]).toEqual(['a'])
    const ui = useUIStore()
    ui.setSelectingQuickAlignTarget(true)
    click(1200)
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(ui.isSelectingQuickAlignTarget).toBe(false)
    controller.cancelSelectionSession()
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
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    store.selectionMode = 'lasso'
    controller.handlePointerDown(event(10, 10))
    for (const [x, y] of [
      [90, 10],
      [90, 90],
      [10, 90],
      [10, 10],
    ] as const) {
      controller.handlePointerMove(event(x, y))
    }
    controller.handlePointerUp(event(20, 20))
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
  })
})

describe('local editing commands and Escape priority', () => {
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

  it('allows the exit command when the working set contains no live furniture', () => {
    const { store, selection } = setup()
    store.enterLocalEditing(['a', 'b'])
    selection.selectAll()
    useEditorManipulation().deleteSelected()
    expect(store.localEditingItemCount).toBe(0)
    const commands = useCommandStore()
    expect(commands.isCommandEnabled('edit.exitLocalEditing')).toBe(true)
    commands.executeCommand('edit.exitLocalEditing')
    expect(store.localEditingItemIds).toBeNull()
  })

  it.each([false, true])(
    'toggles local editing with Shift+F, exiting with selection: %s',
    (hasSelection) => {
      const { store, scheme, selection } = setup()
      const commands = useCommandStore()
      const focus = vi.fn()
      commands.setZoomFunctions(null, focus)

      pressKey('F', { shiftKey: true })
      expect(store.localEditingItemIds).toBeNull()
      selection.updateSelection(['b', 'c', 'd'], false, { skipGroupExpansion: true })
      pressKey('f')
      expect(focus).toHaveBeenCalledTimes(1)
      expect(store.localEditingItemIds).toBeNull()
      pressKey('F', { shiftKey: true })
      expect(store.localEditingItemIds).toEqual(new Set(['b', 'c', 'd']))
      expect(scheme.selectedItemIds.value.size).toBe(0)
      expect(commands.isCommandEnabled('edit.enterLocalEditing')).toBe(false)
      expect(commands.isCommandEnabled('edit.exitLocalEditing')).toBe(true)
      pressKey('F', { shiftKey: true, repeat: true })
      expect(store.localEditingItemIds).toEqual(new Set(['b', 'c', 'd']))
      if (hasSelection) selection.selectAll()
      pressKey('F', { shiftKey: true })
      expect(store.localEditingItemIds).toBeNull()
      expect(scheme.selectedItemIds.value.size).toBe(0)
      expect(focus).toHaveBeenCalledTimes(1)
    }
  )

  it('ignores Shift+F while typing in an input', () => {
    const { store, selection } = setup()
    selection.updateSelection(['a'], false)
    vi.stubGlobal('document', { activeElement: { tagName: 'INPUT' } })
    expect(pressKey('F', { shiftKey: true }).preventDefault).not.toHaveBeenCalled()
    expect(store.localEditingItemIds).toBeNull()
  })

  it('consumes one Escape per action, respects temporary modes, repeats and input focus', () => {
    const { store, scheme } = setup()
    const ui = useUIStore()
    store.enterLocalEditing(['a', 'b'])
    useEditorSelection().toggleSelection('a', false)
    ui.setSelectingQuickAlignTarget(true)
    pressKey('Escape')
    expect(ui.isSelectingQuickAlignTarget).toBe(false)
    expect([...scheme.selectedItemIds.value]).toEqual(['a'])
    pressKey('Escape')
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    pressKey('Escape', { repeat: true })
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    pressKey('Escape', { defaultPrevented: true })
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    vi.stubGlobal('document', { activeElement: { tagName: 'INPUT' } })
    pressKey('Escape')
    expect(store.localEditingItemIds).toEqual(new Set(['a', 'b']))
    vi.stubGlobal('document', { activeElement: null })
    pressKey('Escape')
    expect(store.localEditingItemIds).toBeNull()
  })
})

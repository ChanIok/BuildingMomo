import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, type EffectScope } from 'vue'
import { useTabStore } from '@/stores/tabStore'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useGroupPanel } from '@/composables/editor/useGroupPanel'
import { useCollectionPanel, type CollectionEntry } from '@/composables/editor/useCollectionPanel'
import { UNCLASSIFIED } from '@/lib/collectionTree'
import { useGroupPanelSelection } from '@/composables/editor/useGroupPanelSelection'
import { makeAppItem, setGroupNames } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
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

function setup(tree = false) {
  return scope.run(() => {
    const store = useEditorStore()
    store.createScheme('list selection')
    const scheme = store.activeScheme!
    scheme.items.value = [
      makeAppItem({ internalId: 'g1-a', groupId: 1 }),
      makeAppItem({ internalId: 'g1-b', groupId: 1 }),
      ...Array.from({ length: 5 }, (_, index) =>
        makeAppItem({ internalId: `g${index + 2}`, groupId: index + 2 })
      ),
      makeAppItem({ internalId: 'loose', groupId: 0 }),
    ]
    if (tree)
      scheme.collectionTree.value = {
        nodes: [
          { id: 'a', name: 'House', parentId: null, order: 0 },
          { id: 'child', name: 'Floor', parentId: 'a', order: 0 },
          { id: 'b', name: 'Garden', parentId: null, order: 1 },
          { id: 'empty', name: 'Empty', parentId: null, order: 2 },
        ],
        groups: [
          { groupId: 1, collectionId: 'a', order: 0 },
          { groupId: 2, collectionId: 'child', order: 0 },
          { groupId: 3, collectionId: 'b', order: 0 },
        ],
      }
    setGroupNames(scheme, [
      [1, 'Walls'],
      [2, 'Roof'],
    ])
    const panel = useGroupPanel()
    const groups = panel.groups
    const query = ref('')
    const directory = useCollectionPanel(query, panel)
    const selection = useGroupPanelSelection(
      directory.rows,
      groups,
      directory.groupsForEntry,
      query
    )
    const click = (entry: CollectionEntry, modifiers: Partial<MouseEvent> = {}) =>
      selection.select(entry, { ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers })
    const group = (id: number, modifiers: Partial<MouseEvent> = {}) =>
      click({ kind: 'group', id }, modifiers)
    const collection = (id: string, modifiers: Partial<MouseEvent> = {}) =>
      click({ kind: 'collection', id }, modifiers)
    const ids = () => [...scheme.selectedItemIds.value].sort()
    return {
      store,
      scheme,
      groups,
      query,
      directory,
      selection,
      group,
      collection,
      ids,
      history: useEditorHistory(),
    }
  })!
}

it('replaces, adds, removes and completes a partial group as one unit, including Cmd', () => {
  const { scheme, group, ids, selection } = setup()
  useEditorSelection().updateSelection(['loose'], false)
  group(1)
  expect(ids()).toEqual(['g1-a', 'g1-b'])
  group(3, { ctrlKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g3'])
  group(1, { ctrlKey: true })
  expect(ids()).toEqual(['g3'])
  useEditorSelection().updateSelection(['g1-a', 'g3'], false, { skipGroupExpansion: true })
  expect(selection.selectionState({ kind: 'group', id: 1 })).toBe('partial')
  const before = scheme.history.value!.selectionUndoStack.length
  group(1, { metaKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g3'])
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(before + 1)
  group(1, { metaKey: true })
  expect(ids()).toEqual(['g3'])
  const count = scheme.history.value!.selectionUndoStack.length
  selection.deselect({ kind: 'group', id: 1 })
  expect(ids()).toEqual(['g3'])
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(count)
})

it('selects the ungrouped aggregate with modifiers, partial coverage, history and visibility protection', () => {
  const { store, scheme, group, ids, selection, history } = setup()
  scheme.items.value = [...scheme.items.value, makeAppItem({ internalId: 'loose-2', groupId: 0 })]
  const loose = { kind: 'ungrouped', id: 0 } as const
  const click = (modifiers = {}) =>
    selection.select(loose, { ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers })
  useEditorSelection().updateSelection(['loose'], false)
  expect(selection.selectionState(loose)).toBe('partial')
  expect(selection.isSelected(loose)).toBe(false)
  click()
  expect(ids()).toEqual(['loose', 'loose-2'])
  expect(selection.isSelected(loose)).toBe(true)
  group(2, { ctrlKey: true })
  expect(ids()).toEqual(['g2', 'loose', 'loose-2'])
  selection.deselect(loose)
  expect(ids()).toEqual(['g2'])
  group(6)
  click({ shiftKey: true })
  expect(ids()).toEqual(['g6', 'loose', 'loose-2'])
  history.undo()
  expect(ids()).toEqual(['g6'])
  history.redo()
  expect(ids()).toEqual(['g6', 'loose', 'loose-2'])
  store.selectionCategoryIds = new Set()
  click()
  expect(ids()).toEqual(['loose', 'loose-2'])
  expect(selection.selectionCoverage(loose)).toEqual({ selected: 2, total: 2 })
  store.setGroupHidden(0, true)
  click()
  expect(ids()).toEqual([])
  expect(store.groupsMap.has(0)).toBe(false)
  expect(scheme.collectionTree.value.groups.some((entry) => entry.groupId === 0)).toBe(false)
})

it('extends, shrinks and reverses a Shift range from a stable anchor', () => {
  const { group, ids, selection, scheme } = setup()
  group(2)
  group(5, { shiftKey: true })
  expect(ids()).toEqual(['g2', 'g3', 'g4', 'g5'])
  group(4, { shiftKey: true })
  expect(ids()).toEqual(['g2', 'g3', 'g4'])
  group(1, { shiftKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
  expect(selection.anchor.value).toEqual({ kind: 'group', id: 2 })
  const before = scheme.history.value!.selectionUndoStack.length
  group(1, { shiftKey: true })
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(before)
  group(6, { ctrlKey: true })
  group(3, { shiftKey: true })
  expect(ids()).toEqual(['g3', 'g4', 'g5', 'g6'])
})

it('retains the pre-range selection for Ctrl+Shift without accumulating old endpoints', () => {
  const { group, ids } = setup()
  group(6)
  group(2, { ctrlKey: true })
  group(5, { ctrlKey: true, shiftKey: true })
  expect(ids()).toEqual(['g2', 'g3', 'g4', 'g5', 'g6'])
  group(3, { ctrlKey: true, shiftKey: true })
  expect(ids()).toEqual(['g2', 'g3', 'g6'])
  group(1, { metaKey: true, shiftKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2', 'g6'])
  group(3, { shiftKey: true })
  expect(ids()).toEqual(['g2', 'g3'])
})

it('selects collection nodes through search/folding and preserves explicitly selected children on parent toggle', () => {
  const { scheme, collection, group, query, ids, selection, directory } = setup(true)
  directory.toggleCollection('a')
  collection('a')
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
  expect(selection.selectionState({ kind: 'collection', id: 'a' })).toBe('full')
  const collapsed = scheme.collapsedCollectionIds.value
  query.value = 'Walls'
  expect(directory.rows.value.some((row) => row.kind === 'group' && row.id === 2)).toBe(false)
  group(1, { ctrlKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
  expect(selection.isSelected({ kind: 'group', id: 1 })).toBe(true)
  expect(selection.isSelected({ kind: 'collection', id: 'a' })).toBe(true)
  selection.deselect({ kind: 'collection', id: 'a' })
  expect(ids()).toEqual(['g1-a', 'g1-b'])
  expect(selection.selectionState({ kind: 'collection', id: 'a' })).toBe('partial')
  expect(selection.isSelected({ kind: 'collection', id: 'a' })).toBe(false)
  group(1, { ctrlKey: true })
  expect(ids()).toEqual([])
  collection('a', { ctrlKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
  collection('a', { ctrlKey: true })
  expect(ids()).toEqual([])
  expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
  query.value = ''
  collection(UNCLASSIFIED)
  expect(ids()).toEqual(['g4', 'g5', 'g6'])
  collection('empty', { ctrlKey: true })
  expect(ids()).toEqual(['g4', 'g5', 'g6'])
  expect(selection.selectionState({ kind: 'collection', id: 'empty' })).toBe('none')
  expect(selection.isSelected({ kind: 'collection', id: 'empty' })).toBe(true)
  selection.deselect({ kind: 'collection', id: 'empty' })
  expect(selection.isSelected({ kind: 'collection', id: 'empty' })).toBe(false)
  expect(ids()).toEqual(['g4', 'g5', 'g6'])
})

it('uses visible tree order for ranges while treating each collection as a whole unit', () => {
  const { directory, collection, group, ids, scheme } = setup(true)
  directory.toggleCollection('a')
  collection('a')
  collection('b', { shiftKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2', 'g3'])
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(2)
  // 同一集合及其可见子组不能被重复切换选择状态。
  directory.toggleCollection('a')
  collection('a')
  group(1, { shiftKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
})

it('distinguishes explicit collection nodes from content coverage, including empty folders and canvas changes', () => {
  const { group, collection, selection, directory, scheme, ids } = setup(true)
  group(1)
  group(2, { ctrlKey: true })
  const house = { kind: 'collection', id: 'a' } as const
  expect(selection.selectionState(house)).toBe('full')
  expect(selection.isSelected(house)).toBe(false)
  const historyCount = scheme.history.value!.selectionUndoStack.length
  collection('a')
  expect(selection.isSelected(house)).toBe(true)
  expect(selection.isSelected({ kind: 'group', id: 1 })).toBe(false)
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(historyCount)
  collection('empty')
  expect(ids()).toEqual([])
  expect(selection.entries.value).toEqual([{ kind: 'collection', id: 'empty' }])
  directory.deleteCollection('empty')
  expect(selection.entries.value).toEqual([])
  useEditorSelection().updateSelection(['g1-a', 'g1-b', 'g2'], false)
  expect(selection.entries.value).toEqual([
    { kind: 'group', id: 1 },
    { kind: 'group', id: 2 },
  ])
  expect(selection.isSelected(house)).toBe(false)
})

it('honors protection, ignores category filters and marks all selectable members as full', () => {
  const { store, scheme, collection, group, selection, ids } = setup(true)
  store.setGroupLocked(2, true)
  store.setGroupHidden(3, true)
  store.selectionCategoryIds = new Set()
  collection('a')
  expect(ids()).toEqual(['g1-a', 'g1-b'])
  expect(selection.selectionState({ kind: 'group', id: 1 })).toBe('full')
  expect(selection.selectionState({ kind: 'collection', id: 'a' })).toBe('full')
  group(2, { ctrlKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b'])
  collection('b', { ctrlKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b'])
  collection(UNCLASSIFIED, { ctrlKey: true })
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g4', 'g5', 'g6'])
  collection('a', { ctrlKey: true })
  expect(ids()).toEqual(['g4', 'g5', 'g6'])
  expect(scheme.items.value).toHaveLength(8)
})

it('retains explicit empty nodes through unrelated protection updates and ignores unchanged flags', () => {
  const { store, scheme, collection, selection } = setup(true)
  const empty = { kind: 'collection', id: 'empty' } as const
  collection('empty')
  store.setGroupLocked(2, true)
  store.setGroupHidden(3, true)
  store.setCollectionRestriction('b', 'locked', true)
  expect(selection.entries.value).toEqual([empty])
  expect(selection.anchor.value).toEqual(empty)
  const version = store.selectionVersion
  const locked = scheme.lockedGroupIds.value,
    hidden = scheme.hiddenGroupIds.value
  const folders = scheme.lockedCollectionIds.value
  store.setGroupLocked(2, true)
  store.setGroupHidden(3, true)
  store.setCollectionRestriction('b', 'locked', true)
  expect(store.selectionVersion).toBe(version)
  expect(scheme.lockedGroupIds.value).toBe(locked)
  expect(scheme.hiddenGroupIds.value).toBe(hidden)
  expect(scheme.lockedCollectionIds.value).toBe(folders)
  useEditorSelection().updateSelection(['g4'], false)
  expect(selection.entries.value).toEqual([{ kind: 'group', id: 4 }])
})

it('resets range state after canvas changes, searches, hidden anchors and scheme switches', () => {
  const { store, scheme, group, query, selection, ids } = setup()
  group(2)
  group(5, { shiftKey: true })
  useEditorSelection().updateSelection(['g6'], false)
  expect(selection.anchor.value).toBeNull()
  group(4, { shiftKey: true })
  expect(ids()).toEqual(['g4'])
  group(2)
  query.value = '6'
  group(6, { shiftKey: true })
  expect(ids()).toEqual(['g6'])
  query.value = ''
  group(2)
  const other = store.createScheme('other')
  store.activeScheme!.items.value = [makeAppItem({ internalId: 'other-item', groupId: 1 })]
  expect(selection.anchor.value).toBeNull()
  group(1, { shiftKey: true })
  expect([...store.activeScheme!.selectedItemIds.value]).toEqual(['other-item'])
  useTabStore().openSchemeTab(scheme.id, 'list selection')
  expect(selection.anchor.value).toBeNull()
  expect(other).not.toBe(scheme.id)
})

it('drops an anchor folded out of the tree, and supports a keyboard fallback anchor', () => {
  const { group, collection, directory, selection, ids } = setup(true)
  group(2)
  directory.toggleCollection('a')
  expect(selection.anchor.value).toBeNull()
  collection('b', { shiftKey: true })
  expect(ids()).toEqual(['g3'])
  selection.reset()
  selection.select(
    { kind: 'group', id: 6 },
    { shiftKey: true, ctrlKey: false, metaKey: false },
    { kind: 'group', id: 4 }
  )
  expect(ids()).toEqual(['g4', 'g5', 'g6'])
})

it('records a single selection entry per gesture and replays selection without editing scene data', () => {
  const { store, scheme, group, selection, ids, history } = setup(true)
  const items = scheme.items.value,
    tree = scheme.collectionTree.value,
    version = store.sceneVersion
  group(1)
  group(2, { ctrlKey: true })
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(2)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(0)
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
  history.undo()
  expect(ids()).toEqual(['g1-a', 'g1-b'])
  expect(selection.selectionState({ kind: 'collection', id: 'a' })).toBe('partial')
  expect(selection.anchor.value).toBeNull()
  history.redo()
  expect(ids()).toEqual(['g1-a', 'g1-b', 'g2'])
  expect(selection.selectionState({ kind: 'collection', id: 'a' })).toBe('full')
  expect(selection.isSelected({ kind: 'collection', id: 'a' })).toBe(false)
  expect(scheme.items.value).toBe(items)
  expect(scheme.collectionTree.value).toBe(tree)
  expect(store.sceneVersion).toBe(version)
})

it('selects logical rows far beyond the mounted viewport in one history step', () => {
  const { scheme, group, ids } = setup()
  scheme.items.value = Array.from({ length: 1000 }, (_, index) =>
    makeAppItem({ internalId: `item-${index + 1}`, groupId: index + 1 })
  )
  group(1)
  group(1000, { shiftKey: true })
  expect(ids()).toHaveLength(1000)
  expect(scheme.history.value!.selectionUndoStack).toHaveLength(2)
  group(3, { shiftKey: true })
  expect(ids()).toEqual(['item-1', 'item-2', 'item-3'])
})

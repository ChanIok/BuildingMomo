import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import {
  createRenderer,
  createSSRApp,
  h,
  nextTick,
  shallowReactive,
  ssrContextKey,
  watch,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import GroupPanel from '@/components/GroupPanel.vue'
import GroupPanelRow from '@/components/GroupPanelRow.vue'
import GroupMergeDialog from '@/components/GroupMergeDialog.vue'
import GroupMetadataImportDialog from '@/components/GroupMetadataImportDialog.vue'
import type { CollectionRow } from '@/composables/editor/useCollectionPanel'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import * as groupVirtualList from '@/composables/editor/useGroupVirtualList'
import { makeAppItem } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('document', { activeElement: null })
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

// Exercise component command wiring in a Vue lifecycle, without rendering the UI tree.
function mountSetup<T>(setup: () => T): T {
  const { createApp } = createRenderer<object, object>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  let state!: T
  const app = createApp({
    setup() {
      state = setup()
      return () => h('div')
    },
  })
  app.use(createPinia())
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  cleanups.push(() => app.unmount())
  return state
}

function panelSetup() {
  const store = useEditorStore(),
    ui = useUIStore()
  store.createScheme('panel commands')
  const scheme = store.activeScheme!
  scheme.items.value = [7, 8, 0].map((groupId, index) =>
    makeAppItem({ internalId: `item-${index}`, groupId, instanceId: 10 + index })
  )
  scheme.maxGroupId.value = 8
  scheme.maxInstanceId.value = 12
  scheme.collectionTree.value = {
    nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
    groups: [7, 8].map((groupId) => ({ groupId, collectionId: 'house', order: groupId })),
  }
  ui.groupPanelOpen = true
  const panel = (GroupPanel as any).setup({}, { expose() {} })
  panel.list.value = { contains: () => true, querySelector: () => null }
  return { store, scheme, ui, panel }
}

it('marks selected contents along folded paths without selecting their ancestor nodes', async () => {
  const { scheme, panel } = mountSetup(panelSetup)
  scheme.collectionTree.value = {
    nodes: [
      ...scheme.collectionTree.value.nodes,
      { id: 'room', name: 'Room', parentId: 'house', order: 0 },
      { id: 'garden', name: 'Garden', parentId: null, order: 1 },
    ],
    groups: [
      { groupId: 7, collectionId: 'room', order: 0 },
      { groupId: 8, collectionId: 'garden', order: 0 },
    ],
  }
  scheme.collapsedCollectionIds.value = new Set(['house', 'room', 'garden'])
  const collapsed = scheme.collapsedCollectionIds.value
  const selection = useEditorSelection()
  async function render(id: string | number) {
    const row = panel.rows.value.find((row: CollectionRow) => row.id === id)
    return renderToString(
      createSSRApp({ render: () => h(GroupPanelRow, { ...panel.rowProps(row), offset: 0 }) })
    )
  }
  selection.updateSelection(['item-0'], false)
  await nextTick()
  const ancestor = await render('house')
  expect(ancestor).toContain('data-selection="full"')
  expect(ancestor).toContain('aria-selected="false"')
  expect(ancestor).toContain('data-group-contains-selection')
  expect(ancestor).toContain('data-group-hint="groups.containsSelection"')
  expect(ancestor).not.toContain('data-group-deselect')
  expect(ancestor).not.toContain('bg-primary/12 text-primary')
  expect(ancestor).toContain('bg-primary/12 hover:bg-primary/16')
  expect(scheme.selectedEntries.value).toBeNull()
  expect(panel.selectedEntries.value).toEqual([{ kind: 'group', id: 7 }])
  expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
  expect(await render('garden')).not.toContain('data-group-contains-selection')
  expect(await render('garden')).not.toContain('bg-primary/12')
  panel.toggleCollection('house')
  expect(await render('house')).not.toContain('bg-primary/12')
  expect(await render('room')).toContain('data-group-contains-selection')
  expect(await render('room')).toContain('bg-primary/12')
  panel.toggleCollection('room')
  expect(await render('room')).not.toContain('bg-primary/12')
  expect(await render(7)).toContain('data-group-deselect')
  scheme.items.value = [...scheme.items.value, makeAppItem({ internalId: 'part', groupId: 7 })]
  const partial = await render(7)
  expect(partial).toContain('data-selection="partial"')
  expect(partial).toContain('data-group-contains-selection')
  expect(partial).not.toContain('data-group-deselect')
  selection.updateSelection(['item-0', 'item-1'], false, { skipGroupExpansion: true })
  expect(await render('house')).toContain('data-group-contains-selection')
  expect(await render('garden')).toContain('data-group-contains-selection')
  expect(await render('garden')).toContain('bg-primary/12')
  selection.clearSelection()
  expect(await render('house')).not.toContain('data-group-contains-selection')
  expect(await render(7)).not.toContain('data-group-contains-selection')
  expect(await render('garden')).not.toContain('bg-primary/12')
  const root = panel.rows.value.find((row: CollectionRow) => row.id === 'house')
  panel.activate(root, { ctrlKey: false, metaKey: false, shiftKey: false })
  expect(await render('house')).toContain('data-group-deselect')
  expect(await render('house')).not.toContain('data-group-contains-selection')
  expect(await render('house')).toContain('bg-primary/12 text-primary')
  expect(scheme.selectedEntries.value).toEqual([{ kind: 'collection', id: 'house' }])
  const coveredGroup = await render(7)
  expect(coveredGroup).toContain('data-selection-presentation="covered"')
  expect(coveredGroup).not.toContain('data-group-contains-selection')
  expect(coveredGroup).not.toContain('data-group-deselect')
  expect(coveredGroup).not.toContain('bg-primary/12')
  panel.toggleCollection('room')
  const coveredCollection = await render('room')
  expect(coveredCollection).toContain('data-selection-presentation="covered"')
  expect(coveredCollection).toContain('lucide-folder')
  expect(coveredCollection).not.toContain('data-group-contains-selection')
  expect(coveredCollection).not.toContain('data-group-deselect')
  expect(coveredCollection).not.toContain('bg-primary/12')
})

it('follows a single canvas group to its visible ancestor without expanding or chasing multi-selection', async () => {
  const original = groupVirtualList.useGroupVirtualList
  const scroll = vi.fn()
  const spy = vi.spyOn(groupVirtualList, 'useGroupVirtualList').mockImplementation((...args) => ({
    ...original(...args),
    scrollToEntry: scroll,
  }))
  cleanups.push(() => spy.mockRestore())
  const { scheme, panel } = mountSetup(panelSetup)
  scheme.collectionTree.value = {
    nodes: [
      ...scheme.collectionTree.value.nodes,
      { id: 'room', name: 'Room', parentId: 'house', order: 0 },
    ],
    groups: scheme.collectionTree.value.groups.map((group) =>
      group.groupId === 7 ? { ...group, collectionId: 'room' } : group
    ),
  }
  scheme.collapsedCollectionIds.value = new Set(['house', 'room'])
  const collapsed = scheme.collapsedCollectionIds.value
  const selection = useEditorSelection()
  async function select(ids: string[]) {
    scroll.mockClear()
    selection.updateSelection(ids, false)
    await nextTick()
    await nextTick()
  }
  await select(['item-0'])
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ kind: 'collection', id: 'house' })
  expect(scheme.collapsedCollectionIds.value).toBe(collapsed)
  expect(scheme.activeGroupId.value).toBe(7)
  expect(scheme.activeCollectionId.value).toBeNull()
  panel.toggleCollection('house')
  await select(['item-1'])
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ kind: 'group', id: 8 })
  await select(['item-0'])
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ kind: 'collection', id: 'room' })
  expect(scheme.collapsedCollectionIds.value).toEqual(new Set(['room']))
  await select(['item-0', 'item-1'])
  expect(scroll).not.toHaveBeenCalled()
  selection.updateSelection(['item-0'], false)
  await nextTick()
  selection.updateSelection(['item-0', 'item-1'], false)
  await nextTick()
  await nextTick()
  expect(scroll).not.toHaveBeenCalled()
  panel.pointerInside.value = true
  await select(['item-0'])
  expect(scroll).not.toHaveBeenCalled()
  panel.pointerInside.value = false
  panel.query.value = 'House'
  await select(['item-1'])
  expect(scroll).not.toHaveBeenCalled()
})

it.each(['group', 'collection'])(
  'keeps the %s visibility switch editable and distinct from inherited hiding',
  async (kind) => {
    const { store, scheme, panel } = mountSetup(panelSetup)
    scheme.collectionTree.value = {
      nodes: [
        ...scheme.collectionTree.value.nodes,
        { id: 'room', name: 'Room', parentId: 'house', order: 0 },
      ],
      groups: scheme.collectionTree.value.groups.map((group) =>
        group.groupId === 7 ? { ...group, collectionId: 'room' } : group
      ),
    }
    const row = () =>
      panel.rows.value.find(
        (row: CollectionRow) => row.kind === kind && row.id === (kind === 'group' ? 7 : 'room')
      )
    async function checkSwitch(
      ownHidden: boolean,
      inheritedHidden: boolean,
      lockHint = 'lockHint'
    ) {
      const props = panel.rowProps(row())
      const html = await renderToString(
        createSSRApp({ render: () => h(GroupPanelRow, { ...props, offset: 0 }) })
      )
      if (props.selectionPresentation === 'selected') {
        expect(html.indexOf('data-group-deselect')).toBeGreaterThan(-1)
        expect(html.indexOf('data-group-deselect')).toBeLessThan(html.indexOf('data-group-name'))
      } else expect(html).not.toContain('data-group-deselect')
      if (kind === 'collection')
        expect(html.includes('lucide-folder')).toBe(
          props.selectionPresentation === 'none' || props.selectionPresentation === 'covered'
        )
      const button = html.match(
        /<button\b[^>]*aria-label="groups\.(?:show|hide)"[^>]*>[\s\S]*?<\/button>/
      )![0]
      expect(button).toContain(`aria-pressed="${ownHidden}"`)
      expect(button).toContain(`aria-label="groups.${ownHidden ? 'show' : 'hide'}"`)
      expect(button).not.toMatch(/\sdisabled(?:[\s=>])/)
      expect(button.includes('lucide-eye-off')).toBe(ownHidden)
      expect(button.includes('opacity-60')).toBe(inheritedHidden)
      const hint = [
        `groups.${ownHidden ? 'showHint' : 'hideHint'}`,
        ...(inheritedHidden ? ['groups.hiddenByParent'] : []),
        'groups.showOnlyHint',
      ].join('\n')
      expect(html).toContain(`data-group-hint="${hint}"`)
      expect(html).toContain(`data-group-hint="groups.${lockHint}"`)
      if (inheritedHidden) {
        expect(button).toContain('aria-description="groups.hiddenBy"')
      } else expect(button).not.toContain('aria-description')
    }
    await checkSwitch(false, false)
    panel.activate(row(), { ctrlKey: false, metaKey: false, shiftKey: false })
    await checkSwitch(false, false)
    panel.deselectRow(row())
    await checkSwitch(false, false)
    store.setCollectionRestriction('house', 'hidden', true)
    await checkSwitch(false, true)
    panel.toggleVisibility(row(), { altKey: false })
    await checkSwitch(true, true)
    panel.toggleVisibility(row(), { altKey: false })
    await checkSwitch(false, true)
    expect(store.isItemVisible('item-0')).toBe(false)
    panel.toggleVisibility(row(), { altKey: false })
    store.setCollectionRestriction('house', 'hidden', false)
    await checkSwitch(true, false)
    expect(store.isItemVisible('item-0')).toBe(false)
    expect(store.isItemVisible('item-1')).toBe(true)
    panel.toggleVisibility(row(), { altKey: false })
    expect(store.isItemVisible('item-0')).toBe(true)
    if (kind === 'group') store.setGroupLocked(7, true)
    else store.setCollectionRestriction('room', 'locked', true)
    await checkSwitch(false, false, 'unlockHint')
    store.setCollectionRestriction('house', 'locked', true)
    await checkSwitch(false, false, 'lockedByParent')
  }
)

it('does not adopt the ungrouped category or delete originals after pasting one furniture item', async () => {
  const { panel, scheme } = mountSetup(panelSetup)
  scheme.selectedItemIds.value = new Set(['item-2'])
  panel.copyNodes()
  const originals = scheme.items.value
  const result = panel.pasteItems(panel.clipboard.value, 0, 0)
  await nextTick()
  expect(result.newIds).toHaveLength(1)
  expect(scheme.selectedItemIds.value).toEqual(new Set(result.newIds))
  expect(panel.selectedEntries.value).toEqual([])
  panel.listKey({ key: 'Delete', preventDefault() {}, stopPropagation() {} })
  expect(scheme.items.value.map((item) => item.internalId)).toEqual([
    ...originals.map((item) => item.internalId),
    ...result.newIds,
  ])
})

it('merges the captured panel scope rather than a later canvas selection, with undo', async () => {
  const { panel, scheme, ui, dialog } = mountSetup(() => {
    const state = panelSetup()
    state.store.setGroupHidden(7, true)
    state.store.setGroupLocked(8, true)
    const props = shallowReactive({ open: false })
    watch(
      () => state.ui.groupMergeOpen,
      (open) => {
        props.open = open
      }
    )
    const dialog = (GroupMergeDialog as any).setup(props, {
      expose() {},
      emit: (_event: string, open: boolean) => {
        state.ui.groupMergeOpen = open
      },
    })
    return { ...state, dialog }
  })
  await nextTick()
  panel.activate(panel.rows.value[0], { ctrlKey: false, metaKey: false, shiftKey: false })
  panel.prepareMenu({
    target: { closest: () => ({ dataset: { rowKey: 'collection:house' } }) },
    preventDefault() {},
  })
  panel.setMenuOpen(true)
  panel.requestGroup(panel.menuGroupTarget.value)
  await nextTick()
  expect(ui.groupMergeOpen).toBe(true)
  dialog.target.value = '8'
  useEditorSelection().updateSelection(['item-2'], false)
  await nextTick()
  expect(dialog.canSubmit.value).toBe(true)
  dialog.submit()
  await nextTick()
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([8, 8, 0])
  expect(scheme.selectedItemIds.value).toEqual(new Set(['item-2']))
  expect(ui.groupMergeTarget).toBeNull()
  useEditorHistory().undo()
  expect(scheme.items.value.map((item) => item.groupId)).toEqual([7, 8, 0])
  expect(scheme.hiddenGroupIds.value.has(7)).toBe(true)
})

it('does not submit metadata to another scheme even before the close watcher runs', async () => {
  const { store, source, target, dialog, emit } = mountSetup(() => {
    const store = useEditorStore()
    store.createScheme('Source')
    const source = store.activeScheme!
    source.items.value = [makeAppItem({ groupId: 7 })]
    source.collectionTree.value = {
      nodes: [],
      groups: [{ groupId: 7, name: 'Walls', collectionId: null, order: 0 }],
    }
    store.createScheme('Target')
    const target = store.activeScheme!
    target.items.value = [makeAppItem({ groupId: 7 })]
    const emit = vi.fn()
    const dialog = (GroupMetadataImportDialog as any).setup(shallowReactive({ open: true }), {
      expose() {},
      emit,
    })
    return { store, source, target, dialog, emit }
  })
  dialog.sourceId.value = source.id
  expect(dialog.canSubmit.value).toBe(true)
  store.createScheme('Other target')
  const other = store.activeScheme!
  other.items.value = target.items.value
  expect(dialog.canSubmit.value).toBe(true)
  const targetHistory = target.history.value,
    otherHistory = other.history.value
  dialog.submit()
  expect(target.collectionTree.value.groups).toEqual([])
  expect(other.collectionTree.value.groups).toEqual([])
  expect(target.history.value).toBe(targetHistory)
  expect(other.history.value).toBe(otherHistory)
  await nextTick()
  expect(emit).toHaveBeenCalledWith('update:open', false)
})

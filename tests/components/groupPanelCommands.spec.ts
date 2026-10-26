import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createRenderer, h, nextTick, shallowReactive, ssrContextKey, watch } from 'vue'
import GroupPanel from '@/components/GroupPanel.vue'
import GroupMergeDialog from '@/components/GroupMergeDialog.vue'
import GroupMetadataImportDialog from '@/components/GroupMetadataImportDialog.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
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

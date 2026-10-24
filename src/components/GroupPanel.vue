<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch, watchPostEffect } from 'vue'
import { FolderPlus, Layers, ListChevronsDownUp, Search, X } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/composables/useI18n'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { useClipboard } from '@/composables/useClipboard'
import { hasTextSelection } from '@/lib/keyboard'
import type { GroupEditTarget } from '@/types/editor'
import { useGroupPanel } from '@/composables/editor/useGroupPanel'
import {
  useCollectionPanel,
  type CollectionEntry,
  type CollectionRow,
} from '@/composables/editor/useCollectionPanel'
import GroupPanelRow from './GroupPanelRow.vue'
import GroupPanelHints from './GroupPanelHints.vue'
import { useGroupPanelSelection } from '@/composables/editor/useGroupPanelSelection'
import { groupRowKey as keyOf, useGroupVirtualList } from '@/composables/editor/useGroupVirtualList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu'

const store = useEditorStore()
const uiStore = useUIStore()
const { t } = useI18n()
const { groups, ungrouped, renameGroup, canRenameGroup } = useGroupPanel()
const { canGroupSelection, canUngroupSelection, requestGroup, ungroupSelected } = useEditorGroups()
const {
  copy: copyNodes,
  clipboard,
  canPaste,
  buildClipboardDataFromSelection,
  pasteItems,
} = useClipboard()
const query = ref('')
const {
  rows,
  destinations,
  canEdit,
  createCollection,
  renameCollection,
  deleteCollection,
  canDeleteEntries,
  deleteEntries,
  canMoveMany,
  moveMany,
  normalizeEntries,
  activateCollection,
  toggleCollection,
  revealCollection,
  collapseAll,
  restriction,
  groupsForEntry,
} = useCollectionPanel(query, { groups, ungrouped })
const {
  select,
  deselect,
  clear: clearSelection,
  adopt: adoptSelection,
  selectionState,
  selectionCoverage,
  isSelected,
  entries: selectedEntries,
  reset: resetSelectionAnchor,
} = useGroupPanelSelection(rows, groups, groupsForEntry, query)
const editing = ref<CollectionEntry | null>(null)
const dragged = ref<CollectionEntry | null>(null)
const dragEntries = shallowRef<CollectionEntry[]>([])
const dropTarget = ref<{
  key: string
  parentId: string | null
  siblingId?: string | number
  after: boolean
  inside: boolean
} | null>(null)
const draft = ref('')
const list = ref<HTMLElement | null>(null)
const viewport = shallowRef<HTMLElement | null>(null)
const focused = ref<CollectionEntry | null>(null)
type MenuTarget = CollectionEntry | 'background'
const openMenu = ref<MenuTarget | null>(null)
const menuTarget = ref<MenuTarget | null>(null)
let menuInteractedOutside = false
const pinnedEntries = computed(() => [
  editing.value,
  dragged.value,
  focused.value,
  openMenu.value === 'background' ? null : openMenu.value,
])
const { virtualRows, totalHeight, indexByKey, scrollToEntry, elementFor } = useGroupVirtualList(
  rows,
  viewport,
  pinnedEntries
)
const menuRow = computed(() => {
  const index =
    menuTarget.value && menuTarget.value !== 'background'
      ? indexByKey.value.get(keyOf(menuTarget.value))
      : undefined
  return index === undefined ? undefined : rows.value[index]
})
const menuEntries = computed(() => (menuRow.value ? selectedEntries.value : []))
const canOrganizeMenu = computed(() =>
  menuEntries.value.every((entry) => entry.kind !== 'ungrouped')
)
const menuGroupTarget = computed<GroupEditTarget>(() => ({
  kind: 'groups',
  schemeId: store.activeScheme?.id ?? '',
  groupIds: canOrganizeMenu.value ? [...new Set(menuEntries.value.flatMap(groupsForEntry))] : [],
}))
const singleMenuEntry = computed(() => menuEntries.value.length === 1)
const menuDestinations = computed(() =>
  destinations.value.filter((entry) => canMoveMany(menuEntries.value, entry.id))
)
watchPostEffect(() => {
  viewport.value =
    list.value?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
})
const pointerInside = ref(false)
const hasHidden = computed(
  () =>
    !!(
      store.activeScheme?.hiddenGroupIds.value.size ||
      store.activeScheme?.hiddenCollectionIds.value.size
    )
)
const hasLocked = computed(
  () =>
    !!(
      store.activeScheme?.lockedGroupIds.value.size ||
      store.activeScheme?.lockedCollectionIds.value.size
    )
)
let panelSelectionVersion = -1
// 成组命令同时负责“合并到已有组”，可用性与执行统一由组编辑入口判定。
const canGroup = computed(() => canGroupSelection())

function close() {
  uiStore.groupPanelOpen = false
  document
    .querySelector<HTMLButtonElement>('[data-group-panel-toggle]')
    ?.focus({ preventScroll: true })
}

function entryOf(row: CollectionEntry): CollectionEntry {
  return row.kind !== 'collection'
    ? { kind: row.kind, id: row.id }
    : { kind: 'collection', id: row.id }
}
function nameOf(row: CollectionRow) {
  return row.kind !== 'collection' ? row.group.name : row.name
}
function isEditing(row: CollectionRow) {
  return editing.value && keyOf(editing.value) === keyOf(row)
}

function dropPosition(row: CollectionRow): 'inside' | 'before' | 'after' | null {
  const target = dropTarget.value
  if (!target || target.key !== keyOf(row)) return null
  return target.inside ? 'inside' : target.after ? 'after' : 'before'
}

function setDropTarget(target: typeof dropTarget.value) {
  const previous = dropTarget.value
  if (
    previous?.key === target?.key &&
    previous?.parentId === target?.parentId &&
    previous?.siblingId === target?.siblingId &&
    previous?.inside === target?.inside &&
    previous?.after === target?.after
  )
    return
  dropTarget.value = target
}

async function startRename(row: CollectionRow) {
  if (row.kind === 'ungrouped') return
  if (row.kind === 'group' ? !canRenameGroup(row.id) : row.virtual || !canEdit.value) return
  editing.value = entryOf(row)
  draft.value =
    row.kind === 'group'
      ? (store.activeScheme?.collectionTree.value.groups.find((group) => group.groupId === row.id)
          ?.name ?? '')
      : row.name
  scrollToEntry(row)
  await nextTick()
  const input = list.value?.querySelector<HTMLInputElement>('input')
  input?.focus()
  input?.select()
}

function finishRename() {
  const entry = editing.value
  if (!entry) return
  editing.value = null
  if (entry.kind === 'group') renameGroup(entry.id, draft.value)
  else if (entry.kind === 'collection') renameCollection(entry.id, draft.value)
}

async function addCollection(parentId: string | null = null) {
  query.value = ''
  const id = createCollection(parentId)
  if (!id) return
  await nextTick()
  const row = rows.value.find((row) => row.kind === 'collection' && row.id === id)
  if (row) await startRename(row)
}

function activate(row: CollectionRow, event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  if (row.kind === 'collection') activateCollection(row.id)
  else if (store.activeScheme) {
    store.activeScheme.activeGroupId.value = row.id
    store.activeScheme.activeCollectionId.value = null
  }
  select(row, event)
  panelSelectionVersion = store.selectionVersion
}

function deselectRow(row: CollectionRow) {
  deselect(row)
  panelSelectionVersion = store.selectionVersion
}

function inheritedReason(row: CollectionRow, kind: 'hidden' | 'locked') {
  if (row.kind === 'ungrouped') return undefined
  const by =
    row.kind === 'collection'
      ? kind === 'hidden'
        ? row.hiddenBy
        : row.lockedBy
      : restriction(row.parentId, kind)
  return by ? t(kind === 'hidden' ? 'groups.hiddenBy' : 'groups.lockedBy', { name: by }) : undefined
}

function toggleVisibility(row: CollectionRow, event: Pick<MouseEvent, 'altKey'>) {
  if (event.altKey) store.showOnly(entryOf(row))
  else if (!inheritedReason(row, 'hidden')) {
    if (row.kind !== 'collection') store.setGroupHidden(row.id, !row.group.ownHidden)
    else store.setCollectionRestriction(row.id, 'hidden', !row.hidden)
  }
  // 显隐变化可能从选择中移除受限家具，此时不自动滚动。
  panelSelectionVersion = store.selectionVersion
}

function dragStart(event: DragEvent, row: CollectionRow) {
  if (
    !canEdit.value ||
    row.kind === 'ungrouped' ||
    (row.kind === 'collection' && row.virtual) ||
    editing.value
  ) {
    event.preventDefault()
    return
  }
  if (!isSelected(row)) activate(row, { ctrlKey: false, metaKey: false, shiftKey: false })
  if (selectedEntries.value.some((entry) => entry.kind === 'ungrouped')) {
    event.preventDefault()
    return
  }
  dragEntries.value = normalizeEntries(selectedEntries.value)
  dragged.value = entryOf(row)
  event.dataTransfer?.setData('text/plain', nameOf(row))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dragOver(event: DragEvent, row: CollectionRow) {
  if (
    !dragged.value ||
    row.kind === 'ungrouped' ||
    dragEntries.value.some((entry) => keyOf(entry) === keyOf(row))
  ) {
    setDropTarget(null)
    return
  }
  const element = event.currentTarget as HTMLElement
  const bounds = element.getBoundingClientRect()
  const relative = (event.clientY - bounds.top) / bounds.height
  const inside =
    row.kind === 'collection' &&
    (row.virtual ||
      dragEntries.value.every((entry) => entry.kind === 'group') ||
      (relative >= 0.25 && relative <= 0.75))
  if (!inside && dragEntries.value.some((entry) => entry.kind !== row.kind)) {
    setDropTarget(null)
    return
  }
  const parentId =
    inside && row.kind === 'collection' ? (row.virtual ? null : row.id) : row.parentId
  if (!canMoveMany(dragEntries.value, parentId)) {
    setDropTarget(null)
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  setDropTarget({
    key: keyOf(row),
    parentId,
    siblingId: inside ? undefined : row.id,
    after: !inside && relative > 0.5,
    inside,
  })
}

function drop(event: DragEvent) {
  event.preventDefault()
  if (dragged.value && dropTarget.value)
    moveMany(
      dragEntries.value,
      dropTarget.value.parentId,
      dropTarget.value.siblingId,
      dropTarget.value.after
    )
  endDrag()
}

function endDrag() {
  dragged.value = null
  dragEntries.value = []
  setDropTarget(null)
}

async function focusEntry(entry: CollectionEntry) {
  focused.value = entryOf(entry)
  scrollToEntry(entry)
  const schemeId = store.activeSchemeId
  await nextTick()
  if (store.activeSchemeId !== schemeId || !focused.value || keyOf(focused.value) !== keyOf(entry))
    return
  elementFor(entry)?.focus({ preventScroll: true })
}

function rowFocusOut(event: FocusEvent) {
  if (!list.value?.contains(event.relatedTarget as Node | null)) focused.value = null
}

function isBackgroundTarget(event: MouseEvent | PointerEvent) {
  const target = event.target as Element | null
  return !!(
    target &&
    list.value?.contains(target) &&
    !target.closest('[data-row-key], button, input, [data-slot="scroll-area-scrollbar"]')
  )
}

function clearPanelSelection() {
  clearSelection()
  const scheme = store.activeScheme
  if (scheme) {
    scheme.activeGroupId.value = null
    scheme.activeCollectionId.value = null
  }
  focused.value = null
  panelSelectionVersion = store.selectionVersion
  list.value?.focus({ preventScroll: true })
}

function clickBackground(event: MouseEvent) {
  if (event.button === 0 && isBackgroundTarget(event)) clearPanelSelection()
}

function pasteNodes(parentId?: string | null) {
  if (canEdit.value && canPaste.value) pasteItems(clipboard.value, 0, 0, parentId)
}

function pasteMenu() {
  const row = menuRow.value
  if (menuTarget.value === 'background') pasteNodes(null)
  else if (row) pasteNodes(row.kind === 'collection' && !row.virtual ? row.id : row.parentId)
}

function deleteNodes(entries: readonly CollectionEntry[]) {
  if (!deleteEntries(entries)) return
  // 删除后将焦点留在列表，不自动聚焦或选中下一行。
  focused.value = null
  dismissMenu()
  adoptSelection([])
  panelSelectionVersion = store.selectionVersion
  list.value?.focus({ preventScroll: true })
}

// 仅列表焦点下接管节点命令；改名输入和原生文本复制仍由浏览器处理。
function listKey(event: KeyboardEvent) {
  if (
    event.altKey ||
    (event.target as Element | null)?.closest('input, textarea, [contenteditable]')
  )
    return
  const key = event.key.toLowerCase()
  const control = event.ctrlKey || event.metaKey
  const copying = control && key === 'c' && !event.shiftKey
  const pasting = control && key === 'v' && !event.shiftKey
  const duplicating = !control && !event.shiftKey && key === 'e'
  const deleting = !control && !event.shiftKey && key === 'delete'
  if (!copying && !pasting && !duplicating && !deleting) return
  if (copying && hasTextSelection()) return
  event.preventDefault()
  event.stopPropagation()
  if (copying) copyNodes(selectedEntries.value)
  else if (pasting) pasteNodes()
  else if (deleting) deleteNodes(selectedEntries.value)
  else if (canEdit.value && selectedEntries.value.length)
    pasteItems(buildClipboardDataFromSelection(selectedEntries.value), 0, 0)
}

watch(
  () => uiStore.groupPanelPasteTarget,
  async (target) => {
    if (!target || target.schemeId !== store.activeSchemeId) return
    const shouldFocus = !!openMenu.value || !!list.value?.contains(document.activeElement)
    query.value = ''
    for (const root of target.roots) {
      const parent =
        root.kind === 'collection'
          ? store.activeScheme!.collectionTree.value.nodes.find((node) => node.id === root.id)
              ?.parentId
          : store.activeScheme!.collectionTree.value.groups.find(
              (group) => group.groupId === root.id
            )?.collectionId
      revealCollection(parent ?? null)
    }
    adoptSelection(target.roots)
    panelSelectionVersion = store.selectionVersion
    dismissMenu()
    const first = target.roots[0]
    store.activeScheme!.activeCollectionId.value = first?.kind === 'collection' ? first.id : null
    store.activeScheme!.activeGroupId.value = first?.kind === 'group' ? first.id : null
    await nextTick()
    if (
      !first ||
      !uiStore.groupPanelOpen ||
      store.activeSchemeId !== target.schemeId ||
      uiStore.groupPanelPasteTarget !== target
    )
      return
    if (shouldFocus) void focusEntry(first)
    else scrollToEntry(first)
  },
  { flush: 'sync' }
)

function prepareMenu(event: MouseEvent | PointerEvent, selectTarget = true) {
  const element = (event.target as Element | null)?.closest<HTMLElement>('[data-row-key]')
  const index =
    element && list.value?.contains(element)
      ? indexByKey.value.get(element.dataset.rowKey!)
      : undefined
  if (!element && isBackgroundTarget(event)) {
    menuTarget.value = 'background'
    if (selectTarget) clearPanelSelection()
  } else menuTarget.value = index === undefined ? null : entryOf(rows.value[index]!)
  if (!menuTarget.value) event.preventDefault()
  else if (menuTarget.value !== 'background' && selectTarget && !isSelected(menuTarget.value))
    activate(rows.value[index!]!, { ctrlKey: false, metaKey: false, shiftKey: false })
  // 右键点击其他行时复用同一个弹出菜单。
  if (openMenu.value) openMenu.value = menuTarget.value
}

function menuPointerDown(event: PointerEvent) {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') prepareMenu(event, false)
}

function dismissMenu() {
  menuInteractedOutside = true
  openMenu.value = null
}

function dismissOnPointer(event: PointerEvent) {
  if (event.button === 0) dismissMenu()
}

function moveMenuEntries(parentId: string | null) {
  moveMany(menuEntries.value, parentId)
  setMenuOpen(false)
}

function setMenuOpen(open: boolean) {
  if (open && menuTarget.value === 'background') clearPanelSelection()
  if (open && menuRow.value && !isSelected(menuRow.value))
    activate(menuRow.value, { ctrlKey: false, metaKey: false, shiftKey: false })
  if (open) menuInteractedOutside = false
  openMenu.value = open
    ? menuTarget.value === 'background'
      ? 'background'
      : menuRow.value
        ? entryOf(menuRow.value)
        : null
    : null
}

function restoreMenuFocus(event: Event) {
  // 行菜单回到操作行，空白菜单回到列表；创建后的改名输入不抢焦点。
  event.preventDefault()
  if (
    !menuInteractedOutside &&
    !editing.value &&
    !uiStore.groupMergeOpen &&
    uiStore.groupPanelOpen &&
    menuTarget.value
  ) {
    if (menuTarget.value === 'background') list.value?.focus({ preventScroll: true })
    else if (indexByKey.value.has(keyOf(menuTarget.value))) void focusEntry(menuTarget.value)
  }
}

function treeKey(event: KeyboardEvent, row: CollectionRow) {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault()
    const element = elementFor(row)
    if (element) {
      const bounds = element.getBoundingClientRect()
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 16,
          clientY: bounds.bottom,
        })
      )
    }
    return
  }
  if (
    event.target !== event.currentTarget &&
    !(event.target as HTMLElement).hasAttribute?.('data-group-name')
  )
    return
  if (event.key === 'F2') {
    event.preventDefault()
    void startRename(row)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    activate(row, event)
    return
  }
  const index = indexByKey.value.get(keyOf(row))!
  let target: CollectionRow | undefined
  if (event.key === 'ArrowDown') target = rows.value[index + 1]
  else if (event.key === 'ArrowUp') target = rows.value[index - 1]
  else if (event.key === 'Home') target = rows.value[0]
  else if (event.key === 'End') target = rows.value[rows.value.length - 1]
  else if (event.key === 'ArrowRight') {
    if (row.kind === 'collection' && !row.expanded) toggleCollection(row.id)
    else if (row.kind === 'collection') target = rows.value[index + 1]
  } else if (event.key === 'ArrowLeft') {
    if (row.kind === 'collection' && row.expanded) toggleCollection(row.id)
    else if (row.depth > 0) {
      const ancestor = rows.value
        .slice(0, index)
        .reverse()
        .find((entry) => entry.kind === 'collection' && entry.depth === row.depth - 1)
      target = ancestor
    }
  } else return
  event.preventDefault()
  if (target) {
    if (event.shiftKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      select(target, event, row)
      panelSelectionVersion = store.selectionVersion
    }
    void focusEntry(target)
  }
}

watch(rows, (current, previous) => {
  if (
    openMenu.value &&
    openMenu.value !== 'background' &&
    !indexByKey.value.has(keyOf(openMenu.value))
  )
    openMenu.value = null
  if (!focused.value || indexByKey.value.has(keyOf(focused.value))) return
  let row = previous.find((entry) => keyOf(entry) === keyOf(focused.value!))
  while (row?.parentId) {
    const parent = previous.find(
      (entry) => entry.kind === 'collection' && entry.id === row!.parentId
    )
    if (!parent) break
    if (indexByKey.value.has(keyOf(parent))) {
      void focusEntry(parent)
      return
    }
    row = parent
  }
  if (current[0]) void focusEntry(current[0])
  else focused.value = null
})

// 保持操作对象引用稳定，并向各行传递基本类型属性，
// 使拖放指示变化时 Vue 跳过未受影响的行；整个列表共用浮层。
const rowActions = {
  activate,
  deselect: deselectRow,
  startRename,
  finishRename,
  toggleCollection,
  toggleVisibility,
  setGroupLocked: store.setGroupLocked,
  setCollectionRestriction: store.setCollectionRestriction,
  dragStart,
  dragOver,
  drop,
  treeKey,
  focusRow: (row: CollectionRow) => {
    focused.value = entryOf(row)
  },
  rowFocusOut,
  cancelRename: () => {
    editing.value = null
  },
  updateDraft: (value: string) => {
    draft.value = value
  },
  endDrag,
}
function rowProps(row: CollectionRow) {
  const scheme = store.activeScheme
  const coverage = selectionCoverage(row)
  return {
    row,
    actions: rowActions,
    active:
      row.kind !== 'collection'
        ? scheme?.activeGroupId.value === row.id
        : scheme?.activeCollectionId.value === row.id,
    selectionState: selectionState(row),
    selectionSummary:
      coverage.selected > 0
        ? t('groups.selectionCount', { count: coverage.selected, total: coverage.total })
        : undefined,
    selected: isSelected(row),
    editing: !!isEditing(row),
    draft: isEditing(row) ? draft.value : '',
    draggable:
      canEdit.value &&
      !editing.value &&
      row.kind !== 'ungrouped' &&
      !(row.kind === 'collection' && row.virtual),
    searching: !!query.value.trim(),
    dropPosition: dropPosition(row),
    hiddenReason: inheritedReason(row, 'hidden'),
    lockedReason: inheritedReason(row, 'locked'),
  }
}

watch(
  () => store.activeSchemeId,
  () => {
    query.value = ''
    editing.value = null
    endDrag()
    focused.value = null
    openMenu.value = null
    menuTarget.value = null
  },
  { flush: 'sync' }
)

// 打开时不移动焦点，确保再次按面板快捷键仍可切换。
watch(
  () => uiStore.groupPanelOpen,
  (open) => {
    pointerInside.value = false
    if (!open) {
      resetSelectionAnchor()
      editing.value = null
      endDrag()
      focused.value = null
      openMenu.value = null
      menuTarget.value = null
    }
  }
)

// 重新打开时保留列表位置，仅在画布选择变化后滚动到对应行。
watch(
  () => store.selectionVersion,
  async () => {
    if (!uiStore.groupPanelOpen || store.selectionVersion === panelSelectionVersion) return
    dismissMenu()
    const selected = [...groups.value, ...(ungrouped.value ? [ungrouped.value] : [])].filter(
      (group) => group.selectedCount > 0
    )
    if (selected.length !== 1) return
    const id = selected[0]!.id
    const kind = id === 0 ? 'ungrouped' : 'group'
    // 仅跟随树中已展开可见的行，画布选择不自动展开集合。
    if (!rows.value.some((row) => row.kind === kind && row.id === id)) return
    if (store.activeScheme) {
      store.activeScheme.activeGroupId.value = id
      store.activeScheme.activeCollectionId.value = null
    }
    if (pointerInside.value || query.value.trim() || editing.value !== null) return
    const schemeId = store.activeSchemeId
    await nextTick()
    if (
      !uiStore.groupPanelOpen ||
      store.activeSchemeId !== schemeId ||
      pointerInside.value ||
      query.value.trim() ||
      editing.value !== null
    )
      return
    scrollToEntry({ kind, id })
  },
  { immediate: true, flush: 'post' }
)
</script>

<template>
  <TooltipProvider :delay-duration="1000" :skip-delay-duration="300">
    <section
      class="flex h-full min-h-0 flex-col bg-sidebar/95 text-sidebar-foreground"
      :aria-label="t('groups.title')"
      @pointerdown.capture="dismissOnPointer"
      @keydown.esc.stop.prevent="close"
    >
      <header class="flex h-10 shrink-0 items-center gap-1.5 px-2">
        <h2 class="text-sm font-semibold">{{ t('groups.title') }}</h2>
        <span class="text-xs text-muted-foreground tabular-nums">{{ groups.length }}</span>
        <div class="ml-auto flex">
          <Tooltip :delay-duration="300">
            <TooltipTrigger as-child>
              <span class="inline-flex">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  :disabled="!canEdit"
                  :aria-label="t('groups.createCollection')"
                  @click="addCollection()"
                  ><FolderPlus class="h-4 w-4"
                /></Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-xs" :side-offset="-8">{{
              t('groups.createCollection')
            }}</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7"
            :disabled="!store.activeScheme?.collectionTree.value.nodes.length"
            :aria-label="t('groups.collapseAll')"
            @click="collapseAll"
            ><ListChevronsDownUp class="h-4 w-4"
          /></Button>
          <Tooltip :delay-duration="300">
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :aria-label="t('groups.close')"
                @click="close"
                ><X class="h-4 w-4"
              /></Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-xs" :side-offset="-8">{{
              t('groups.close')
            }}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div class="relative shrink-0 px-3 py-2">
        <Search
          class="pointer-events-none absolute top-1/2 left-5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="query"
          data-group-search
          class="h-8 pl-7 text-xs"
          :placeholder="t('groups.search')"
          :aria-label="t('groups.search')"
        />
      </div>

      <p
        v-if="
          !store.activeScheme?.collectionsSupported.value &&
          store.activeScheme?.source.value === 'cloud'
        "
        class="px-3 pb-2 text-xs text-amber-600 dark:text-amber-400"
      >
        {{ t('groups.syncUnavailable') }}
      </p>
      <ContextMenu :open="!!openMenu" :modal="false" @update:open="setMenuOpen">
        <ContextMenuTrigger as-child>
          <div
            ref="list"
            tabindex="-1"
            class="flex min-h-0 flex-1 flex-col"
            @mouseenter="pointerInside = true"
            @mouseleave="pointerInside = false"
            @dragover="setDropTarget(null)"
            @click="clickBackground"
            @keydown="listKey"
            @contextmenu.capture="prepareMenu"
            @pointerdown.capture="menuPointerDown"
          >
            <ScrollArea
              class="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:overscroll-contain"
              @scroll.capture="dismissMenu()"
            >
              <div class="pr-3 pb-2 pl-2">
                <div
                  v-if="
                    groups.length === 0 &&
                    !ungrouped &&
                    !store.activeScheme?.collectionTree.value.nodes.length
                  "
                  class="flex flex-col items-center gap-3 px-5 pt-12 text-center"
                >
                  <Layers class="h-8 w-8 text-muted-foreground/40" />
                  <p class="text-sm font-medium">{{ t('groups.empty') }}</p>
                  <p class="text-xs leading-5 text-muted-foreground">{{ t('groups.emptyHint') }}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="!canGroup"
                    @click="requestGroup()"
                    >{{ t('groups.create') }}</Button
                  >
                </div>
                <p
                  v-else-if="rows.length === 0"
                  class="px-3 pt-8 text-center text-xs text-muted-foreground"
                >
                  {{ t('groups.noResults') }}
                </p>
                <ul
                  v-else
                  role="tree"
                  aria-multiselectable="true"
                  class="relative select-none"
                  :aria-label="t('groups.title')"
                  :style="{ height: `${totalHeight}px` }"
                >
                  <GroupPanelRow
                    v-for="{ row, offset } in virtualRows"
                    :key="keyOf(row)"
                    v-bind="rowProps(row)"
                    :offset="offset"
                  />
                </ul>
              </div>
            </ScrollArea>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          @close-auto-focus="restoreMenuFocus"
          @interact-outside="menuInteractedOutside = true"
          @keydown.delete="listKey"
        >
          <template v-if="menuTarget === 'background'">
            <ContextMenuItem :disabled="!canEdit" @select="addCollection()">{{
              t('groups.createCollection')
            }}</ContextMenuItem>
            <ContextMenuItem :disabled="!canEdit || !canPaste" @select="pasteMenu()">{{
              t('command.edit.paste')
            }}</ContextMenuItem>
          </template>
          <template v-else-if="menuRow">
            <ContextMenuLabel v-if="!singleMenuEntry">{{
              t('groups.selectedNodes', { count: menuEntries.length })
            }}</ContextMenuLabel>
            <ContextMenuItem :disabled="!menuEntries.length" @select="copyNodes(menuEntries)">{{
              t('command.edit.copy')
            }}</ContextMenuItem>
            <ContextMenuItem :disabled="!canEdit || !canPaste" @select="pasteMenu()">{{
              t('command.edit.paste')
            }}</ContextMenuItem>
            <ContextMenuSeparator v-if="canOrganizeMenu" />
            <template v-if="singleMenuEntry && menuRow.kind === 'collection' && !menuRow.virtual">
              <ContextMenuItem :disabled="!canEdit" @select="addCollection(menuRow.id)">{{
                t('groups.createSubcollection')
              }}</ContextMenuItem>
              <ContextMenuItem :disabled="!canEdit" @select="startRename(menuRow)">{{
                t('groups.renameCollection')
              }}</ContextMenuItem>
            </template>
            <ContextMenuItem
              v-else-if="singleMenuEntry && menuRow.kind === 'group'"
              :disabled="!canRenameGroup(menuRow.id)"
              @select="startRename(menuRow)"
              >{{ t('groups.rename') }}</ContextMenuItem
            >
            <ContextMenuSeparator
              v-if="
                singleMenuEntry &&
                (menuRow.kind === 'group' || (menuRow.kind === 'collection' && !menuRow.virtual))
              "
            />
            <ContextMenuItem
              v-if="canOrganizeMenu"
              :disabled="!canEdit || !canGroupSelection(menuGroupTarget)"
              @select="requestGroup(menuGroupTarget)"
              >{{ t('command.edit.group') }}</ContextMenuItem
            >
            <ContextMenuItem
              v-if="canOrganizeMenu"
              :disabled="!canEdit || !canUngroupSelection(menuGroupTarget)"
              @select="ungroupSelected(menuGroupTarget)"
              >{{ t('command.edit.ungroup') }}</ContextMenuItem
            >
            <ContextMenuSeparator v-if="canOrganizeMenu" />
            <ContextMenuSub v-if="canOrganizeMenu">
              <ContextMenuSubTrigger
                :disabled="!canEdit || !normalizeEntries(menuEntries).length"
                >{{ t('groups.moveTo') }}</ContextMenuSubTrigger
              >
              <ContextMenuSubContent class="max-h-64 max-w-80 overflow-y-auto">
                <ContextMenuItem
                  :disabled="!canMoveMany(menuEntries, null)"
                  @select="moveMenuEntries(null)"
                  >{{
                    t(
                      menuEntries.every((entry) => entry.kind === 'group')
                        ? 'groups.unclassified'
                        : 'groups.root'
                    )
                  }}</ContextMenuItem
                >
                <ContextMenuItem
                  v-for="destination in menuDestinations"
                  :key="destination.id"
                  @select="moveMenuEntries(destination.id)"
                  >{{ destination.name }}</ContextMenuItem
                >
              </ContextMenuSubContent>
            </ContextMenuSub>
            <template v-if="singleMenuEntry && menuRow.kind === 'collection' && !menuRow.virtual">
              <ContextMenuSeparator />
              <ContextMenuItem :disabled="!canEdit" @select="deleteCollection(menuRow.id)">{{
                t('groups.deleteCollection')
              }}</ContextMenuItem>
            </template>
            <ContextMenuItem
              v-if="singleMenuEntry && menuRow.kind === 'collection' && menuRow.virtual"
              @select="collapseAll()"
              >{{ t('groups.collapseAll') }}</ContextMenuItem
            >
            <ContextMenuSeparator />
            <ContextMenuItem
              :disabled="!canDeleteEntries(menuEntries)"
              variant="destructive"
              @select="deleteNodes(menuEntries)"
            >
              <span>{{ t('command.edit.delete') }}</span>
            </ContextMenuItem>
          </template>
        </ContextMenuContent>
      </ContextMenu>

      <GroupPanelHints
        :container="list"
        :active="uiStore.groupPanelOpen && !openMenu && !dragged && !editing"
        :rows="rows"
      />

      <footer class="flex h-11 shrink-0 items-center justify-between gap-2 border-t px-3 text-xs">
        <span
          class="min-w-0 flex-1 truncate"
          :class="
            store.hiddenItemCount ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          "
          role="status"
        >
          {{
            store.hiddenItemCount
              ? t('groups.hiddenItemCount', { count: store.hiddenItemCount })
              : t('groups.allVisible')
          }}
        </span>
        <div class="flex shrink-0 gap-1">
          <Button
            v-if="hasHidden"
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="store.showAllGroups()"
            >{{ t('groups.showAll') }}</Button
          >
          <Button
            v-if="hasLocked"
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="store.unlockAllGroups()"
            >{{ t('groups.unlockAll') }}</Button
          >
        </div>
      </footer>
    </section>
  </TooltipProvider>
</template>

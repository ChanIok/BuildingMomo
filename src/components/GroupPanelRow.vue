<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  LockKeyhole,
  UnlockKeyhole,
} from 'lucide-vue-next'
import { useI18n } from '@/composables/useI18n'
import type { CollectionRow } from '@/composables/editor/useCollectionPanel'
import type { GroupSelectionState } from '@/composables/editor/useGroupPanelSelection'

const props = defineProps<{
  row: CollectionRow
  offset: number
  active: boolean
  selectionState: GroupSelectionState
  selectionSummary?: string
  selected: boolean
  editing: boolean
  draft: string
  draggable: boolean
  searching: boolean
  dropPosition: 'inside' | 'before' | 'after' | null
  hiddenReason?: string
  lockedReason?: string
  actions: {
    activate: (row: CollectionRow, event: MouseEvent | KeyboardEvent) => void
    deselect: (row: CollectionRow) => void
    startRename: (row: CollectionRow) => void
    finishRename: () => void
    cancelRename: () => void
    updateDraft: (value: string) => void
    toggleCollection: (id: string) => void
    toggleVisibility: (row: CollectionRow, event: MouseEvent) => void
    setGroupLocked: (id: number, locked: boolean) => void
    setCollectionRestriction: (id: string, kind: 'hidden' | 'locked', enabled: boolean) => void
    dragStart: (event: DragEvent, row: CollectionRow) => void
    dragOver: (event: DragEvent, row: CollectionRow) => void
    drop: (event: DragEvent) => void
    endDrag: () => void
    treeKey: (event: KeyboardEvent, row: CollectionRow) => void
    focusRow: (row: CollectionRow) => void
    rowFocusOut: (event: FocusEvent) => void
  }
}>()
const { t } = useI18n()
function nameOf(row: CollectionRow) {
  return row.kind !== 'collection' ? row.group.name : row.name
}
function visibilityLabel() {
  return (
    props.hiddenReason ??
    t(
      (props.row.kind !== 'collection' ? props.row.group.hidden : props.row.hidden)
        ? 'groups.show'
        : 'groups.hide',
      { name: nameOf(props.row) }
    )
  )
}
function rowClass() {
  if (props.selected) return 'bg-primary/12 text-primary hover:bg-primary/16'
  return 'hover:bg-primary/8'
}
const dropClasses = {
  inside: 'ring-1 ring-inset ring-ring',
  after: 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
  before: 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
}
function dropClass() {
  return props.dropPosition ? dropClasses[props.dropPosition] : ''
}
function cancelSelection(event: MouseEvent) {
  // 取消按钮消失时将焦点留在当前行，且不触发滚动。
  const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-row-key]')
  element?.focus({ preventScroll: true })
  props.actions.deselect(props.row)
}
</script>

<template>
  <li
    :data-group-id="row.kind === 'group' ? row.id : undefined"
    :data-collection-id="row.kind === 'collection' ? row.id : undefined"
    :data-ungrouped="row.kind === 'ungrouped' ? true : undefined"
    :data-row-key="`${row.kind}:${row.id}`"
    role="treeitem"
    tabindex="0"
    :aria-level="row.depth + 1"
    :aria-expanded="row.kind === 'collection' ? row.expanded : undefined"
    :aria-selected="selected"
    :data-selection="selectionState"
    :aria-description="
      selectionState === 'none'
        ? undefined
        : t(
            selectionState === 'partial'
              ? 'groups.partiallySelected'
              : 'groups.allFurnitureSelected'
          )
    "
    class="group absolute top-0 left-0 flex h-8 w-full items-center gap-1 rounded-sm pr-1 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    :class="[rowClass(), dropClass()]"
    :style="{ paddingLeft: `${8 + row.depth * 14}px`, transform: `translateY(${offset}px)` }"
    :draggable="draggable"
    @dragstart="actions.dragStart($event, row)"
    @dragover.stop="actions.dragOver($event, row)"
    @drop.stop="actions.drop($event)"
    @dragend="actions.endDrag()"
    @focusin="actions.focusRow(row)"
    @focusout="actions.rowFocusOut($event)"
    @click="actions.activate(row, $event)"
    @keydown="actions.treeKey($event, row)"
  >
    <!-- 组行仅预留箭头列；平铺列表无需前导留白。 -->
    <span
      v-if="row.kind === 'collection' || row.depth > 0"
      class="grid shrink-0 items-center gap-1"
      :class="row.kind === 'collection' ? 'grid-cols-[1.5rem_0.875rem]' : 'grid-cols-[1.5rem]'"
      :aria-hidden="row.kind === 'group' ? true : undefined"
    >
      <template v-if="row.kind === 'collection'">
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/80 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          :disabled="searching"
          :aria-expanded="row.expanded"
          :aria-label="
            t(row.expanded ? 'groups.collapseCollection' : 'groups.expandCollection', {
              name: row.name,
            })
          "
          @click.stop="actions.toggleCollection(row.id)"
          @dblclick.stop
        >
          <ChevronDown v-if="row.expanded" class="h-3 w-3" /><ChevronRight v-else class="h-3 w-3" />
        </button>
        <FolderOpen v-if="row.expanded" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><Folder
          v-else
          class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
      </template>
    </span>
    <input
      v-if="editing"
      :value="draft"
      @input="actions.updateDraft(($event.target as HTMLInputElement).value)"
      maxlength="200"
      class="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-sm text-foreground outline-none select-text focus:ring-2 focus:ring-ring"
      :aria-label="t(row.kind === 'collection' ? 'groups.renameCollection' : 'groups.rename')"
      @click.stop
      @dblclick.stop
      @keydown.stop
      @keydown.enter.prevent="actions.finishRename()"
      @keydown.esc.prevent="actions.cancelRename()"
      @blur="actions.finishRename()"
    />
    <button
      v-else
      data-group-name
      type="button"
      class="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :class="
        row.kind !== 'collection'
          ? { 'text-muted-foreground': row.group.hidden }
          : {
              'font-medium': !row.virtual,
              'text-muted-foreground': row.hidden || row.inheritedHidden || row.virtual,
            }
      "
      :aria-current="active ? 'true' : undefined"
      :aria-pressed="selected"
      @dblclick.stop="actions.startRename(row)"
      @keydown.f2.prevent.stop="actions.startRename(row)"
    >
      {{ nameOf(row) }}
    </button>
    <!-- 保留占位，仅选中节点显示取消选择按钮。 -->
    <span class="grid h-7 w-6 shrink-0 place-items-center">
      <button
        v-if="selected"
        data-group-deselect
        type="button"
        :draggable="false"
        :aria-label="t('groups.deselect', { name: nameOf(row) })"
        class="flex h-7 w-6 items-center justify-center rounded hover:bg-background/80 focus-visible:ring-1 focus-visible:ring-ring"
        @pointerdown.stop
        @click.stop="cancelSelection"
        @dblclick.stop
        @dragstart.stop.prevent
      >
        <span
          aria-hidden="true"
          class="grid h-3.5 w-3.5 place-items-center rounded-[3px] border border-primary/80 bg-primary/80 text-primary-foreground"
        >
          <svg
            class="h-2.5 w-2.5"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2.5 6 5 8.5 9.5 3.5" />
          </svg>
        </span>
      </button>
    </span>
    <span
      class="shrink-0 px-1 text-xs text-muted-foreground tabular-nums"
      :data-group-hint="selectionSummary"
      :aria-description="selectionSummary"
      :aria-label="
        row.kind === 'collection'
          ? t('groups.groupCount', { count: row.count })
          : t('groups.itemCount', { count: row.group.count })
      "
    >
      {{
        row.kind === 'collection' ? t('groups.groupCount', { count: row.count }) : row.group.count
      }}
    </span>
    <div class="flex shrink-0">
      <span
        :data-group-hint="`${visibilityLabel()}\n${t('groups.showOnlyHint')}`"
        class="inline-flex"
      >
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-background/80 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          :class="[
            (row.kind !== 'collection' ? row.group.hidden : row.hidden || row.inheritedHidden)
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground',
            { 'opacity-40': !!hiddenReason },
          ]"
          :aria-pressed="
            row.kind !== 'collection' ? row.group.hidden : row.hidden || row.inheritedHidden
          "
          :aria-label="visibilityLabel()"
          @click.stop="actions.toggleVisibility(row, $event)"
          @dblclick.stop
        >
          <EyeOff
            v-if="row.kind !== 'collection' ? row.group.hidden : row.hidden || row.inheritedHidden"
            class="h-3.5 w-3.5"
          /><Eye v-else class="h-3.5 w-3.5" />
        </button>
      </span>
      <span data-group-hint class="inline-flex">
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-background/80 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          :class="
            (row.kind !== 'collection' ? row.group.locked : row.locked || row.inheritedLocked)
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground'
          "
          :disabled="!!lockedReason"
          :aria-pressed="
            row.kind !== 'collection' ? row.group.locked : row.locked || row.inheritedLocked
          "
          :aria-label="
            lockedReason ??
            t(
              (row.kind !== 'collection' ? row.group.locked : row.locked)
                ? 'groups.unlock'
                : 'groups.lock',
              { name: nameOf(row) }
            )
          "
          @click.stop="
            row.kind !== 'collection'
              ? actions.setGroupLocked(row.id, !row.group.ownLocked)
              : actions.setCollectionRestriction(row.id, 'locked', !row.locked)
          "
          @dblclick.stop
        >
          <LockKeyhole
            v-if="row.kind !== 'collection' ? row.group.locked : row.locked || row.inheritedLocked"
            class="h-3.5 w-3.5"
          /><UnlockKeyhole v-else class="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  </li>
</template>

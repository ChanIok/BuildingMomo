<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/composables/useI18n'
import { useNotification } from '@/composables/useNotification'
import { useCommandStore } from '@/stores/commandStore'
import { useEditorStore } from '@/stores/editorStore'
import { useTabStore } from '@/stores/tabStore'
import { ARCHIVE_DEFAULT_GROUP_ID } from '@/types/archive'
import {
  Archive,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Pencil,
  Trash2,
  MoreHorizontal,
  RefreshCw,
  ArrowUpToLine,
} from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    open?: boolean
  }>(),
  {
    open: false,
  }
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

// 方案集是一个明确的业务组件，直接访问 store。
// 这样可以避免把 Toolbar 继续堆成大量中转 handler。
const commandStore = useCommandStore()
const editorStore = useEditorStore()
const tabStore = useTabStore()
const notification = useNotification()
const { t } = useI18n()

const archiveState = computed(() => commandStore.fileOps.archiveState)
const groups = computed(() => archiveState.value.index.groups)
const selectedGroupId = computed(() => archiveState.value.selectedGroupId)
const selectedEntries = computed(() =>
  archiveState.value.index.entries.filter((entry) => entry.groupId === selectedGroupId.value)
)
const groupCounts = computed(() => {
  const counts = new Map<string, number>()
  archiveState.value.index.entries.forEach((entry) => {
    counts.set(entry.groupId, (counts.get(entry.groupId) ?? 0) + 1)
  })
  return counts
})
const canSaveCurrentScheme = computed(
  () => tabStore.activeTab?.type === 'scheme' && !!editorStore.activeScheme
)
const canUpdateCurrentScheme = computed(
  () => tabStore.activeTab?.type === 'scheme' && !!editorStore.activeScheme
)

const creatingGroup = ref(false)
const newGroupName = ref('')
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')
const editingEntryId = ref<string | null>(null)
const editingEntryName = ref('')

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await commandStore.fileOps.loadArchiveIndex(true)
    }
  }
)

watch(selectedGroupId, () => {
  editingGroupId.value = null
  editingEntryId.value = null
})

function closePopover() {
  emit('update:open', false)
}

function selectGroup(groupId: string) {
  commandStore.fileOps.setArchiveGroup(groupId)
}

function formatEntryTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function startCreateGroup() {
  creatingGroup.value = true
  newGroupName.value = ''
  editingGroupId.value = null
}

async function submitCreateGroup() {
  await commandStore.fileOps.createArchiveGroup(newGroupName.value)
  creatingGroup.value = false
  newGroupName.value = ''
}

function cancelCreateGroup() {
  creatingGroup.value = false
  newGroupName.value = ''
}

function beginRenameGroup(groupId: string, name: string) {
  creatingGroup.value = false
  editingEntryId.value = null
  editingGroupId.value = groupId
  editingGroupName.value = name
}

async function submitRenameGroup(groupId: string) {
  await commandStore.fileOps.renameArchiveGroup(groupId, editingGroupName.value)
  editingGroupId.value = null
  editingGroupName.value = ''
}

function beginRenameEntry(entryId: string, name: string) {
  editingGroupId.value = null
  editingEntryId.value = entryId
  editingEntryName.value = name
}

async function submitRenameEntry(entryId: string) {
  await commandStore.fileOps.renameArchiveEntry(entryId, editingEntryName.value)
  editingEntryId.value = null
  editingEntryName.value = ''
}

function canDeleteGroup(groupId: string) {
  return groupId !== ARCHIVE_DEFAULT_GROUP_ID && (groupCounts.value.get(groupId) ?? 0) === 0
}

async function handleSaveCurrentScheme() {
  if (!editorStore.activeScheme) return
  await commandStore.fileOps.archiveScheme(editorStore.activeScheme.id, selectedGroupId.value)
}

async function handleOpenEntry(entryId: string) {
  const opened = await commandStore.fileOps.openArchiveEntry(entryId)
  if (opened) {
    closePopover()
  }
}

async function handleUpdateArchiveEntry(entryId: string) {
  if (!canUpdateCurrentScheme.value || !editorStore.activeScheme) return

  const confirmed = await notification.confirm({
    title: t('archive.updateConfirm.title', {
      name: editorStore.activeScheme.name.value,
    }),
    description: t('archive.updateConfirm.description'),
    confirmText: t('archive.updateCurrent'),
    cancelText: t('common.cancel'),
  })

  if (!confirmed) return

  await commandStore.fileOps.updateArchiveEntryFromScheme(entryId, editorStore.activeScheme.id)
}

// 默认分组固定存在，避免右键“保存到方案集”没有落点。
</script>

<template>
  <div class="flex h-[420px] flex-row overflow-hidden">
    <div class="flex w-52 flex-none flex-col border-r">
      <div class="flex items-center justify-between gap-2 px-3 py-3">
        <div>
          <div class="text-sm font-medium">{{ t('archive.title') }}</div>
          <div class="text-xs text-muted-foreground">{{ t('archive.groupsTitle') }}</div>
        </div>
        <Button variant="outline" size="icon" class="h-8 w-8" @click="startCreateGroup">
          <FolderPlus class="h-4 w-4" />
        </Button>
      </div>

      <div v-if="creatingGroup" class="p-3">
        <Input
          v-model="newGroupName"
          size="sm"
          :placeholder="t('archive.groupNamePlaceholder')"
          @keydown.enter="submitCreateGroup"
          @keydown.escape="cancelCreateGroup"
        />
        <div class="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" class="h-7 text-xs" @click="cancelCreateGroup">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" class="h-7 text-xs" @click="submitCreateGroup">
            {{ t('common.confirm') }}
          </Button>
        </div>
      </div>

      <ScrollArea class="min-h-0 flex-1">
        <div class="p-2">
          <div
            v-for="(group, index) in groups"
            :key="group.id"
            class="group rounded-md border border-transparent px-2 py-2 transition-colors"
            :class="
              selectedGroupId === group.id
                ? 'border-border bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            "
            @click="selectGroup(group.id)"
          >
            <template v-if="editingGroupId === group.id">
              <div @click.stop>
                <Input
                  v-model="editingGroupName"
                  size="sm"
                  class="mb-2"
                  @keydown.enter="submitRenameGroup(group.id)"
                  @keydown.escape="editingGroupId = null"
                />
                <div class="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 text-xs"
                    @click="editingGroupId = null"
                  >
                    {{ t('common.cancel') }}
                  </Button>
                  <Button size="sm" class="h-7 text-xs" @click="submitRenameGroup(group.id)">
                    {{ t('common.confirm') }}
                  </Button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="flex w-full items-center text-left">
                <div class="mr-2 flex-1 truncate text-sm font-medium">{{ group.name }}</div>
                <div class="flex shrink-0 items-center">
                  <span class="mr-1 text-xs text-muted-foreground">
                    {{ groupCounts.get(group.id) ?? 0 }}
                  </span>
                  <div
                    class="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    @click.stop
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="h-6 w-6 text-muted-foreground hover:text-foreground"
                        >
                          <MoreHorizontal class="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-40">
                        <DropdownMenuItem
                          :disabled="index <= (groups[0]?.id === ARCHIVE_DEFAULT_GROUP_ID ? 1 : 0)"
                          @click="commandStore.fileOps.moveArchiveGroup(group.id, 'top')"
                        >
                          <ArrowUpToLine class="mr-2 h-4 w-4" />
                          {{ t('archive.moveToTop') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="index === 0"
                          @click="commandStore.fileOps.moveArchiveGroup(group.id, 'up')"
                        >
                          <ChevronUp class="mr-2 h-4 w-4" />
                          {{ t('archive.moveUp') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="index === groups.length - 1"
                          @click="commandStore.fileOps.moveArchiveGroup(group.id, 'down')"
                        >
                          <ChevronDown class="mr-2 h-4 w-4" />
                          {{ t('archive.moveDown') }}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          :disabled="group.id === ARCHIVE_DEFAULT_GROUP_ID"
                          @click="beginRenameGroup(group.id, group.name)"
                        >
                          <Pencil class="mr-2 h-4 w-4" />
                          {{ t('common.rename') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="!canDeleteGroup(group.id)"
                          class="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                          @click="commandStore.fileOps.deleteArchiveGroup(group.id)"
                        >
                          <Trash2 class="mr-2 h-4 w-4" />
                          {{ t('common.delete') }}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
        <ScrollBar orientation="vertical" />
      </ScrollArea>
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div class="text-sm font-medium">{{ t('archive.entriesTitle') }}</div>
          <div class="text-xs text-muted-foreground">{{ t('archive.entriesHint') }}</div>
        </div>
        <Button
          size="sm"
          class="h-8 text-xs"
          :disabled="!canSaveCurrentScheme"
          @click="handleSaveCurrentScheme"
        >
          <Archive class="mr-1.5 h-3.5 w-3.5" />
          {{ t('archive.archiveToGroup') }}
        </Button>
      </div>

      <ScrollArea class="h-[368px]">
        <div
          v-if="archiveState.isLoading"
          class="px-4 py-8 text-center text-xs text-muted-foreground"
        >
          {{ t('archive.loading') }}
        </div>
        <div
          v-else-if="selectedEntries.length === 0"
          class="px-4 py-8 text-center text-xs text-muted-foreground"
        >
          {{ t('archive.emptyGroup') }}
        </div>
        <div v-else class="p-2">
          <div
            v-for="(entry, index) in selectedEntries"
            :key="entry.id"
            class="group rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
            @click="handleOpenEntry(entry.id)"
          >
            <template v-if="editingEntryId === entry.id">
              <div @click.stop>
                <Input
                  v-model="editingEntryName"
                  size="sm"
                  class="mb-2"
                  @keydown.enter="submitRenameEntry(entry.id)"
                  @keydown.escape="editingEntryId = null"
                />
                <div class="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 text-xs"
                    @click="editingEntryId = null"
                  >
                    {{ t('common.cancel') }}
                  </Button>
                  <Button size="sm" class="h-7 text-xs" @click="submitRenameEntry(entry.id)">
                    {{ t('common.confirm') }}
                  </Button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="flex w-full items-center gap-3 text-left">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{{ entry.name }}</div>
                  <div class="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{{ t('archive.itemCount', { n: entry.itemCount }) }}</span>
                    <span>{{ formatEntryTime(entry.updatedAt) }}</span>
                  </div>
                </div>
                <div
                  class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  @click.stop
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 text-muted-foreground hover:bg-muted hover:text-foreground"
                    :disabled="!canUpdateCurrentScheme"
                    :title="t('archive.updateCurrent')"
                    @click="handleUpdateArchiveEntry(entry.id)"
                  >
                    <RefreshCw class="h-3.5 w-3.5" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <MoreHorizontal class="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-40">
                      <DropdownMenuItem
                        :disabled="index === 0"
                        @click="commandStore.fileOps.moveArchiveEntry(entry.id, 'top')"
                      >
                        <ArrowUpToLine class="mr-2 h-4 w-4" />
                        {{ t('archive.moveToTop') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="index === 0"
                        @click="commandStore.fileOps.moveArchiveEntry(entry.id, 'up')"
                      >
                        <ChevronUp class="mr-2 h-4 w-4" />
                        {{ t('archive.moveUp') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="index === selectedEntries.length - 1"
                        @click="commandStore.fileOps.moveArchiveEntry(entry.id, 'down')"
                      >
                        <ChevronDown class="mr-2 h-4 w-4" />
                        {{ t('archive.moveDown') }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem @click="beginRenameEntry(entry.id, entry.name)">
                        <Pencil class="mr-2 h-4 w-4" />
                        {{ t('common.rename') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                        @click="commandStore.fileOps.deleteArchiveEntry(entry.id)"
                      >
                        <Trash2 class="mr-2 h-4 w-4" />
                        {{ t('common.delete') }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </template>
          </div>
        </div>
        <ScrollBar orientation="vertical" />
      </ScrollArea>
    </div>
  </div>
</template>

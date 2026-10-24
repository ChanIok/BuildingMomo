<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useI18n } from '@/composables/useI18n'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { collectionAncestors, groupNameEntries } from '@/lib/collectionTree'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const store = useEditorStore()
const uiStore = useUIStore()
const { t } = useI18n()
const { groupInto, canGroupSelection } = useEditorGroups()

// 唯一候选组已在上层静默合并，因此这里至少涉及两个组，默认落在“新建组”。
const NEW_GROUP = 'new'
const target = ref<string>(NEW_GROUP)

const options = computed(() => {
  const scheme = store.activeScheme
  if (!scheme) return []
  const tree = scheme.collectionTree.value
  const names = new Map(groupNameEntries(tree))
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]))
  const parents = new Map(tree.groups.map((group) => [group.groupId, group.collectionId]))
  return uiStore.groupMergeCandidates.flatMap((id) => {
    const members = store.groupsMap.get(id)
    if (!members) return []
    const path = collectionAncestors(nodes, parents.get(id) ?? null)
      .reverse()
      .map((nodeId) => nodes.get(nodeId)?.name)
      .filter((name): name is string => !!name)
      .join(' / ')
    return [
      {
        id: String(id),
        name: names.get(id) ?? t('groups.defaultName', { id }),
        count: members.size,
        path: path || t('groups.unclassified'),
      },
    ]
  })
})

const canSubmit = computed(
  () =>
    !!uiStore.groupMergeTarget &&
    canGroupSelection(uiStore.groupMergeTarget) &&
    (target.value === NEW_GROUP || options.value.some((option) => option.id === target.value))
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) target.value = NEW_GROUP
    else {
      uiStore.groupMergeTarget = null
      uiStore.groupMergeCandidates = []
    }
  }
)

watch(() => store.activeSchemeId, close)

function close() {
  emit('update:open', false)
}

function submit() {
  const scope = uiStore.groupMergeTarget
  if (!scope || !canSubmit.value) return
  const targetId = target.value === NEW_GROUP ? null : Number(target.value)
  close()
  groupInto(targetId, scope)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ t('groups.mergeDialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('groups.mergeDialog.description') }}</DialogDescription>
      </DialogHeader>

      <RadioGroup v-model="target" class="grid max-h-[50vh] gap-2 overflow-y-auto py-2">
        <label
          v-for="option in options"
          :key="option.id"
          class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
          :class="
            target === option.id
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/40'
          "
        >
          <RadioGroupItem :value="option.id" class="mt-0.5" />
          <div class="grid min-w-0 gap-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate text-sm font-medium text-foreground">{{ option.name }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ t('groups.itemCount', { count: option.count }) }}
              </span>
            </div>
            <p class="truncate text-xs text-muted-foreground">
              {{ option.path }} · {{ t('groups.mergeDialog.keepHint') }}
            </p>
          </div>
        </label>

        <label
          class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
          :class="
            target === NEW_GROUP
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/40'
          "
        >
          <RadioGroupItem :value="NEW_GROUP" class="mt-0.5" />
          <div class="grid min-w-0 gap-1">
            <span class="text-sm font-medium text-foreground">
              {{ t('groups.mergeDialog.newGroup') }}
            </span>
            <p class="text-xs text-muted-foreground">
              {{ t('groups.mergeDialog.newGroupHint') }}
            </p>
          </div>
        </label>
      </RadioGroup>

      <DialogFooter>
        <Button variant="outline" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSubmit" @click="submit">{{ t('common.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

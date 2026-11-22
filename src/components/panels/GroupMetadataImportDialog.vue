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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useEditorStore } from '@/stores/editorStore'
import { useTabStore } from '@/stores/tabStore'
import { useI18n } from '@/composables/app/useI18n'
import { useNotification } from '@/composables/app/useNotification'
import { useGroupMetadataImport } from '@/composables/editor/useGroupMetadataImport'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useEditorStore()
const tabs = useTabStore()
const { t } = useI18n()
const notification = useNotification()
const { canImport, preview, importFrom } = useGroupMetadataImport()
// 弹窗按需挂载，每次打开绑定当时的目标，切换标签后不得提交到新目标。
const targetId = store.activeSchemeId
const sourceId = ref('')
const exactMatch = ref(false)
const sources = computed(() =>
  tabs.tabs.flatMap((tab) => {
    const scheme = tab.type === 'scheme' && tab.schemeId ? store.getSchemeById(tab.schemeId) : null
    if (!scheme || scheme.id === store.activeSchemeId) return []
    const groupIds = new Set(
      scheme.items.value.filter((item) => item.groupId > 0).map((item) => item.groupId)
    )
    return [{ id: scheme.id, name: scheme.name.value, count: groupIds.size }]
  })
)
const result = computed(() =>
  props.open && sourceId.value ? preview(sourceId.value, exactMatch.value) : null
)
const canSubmit = computed(
  () =>
    canImport.value &&
    !!(result.value?.changedGroupCount || result.value?.changedCollectionOriginCount)
)
watch(
  () => props.open,
  (open) => {
    if (open) {
      sourceId.value = ''
      exactMatch.value = false
    }
  }
)
watch(() => store.activeSchemeId, close)
watch(sources, (options) => {
  if (!options.some((source) => source.id === sourceId.value)) sourceId.value = ''
})

function close() {
  emit('update:open', false)
}

function submit() {
  if (!canSubmit.value || !targetId) return
  const applied = importFrom(sourceId.value, targetId, exactMatch.value)
  if (!applied) return
  notification.success(
    [
      applied.changedGroupCount
        ? t('groups.importDialog.success', { count: applied.changedGroupCount })
        : '',
      applied.changedCollectionOriginCount
        ? t('groups.importDialog.collectionOrigins', {
            count: applied.changedCollectionOriginCount,
          })
        : '',
    ]
      .filter(Boolean)
      .join(' ')
  )
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ t('groups.importDialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('groups.importDialog.description') }}</DialogDescription>
      </DialogHeader>
      <div
        class="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5"
      >
        <div class="min-w-0 space-y-0.5">
          <Label for="group-import-exact-match" class="cursor-pointer text-sm font-medium">
            {{ t('groups.importDialog.exactMatch') }}
          </Label>
          <p id="group-import-exact-match-hint" class="text-xs text-muted-foreground">
            {{ t('groups.importDialog.exactMatchHint') }}
          </p>
        </div>
        <Switch
          id="group-import-exact-match"
          v-model="exactMatch"
          aria-describedby="group-import-exact-match-hint"
        />
      </div>
      <RadioGroup v-model="sourceId" class="grid max-h-[45vh] gap-2 overflow-y-auto py-1">
        <label
          v-for="source in sources"
          :key="source.id"
          class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
          :class="
            sourceId === source.id
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/40'
          "
        >
          <RadioGroupItem :value="source.id" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="source.name">{{
            source.name
          }}</span>
          <span class="shrink-0 text-xs text-muted-foreground">{{
            t('groups.groupCount', { count: source.count })
          }}</span>
        </label>
      </RadioGroup>
      <p v-if="!sources.length" class="py-6 text-center text-sm text-muted-foreground">
        {{ t('groups.importDialog.empty') }}
      </p>
      <div v-if="result" class="space-y-1 text-sm" role="status" aria-live="polite">
        <p>
          {{
            t('groups.importDialog.matched', {
              count: result.matchedGroupCount,
              total: result.targetGroupCount,
            })
          }}
        </p>
        <p
          v-if="result.changedGroupCount || !result.changedCollectionOriginCount"
          class="text-xs text-muted-foreground"
        >
          {{
            result.changedGroupCount
              ? t(
                  exactMatch
                    ? 'groups.importDialog.overwriteExact'
                    : 'groups.importDialog.overwrite',
                  { count: result.changedGroupCount }
                )
              : t('groups.importDialog.noChanges')
          }}
        </p>
        <p v-if="result.changedCollectionOriginCount" class="text-xs text-muted-foreground">
          {{
            t('groups.importDialog.collectionOrigins', {
              count: result.changedCollectionOriginCount,
            })
          }}
        </p>
        <p v-if="result.ambiguousMatchCount" class="text-xs text-amber-600 dark:text-amber-400">
          {{ t('groups.importDialog.ambiguousMatches', { count: result.ambiguousMatchCount }) }}
        </p>
        <p v-if="result.skippedOriginCount" class="text-xs text-amber-600 dark:text-amber-400">
          {{
            t(
              exactMatch
                ? 'groups.importDialog.skippedOrigins'
                : 'groups.importDialog.skippedOriginsFuzzy',
              { count: result.skippedOriginCount }
            )
          }}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSubmit" @click="submit">{{
          t('groups.importDialog.confirm')
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

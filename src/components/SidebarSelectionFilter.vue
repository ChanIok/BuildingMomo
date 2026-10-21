<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useI18n } from '@/composables/useI18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SelectionCategoryId } from '@/types/furniture'

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const { t, locale } = useI18n()
const panelId = useId()
const expanded = ref(true)
const hasSelection = computed(() => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0)

watch(
  hasSelection,
  (selected) => {
    expanded.value = !selected
  },
  { immediate: true }
)

const categories = computed(() => [
  ...gameDataStore.selectionCategories.map((category) => ({
    id: category.id,
    name: locale.value === 'zh' ? category.name_cn : category.name_en,
  })),
  { id: 'uncategorized' as const, name: t('sidebar.selectionFilter.uncategorized') },
])

function isEnabled(id: SelectionCategoryId): boolean {
  return editorStore.selectionCategoryIds?.has(id) ?? true
}

const enabledCategories = computed(() =>
  categories.value.filter((category) => isEnabled(category.id))
)
const allEnabled = computed(() => enabledCategories.value.length === categories.value.length)

function toggleAllCategories() {
  editorStore.selectionCategoryIds = allEnabled.value ? new Set() : null
}

function setCategoryEnabled(id: SelectionCategoryId, enabled: boolean) {
  const ids = new Set(enabledCategories.value.map((category) => category.id))
  if (enabled) ids.add(id)
  else ids.delete(id)
  editorStore.selectionCategoryIds = ids.size === categories.value.length ? null : ids
}
</script>

<template>
  <section class="flex min-h-0 flex-col" :aria-label="t('sidebar.selectionFilter.title')">
    <Tooltip :delay-duration="300">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex w-full shrink-0 items-center justify-between gap-2 px-4 py-3 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          :aria-expanded="expanded"
          :aria-controls="panelId"
          :class="{ 'text-blue-600 dark:text-blue-400': !allEnabled }"
          @click="expanded = !expanded"
        >
          <span class="text-sm font-semibold">{{ t('sidebar.selectionFilter.title') }}</span>
          <ChevronDown
            class="h-4 w-4 shrink-0 transition-transform"
            :class="{ 'rotate-180': expanded }"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" variant="light" class="max-w-64 text-xs leading-5">
        {{ t('sidebar.selectionFilter.hint') }}
      </TooltipContent>
    </Tooltip>

    <ScrollArea v-if="expanded" :id="panelId" class="min-h-0 flex-1">
      <div class="flex flex-col gap-3 px-4 pb-4">
        <div class="grid grid-cols-2 gap-x-3 gap-y-1">
          <label
            v-for="category in categories"
            :key="category.id"
            class="flex min-w-0 cursor-pointer items-start gap-2 rounded py-1.5 text-xs leading-5 select-none"
          >
            <Checkbox
              class="mt-0.5"
              :model-value="isEnabled(category.id)"
              @update:model-value="setCategoryEnabled(category.id, $event === true)"
            />
            <span class="min-w-0 break-words">{{ category.name }}</span>
          </label>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-7 self-end px-2 text-xs"
          @click="toggleAllCategories"
          >{{
            t(
              allEnabled
                ? 'sidebar.selectionFilter.deselectAll'
                : 'sidebar.selectionFilter.selectAll'
            )
          }}</Button
        >
      </div>
    </ScrollArea>
  </section>
</template>

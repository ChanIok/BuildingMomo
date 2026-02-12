<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useI18n } from '@/composables/useI18n'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import type { AppItem, GameColorMap } from '@/types/editor'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'

interface ColorOption {
  colorIndex: number
  iconId: number
}

interface ColorGroup {
  groupId: number
  groupKey: string
  options: ColorOption[]
}

interface GroupSelectionState {
  mode: 'disabled' | 'selected' | 'mixed'
  colorIndex: number | null
}

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const { saveHistory } = useEditorHistory()
const { t } = useI18n()

// 控制显示
const isVisible = defineModel<boolean>('open', { default: false })

const selectedItems = computed(() => {
  const scheme = editorStore.activeScheme
  if (!scheme) return []

  const selectedIds = scheme.selectedItemIds.value
  if (selectedIds.size === 0) return []

  return scheme.items.value.filter((item) => selectedIds.has(item.internalId))
})

const selectedTypeIds = computed(() => {
  return Array.from(new Set(selectedItems.value.map((item) => item.gameId)))
})

const hasSelection = computed(() => selectedItems.value.length > 0)
const isMixedTypeSelection = computed(() => selectedTypeIds.value.length > 1)
const currentTypeId = computed(() => {
  if (selectedTypeIds.value.length !== 1) return null
  return selectedTypeIds.value[0] ?? null
})

const colorGroups = computed<ColorGroup[]>(() => {
  if (currentTypeId.value === null) return []

  const modelConfig = gameDataStore.getFurnitureModelConfig(currentTypeId.value)
  const colors = modelConfig?.colors
  if (!colors) return []

  return Object.entries(colors)
    .map(([groupKey, options]) => {
      const groupId = Number(groupKey)
      if (!Number.isFinite(groupId)) return null

      const parsedOptions: ColorOption[] = Object.entries(options ?? {})
        .map(([colorKey, iconId]) => {
          const colorIndex = Number(colorKey)
          const parsedIconId = Number(iconId)
          if (
            !Number.isFinite(colorIndex) ||
            colorIndex <= 0 ||
            !Number.isFinite(parsedIconId) ||
            parsedIconId < 0
          ) {
            return null
          }
          return { colorIndex, iconId: parsedIconId }
        })
        .filter((entry): entry is ColorOption => entry !== null)
        .sort((a, b) => a.colorIndex - b.colorIndex)

      if (parsedOptions.length === 0) return null

      return {
        groupId,
        groupKey,
        options: parsedOptions,
      }
    })
    .filter((entry): entry is ColorGroup => entry !== null)
    .sort((a, b) => a.groupId - b.groupId)
})

// 染色模式：仅有 group 0 为“简单模式”，否则为“多组模式”
const isSimpleMode = computed(() => {
  return colorGroups.value.length === 1 && colorGroups.value[0]?.groupId === 0
})

const hasColorConfig = computed(() => colorGroups.value.length > 0)

const resetIconUrl = computed(() => `${import.meta.env.BASE_URL}assets/colors/0.png`)

function getColorIconUrl(iconId: number): string {
  return `${import.meta.env.BASE_URL}assets/colors/${iconId}.png`
}

function getColorIndexFromColorMap(
  colorMap: GameColorMap | undefined,
  groupId: number
): number | null {
  const groupMap = decodeColorMapToGroupMap(colorMap)
  const colorIndex = groupMap.get(groupId)
  return typeof colorIndex === 'number' ? colorIndex : null
}

const groupSelectionStates = computed<Record<string, GroupSelectionState>>(() => {
  const states: Record<string, GroupSelectionState> = {}

  for (const group of colorGroups.value) {
    const values = selectedItems.value.map((item) =>
      getColorIndexFromColorMap(item.extra.ColorMap, group.groupId)
    )

    if (values.length === 0) {
      states[group.groupKey] = { mode: 'disabled', colorIndex: null }
      continue
    }

    const first = values[0] ?? null
    const isSame = values.every((value) => value === first)
    if (!isSame) {
      states[group.groupKey] = { mode: 'mixed', colorIndex: null }
      continue
    }

    if (first === null) {
      states[group.groupKey] = { mode: 'disabled', colorIndex: null }
    } else {
      states[group.groupKey] = { mode: 'selected', colorIndex: first }
    }
  }

  return states
})

function isGroupOptionActive(groupKey: string, colorIndex: number | null): boolean {
  const state = groupSelectionStates.value[groupKey]
  if (!state || state.mode === 'mixed') return false
  if (colorIndex === null) return state.mode === 'disabled'
  return state.mode === 'selected' && state.colorIndex === colorIndex
}

function toEditableColorMapObject(colorMap: GameColorMap | undefined): Record<string, number> {
  const result: Record<string, number> = {}
  const groupMap = decodeColorMapToGroupMap(colorMap)

  for (const [groupId, colorIndex] of groupMap.entries()) {
    if (!Number.isFinite(colorIndex) || colorIndex <= 0) continue
    const groupKey = String(groupId)
    result[groupKey] = groupId === 0 ? colorIndex : groupId * 10 + colorIndex
  }

  return result
}

function finalizeColorMapObject(colorMapObject: Record<string, number>): Record<string, number> {
  const entries = Object.entries(colorMapObject)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))

  // 简单模式：无任何条目时，必须保留 { "0": 0 } 作为“未染色”
  if (isSimpleMode.value) {
    if (entries.length === 0) {
      return { '0': 0 }
    }

    const normalized: Record<string, number> = {}
    for (const [groupKey, value] of entries) {
      normalized[groupKey] = value
    }
    return normalized
  }

  // 多组模式：有条目则保留有效条目，无条目则返回空对象 `{}` 作为“未染色”
  const normalized: Record<string, number> = {}
  for (const [groupKey, value] of entries) {
    normalized[groupKey] = value
  }
  return normalized
}

function areColorMapsEqual(
  currentColorMap: GameColorMap | undefined,
  nextColorMap: Record<string, number>
): boolean {
  // 如果当前没有 ColorMap 字段，则无论如何都认为需要写入，避免“缺失字段”的情况
  if (currentColorMap === undefined) {
    return false
  }

  const current = finalizeColorMapObject(toEditableColorMapObject(currentColorMap))
  const next = finalizeColorMapObject(nextColorMap)

  const currentKeys = Object.keys(current)
  const nextKeys = Object.keys(next)

  if (currentKeys.length !== nextKeys.length) return false
  return currentKeys.every((key) => current[key] === next[key])
}

function withNextColorMap(item: AppItem, nextColorMap: Record<string, number>): AppItem {
  return {
    ...item,
    extra: {
      ...item.extra,
      ColorMap: nextColorMap,
    },
  }
}

function applyGroupColor(groupId: number, colorIndex: number | null) {
  const scheme = editorStore.activeScheme
  if (!scheme) return

  const selectedIds = scheme.selectedItemIds.value
  if (selectedIds.size === 0) return

  const groupKey = String(groupId)
  let changed = false

  const newItems = scheme.items.value.map((item) => {
    if (!selectedIds.has(item.internalId)) return item

    const editableColorMap = toEditableColorMapObject(item.extra.ColorMap)
    if (colorIndex === null) {
      // 关闭该组染色
      if (isSimpleMode.value && groupId === 0) {
        // 简单模式：group 0 置为 0
        editableColorMap[groupKey] = 0
      } else {
        // 多组模式：删除该组条目
        delete editableColorMap[groupKey]
      }
    } else {
      // 开启/切换该组染色
      if (isSimpleMode.value && groupId === 0) {
        // 简单模式：直接写颜色编号
        editableColorMap[groupKey] = colorIndex
      } else {
        // 多组模式：按「组编号 * 10 + 颜色编号」编码
        editableColorMap[groupKey] = groupId * 10 + colorIndex
      }
    }

    const nextColorMap = finalizeColorMapObject(editableColorMap)
    if (areColorMapsEqual(item.extra.ColorMap, nextColorMap)) {
      return item
    }

    changed = true
    return withNextColorMap(item, nextColorMap)
  })

  if (!changed) return

  saveHistory('edit')
  scheme.items.value = newItems
  editorStore.triggerSceneUpdate()
}

function resetAllSelectedColors() {
  const scheme = editorStore.activeScheme
  if (!scheme) return

  const selectedIds = scheme.selectedItemIds.value
  if (selectedIds.size === 0) return

  let changed = false

  const newItems = scheme.items.value.map((item) => {
    if (!selectedIds.has(item.internalId)) {
      return item
    }

    // 根据每个物体自己的模型配置，决定是简单模式还是多组模式
    const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
    const colors = modelConfig?.colors
    if (!colors) {
      // 不支持染色的物体保持不变
      return item
    }

    const colorKeys = Object.keys(colors)
    const itemIsSimpleMode = colorKeys.length === 1 && colorKeys[0] === '0'

    const targetColorMap: Record<string, number> = itemIsSimpleMode ? { '0': 0 } : {}

    // 避免无意义写入：如果已经是目标状态则跳过
    const current = item.extra.ColorMap
    let isSame = false
    if (current && !Array.isArray(current)) {
      const currentKeys = Object.keys(current)
      const targetKeys = Object.keys(targetColorMap)
      if (
        currentKeys.length === targetKeys.length &&
        currentKeys.every((key) => current[key] === targetColorMap[key])
      ) {
        isSame = true
      }
    }

    if (isSame) {
      return item
    }

    changed = true
    return {
      ...item,
      extra: {
        ...item.extra,
        ColorMap: targetColorMap,
      },
    }
  })

  if (!changed) return

  saveHistory('edit')
  scheme.items.value = newItems
  editorStore.triggerSceneUpdate()
}

function close() {
  isVisible.value = false
}

function handleIconError(event: Event) {
  ;(event.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <div
    v-if="isVisible"
    class="absolute top-4 left-4 z-50 flex max-h-[calc(100%-32px)] w-auto flex-col rounded-md border border-border bg-background/90 shadow-2xl backdrop-blur-md"
  >
    <div class="flex items-center justify-between gap-4 p-3">
      <h3 class="text-sm font-semibold">{{ t('dyePanel.title') }}</h3>
      <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" @click="close">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="p-4 pt-1">
        <div
          v-if="!hasSelection"
          class="flex h-32 w-48 items-center justify-center rounded-md bg-secondary/40 px-3 text-center text-sm text-muted-foreground"
        >
          {{ t('dyePanel.noSelection') }}
        </div>

        <div v-else-if="isMixedTypeSelection" class="flex flex-col items-center gap-3">
          <span class="text-xs font-medium text-foreground">
            {{ t('dyePanel.resetAll') }}
          </span>
          <button
            type="button"
            class="relative h-12 w-12 rounded-full transition-all hover:ring-2 hover:ring-muted-foreground/50 hover:ring-offset-1 hover:ring-offset-background"
            @click="resetAllSelectedColors"
            :title="t('dyePanel.resetAll')"
          >
            <span class="flex h-full w-full items-center justify-center rounded-full bg-muted/80">
              <img
                :src="resetIconUrl"
                :alt="t('dyePanel.resetAll')"
                class="h-9 w-9 object-contain opacity-50 invert dark:opacity-100 dark:invert-0"
                @error="handleIconError"
              />
            </span>
          </button>
        </div>

        <div
          v-else-if="!hasColorConfig"
          class="flex h-32 w-48 items-center justify-center rounded-md bg-secondary/40 px-3 text-center text-sm text-muted-foreground"
        >
          {{ t('dyePanel.unsupported') }}
        </div>

        <!-- Main dye grid: columns per group, vertical options -->
        <div v-else class="flex justify-center gap-6">
          <div
            v-for="group in colorGroups"
            :key="group.groupKey"
            class="flex flex-col items-center gap-3"
          >
            <!-- Column header -->
            <div class="flex flex-col items-center gap-1">
              <span class="text-xs font-medium text-foreground">
                {{ t('dyePanel.group', { group: group.groupId }) }}
              </span>
              <span
                v-if="groupSelectionStates[group.groupKey]?.mode === 'mixed'"
                class="text-[10px] text-muted-foreground"
              >
                ({{ t('dyePanel.mixed') }})
              </span>
            </div>

            <!-- Color options (vertical) -->
            <div class="flex flex-col items-center gap-3">
              <!-- Reset/Disable option -->
              <button
                type="button"
                class="relative h-12 w-12 rounded-full transition-all"
                :class="
                  isGroupOptionActive(group.groupKey, null)
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'hover:ring-2 hover:ring-muted-foreground/50 hover:ring-offset-1 hover:ring-offset-background'
                "
                @click="applyGroupColor(group.groupId, null)"
                :title="t('dyePanel.disable')"
              >
                <span
                  class="flex h-full w-full items-center justify-center rounded-full bg-muted/80"
                >
                  <img
                    :src="resetIconUrl"
                    :alt="t('dyePanel.disable')"
                    class="h-9 w-9 object-contain opacity-50 invert dark:opacity-100 dark:invert-0"
                    @error="handleIconError"
                  />
                </span>
                <!-- Checkmark overlay -->
                <span
                  v-if="isGroupOptionActive(group.groupKey, null)"
                  class="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <svg
                    class="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    viewBox="0 0 24 24"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              </button>

              <!-- Color options -->
              <button
                v-for="option in group.options"
                :key="option.colorIndex"
                type="button"
                class="relative h-12 w-12 rounded-full transition-all"
                :class="
                  isGroupOptionActive(group.groupKey, option.colorIndex)
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'hover:ring-2 hover:ring-muted-foreground/50 hover:ring-offset-1 hover:ring-offset-background'
                "
                @click="applyGroupColor(group.groupId, option.colorIndex)"
                :title="`${t('dyePanel.group', { group: group.groupId })} #${option.colorIndex}`"
              >
                <span
                  class="flex h-full w-full items-center justify-center rounded-full bg-muted/80"
                >
                  <img
                    :src="getColorIconUrl(option.iconId)"
                    :alt="`#${option.colorIndex}`"
                    class="h-10 w-10 object-contain"
                    @error="handleIconError"
                  />
                </span>
                <!-- Checkmark overlay -->
                <span
                  v-if="isGroupOptionActive(group.groupKey, option.colorIndex)"
                  class="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <svg
                    class="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    viewBox="0 0 24 24"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>

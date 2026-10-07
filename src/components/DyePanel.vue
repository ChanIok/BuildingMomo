<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useI18n } from '@/composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import type { AppItem, GameColorMap } from '@/types/editor'
import type { FurnitureCombinationColorPreset } from '@/types/furniture'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'
import { cleanFurnitureColors } from '@/lib/furnitureColorValidation'

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

interface CombinationMatch {
  items: AppItem[]
  memberIndexes: number[]
  presets: FurnitureCombinationColorPreset[]
}

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const { recordTransaction } = useEditorHistory()
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

const combinationMatch = computed<CombinationMatch | null>(() => {
  const scheme = editorStore.activeScheme
  const selected = selectedItems.value
  if (!scheme || selected.length < 2) return null

  const groupId = selected[0]?.groupId ?? 0
  if (groupId <= 0 || selected.some((item) => item.groupId !== groupId)) return null
  const groupItems = scheme.items.value.filter((item) => item.groupId === groupId)
  if (groupItems.length !== selected.length) return null

  const itemCenter = groupItems.reduce<[number, number, number]>(
    (center, item) => [center[0] + item.x, center[1] + item.y, center[2] + item.z],
    [0, 0, 0]
  )
  itemCenter[0] /= groupItems.length
  itemCenter[1] /= groupItems.length
  itemCenter[2] /= groupItems.length
  const itemDistance = (item: AppItem) =>
    (item.x - itemCenter[0]) ** 2 + (item.y - itemCenter[1]) ** 2 + (item.z - itemCenter[2]) ** 2
  const orderedItems = [...groupItems].sort(
    (a, b) =>
      a.gameId - b.gameId || itemDistance(a) - itemDistance(b) || a.instanceId - b.instanceId
  )

  const matches: CombinationMatch[] = []
  for (const furniture of Object.values(gameDataStore.furnitureData)) {
    const members = furniture.combination
    const presets = furniture.combinationColorPresets
    if (!members || members.length !== orderedItems.length || !presets?.length) continue

    const memberCenter = members.reduce<[number, number, number]>(
      (center, member) => [
        center[0] + member.position[0],
        center[1] + member.position[1],
        center[2] + member.position[2],
      ],
      [0, 0, 0]
    )
    memberCenter[0] /= members.length
    memberCenter[1] /= members.length
    memberCenter[2] /= members.length
    const memberDistance = (index: number) => {
      const position = members[index]!.position
      return (
        (position[0] - memberCenter[0]) ** 2 +
        (position[1] - memberCenter[1]) ** 2 +
        (position[2] - memberCenter[2]) ** 2
      )
    }
    const orderedMembers = members
      .map((member, index) => ({ member, index }))
      .sort(
        (a, b) =>
          a.member.itemId - b.member.itemId ||
          memberDistance(a.index) - memberDistance(b.index) ||
          a.index - b.index
      )
    if (orderedMembers.some(({ member }, index) => member.itemId !== orderedItems[index]?.gameId)) {
      continue
    }
    const maxItemDistance = Math.max(...orderedItems.map(itemDistance))
    const maxMemberDistance = Math.max(...orderedMembers.map(({ index }) => memberDistance(index)))
    if (
      orderedMembers.some(({ index }, orderIndex) => {
        const itemRatio = maxItemDistance
          ? itemDistance(orderedItems[orderIndex]!) / maxItemDistance
          : 0
        const memberRatio = maxMemberDistance ? memberDistance(index) / maxMemberDistance : 0
        return Math.abs(itemRatio - memberRatio) > 1e-4
      })
    ) {
      continue
    }
    matches.push({
      items: orderedItems,
      memberIndexes: orderedMembers.map(({ index }) => index),
      presets,
    })
  }

  return matches.length === 1 ? matches[0]! : null
})

const colorGroups = computed<ColorGroup[]>(() => {
  if (currentTypeId.value === null) return []

  const colors = gameDataStore.getFurniture(currentTypeId.value)?.colors
  if (!colors) return []

  return Object.entries(colors)
    .map(([groupKey, variants]) => {
      const groupId = Number(groupKey)
      if (!Number.isFinite(groupId)) return null

      const parsedOptions: ColorOption[] = Object.entries(variants ?? {})
        .map(([colorKey, entry]) => {
          const colorIndex = Number(colorKey)
          if (!Number.isFinite(colorIndex) || colorIndex <= 0) return null
          const iconId = typeof entry === 'object' && entry !== null ? Number(entry.idx) : -1
          if (!Number.isFinite(iconId) || iconId < 0) return null
          return { colorIndex, iconId }
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

function areEffectiveColorMapsEqual(
  left: GameColorMap | undefined,
  right: GameColorMap | undefined
): boolean {
  const leftMap = decodeColorMapToGroupMap(left)
  const rightMap = decodeColorMapToGroupMap(right)
  if (leftMap.size !== rightMap.size) return false
  return Array.from(leftMap).every(([groupId, colorIndex]) => rightMap.get(groupId) === colorIndex)
}

function isCombinationPresetActive(preset: FurnitureCombinationColorPreset): boolean {
  const match = combinationMatch.value
  if (!match) return false
  return match.items.every((item, index) =>
    areEffectiveColorMapsEqual(
      item.extra.ColorMap,
      preset.colorMaps[match.memberIndexes[index]!] ?? {}
    )
  )
}

function applyCombinationColorPreset(preset: FurnitureCombinationColorPreset) {
  const scheme = editorStore.activeScheme
  const match = combinationMatch.value
  if (!scheme || !match || preset.colorMaps.length !== match.memberIndexes.length) return

  const nextColorMaps = new Map<string, Record<string, number>>()
  match.items.forEach((item, index) => {
    nextColorMaps.set(
      item.internalId,
      finalizeColorMapObject(
        toEditableColorMapObject(preset.colorMaps[match.memberIndexes[index]!] ?? {}, item.gameId)
      )
    )
  })
  if (
    match.items.every((item) =>
      areColorMapsEqual(item.extra.ColorMap, nextColorMaps.get(item.internalId)!)
    )
  ) {
    return
  }

  recordTransaction('dye.apply.combination', () => {
    scheme.items.value = scheme.items.value.map((item) => {
      const colorMap = nextColorMaps.get(item.internalId)
      if (!colorMap) return item
      return {
        ...item,
        extra: {
          ...item.extra,
          ColorMap: { ...colorMap },
        },
      }
    })
    editorStore.triggerSceneUpdate()
  })
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

function toEditableColorMapObject(
  colorMap: GameColorMap | undefined,
  itemId: number
): Record<string, number> {
  return cleanFurnitureColors(colorMap, gameDataStore.getFurniture(itemId)?.colors)
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

  // 比较原始数据，避免把重复/无效色盘折叠后误判为无需修正。
  const current = Object.entries(currentColorMap)
  if (current.length !== Object.keys(nextColorMap).length) return false
  return current.every(([key, value]) => nextColorMap[key] === value)
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

  recordTransaction(colorIndex === null ? 'dye.disable' : 'dye.apply', () => {
    let changed = false

    const newItems = scheme.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) return item

      const editableColorMap = toEditableColorMapObject(item.extra.ColorMap, item.gameId)
      if (colorIndex === null) {
        // 关闭该组染色
        if (isSimpleMode.value && groupId === 0) {
          // 简单模式：group 0 置为 0
          editableColorMap[groupKey] = 0
        } else {
          // 多组模式：删除该组条目
          delete editableColorMap[groupKey]
        }
      } else if (isSimpleMode.value && groupId === 0) {
        // 开启/切换该组染色
        // 简单模式：直接写颜色编号
        editableColorMap[groupKey] = colorIndex
      } else {
        // 开启/切换该组染色
        // 多组模式：按「组编号 * 10 + 颜色编号」编码
        editableColorMap[groupKey] = groupId * 10 + colorIndex
      }

      const nextColorMap = finalizeColorMapObject(editableColorMap)
      if (areColorMapsEqual(item.extra.ColorMap, nextColorMap)) {
        return item
      }

      changed = true
      return withNextColorMap(item, nextColorMap)
    })

    if (!changed) return

    scheme.items.value = newItems
    editorStore.triggerSceneUpdate()
  })
}

function resetAllSelectedColors() {
  const scheme = editorStore.activeScheme
  if (!scheme) return

  const selectedIds = scheme.selectedItemIds.value
  if (selectedIds.size === 0) return

  recordTransaction('dye.reset', () => {
    let changed = false

    const newItems = scheme.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) {
        return item
      }

      // 根据每个物体自己的染色配置，决定是简单模式还是多组模式
      const colors = gameDataStore.getFurniture(item.gameId)?.colors
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

    scheme.items.value = newItems
    editorStore.triggerSceneUpdate()
  })
}

function close() {
  isVisible.value = false
}

function handleIconError(event: Event) {
  ;(event.target as HTMLImageElement).style.display = 'none'
}
</script>

<style scoped>
.dye-panel-container {
  --accent: color-mix(in srgb, var(--primary) 15%, transparent);
  --accent-foreground: var(--primary);
  --muted: color-mix(in srgb, var(--primary) 15%, transparent);
  --muted-foreground: var(--primary);
}
</style>

<template>
  <div
    v-if="isVisible"
    class="dye-panel-container absolute top-4 left-4 z-50 flex max-h-[calc(100%-32px)] w-auto flex-col rounded-md border border-border bg-background/90 shadow-2xl backdrop-blur-md"
  >
    <div class="flex items-center justify-between gap-4 p-3 pr-2">
      <h3 class="text-sm font-semibold">{{ t('dyePanel.title') }}</h3>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="group flex h-8 w-8 shrink-0 cursor-default items-center justify-center bg-transparent focus-visible:outline-none"
          :aria-label="t('common.close')"
          @click="close"
        >
          <div
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all duration-200 group-hover:bg-accent group-hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </div>
        </button>
      </div>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="p-4 pt-1">
        <div
          v-if="!hasSelection"
          class="flex h-32 w-48 items-center justify-center rounded-md bg-secondary/40 px-3 text-center text-sm text-muted-foreground"
        >
          {{ t('dyePanel.noSelection') }}
        </div>

        <div v-else-if="combinationMatch" class="flex min-w-48 flex-col items-center gap-3">
          <span class="text-xs font-medium text-foreground">
            {{ t('dyePanel.combinationPresets') }}
          </span>
          <div class="flex flex-wrap justify-center gap-3">
            <button
              v-for="preset in combinationMatch.presets"
              :key="preset.id"
              type="button"
              class="relative h-12 w-12 rounded-full transition-all hover:ring-2 hover:ring-muted-foreground/50 hover:ring-offset-1 hover:ring-offset-background"
              :class="
                isCombinationPresetActive(preset)
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : ''
              "
              :title="
                preset.id === 0
                  ? t('dyePanel.combinationDefault')
                  : t('dyePanel.combinationPreset', { id: preset.id })
              "
              @click="applyCombinationColorPreset(preset)"
            >
              <span class="flex h-full w-full items-center justify-center rounded-full bg-muted/80">
                <img
                  :src="getColorIconUrl(preset.iconId)"
                  alt=""
                  class="h-9 w-9 object-contain"
                  :class="
                    preset.iconId === 0 ? 'opacity-50 invert dark:opacity-100 dark:invert-0' : ''
                  "
                  @error="handleIconError"
                />
              </span>
            </button>
          </div>
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

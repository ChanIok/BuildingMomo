<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { useI18n } from '@/composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { LayoutGrid, Maximize2, Minimize2, Search, X } from 'lucide-vue-next'
import type { FurnitureCategory } from '@/types/furniture'
import PinyinMatch from 'pinyin-match'

const gameDataStore = useGameDataStore()
const editorStore = useEditorStore()
const { addFurnitureItem, addFurnitureCombination } = useEditorItemAdd()
const { t, locale } = useI18n()

// 控制显示
const isVisible = defineModel<boolean>('open', { default: false })

// Panel width expand/collapse state
const isExpanded = ref(false)

const searchQuery = ref('')
const selectedMajorId = ref<number | null>(null)
const selectedMinorId = ref<number | null>(null)
const furnitureScrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const minorCategoryScrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const furnitureScrollPositions = new Map<string, number>()

const categoryList = computed(() =>
  Object.values(gameDataStore.furnitureCategories).sort((a, b) => a.id - b.id)
)

const populatedMinorIds = computed(
  () => new Set(Object.values(gameDataStore.furnitureData).map((item) => item.categoryId))
)

const minorCategoryList = computed(() =>
  categoryList.value.filter(
    (category) => category.parentId !== null && populatedMinorIds.value.has(category.id)
  )
)

const majorCategories = computed(() => {
  const populatedMajorIds = new Set(minorCategoryList.value.map((category) => category.parentId))
  return categoryList.value.filter(
    (category) => category.parentId === null && populatedMajorIds.has(category.id)
  )
})

const activeMajorId = computed(() => selectedMajorId.value ?? majorCategories.value[0]?.id ?? null)

const activeMajor = computed(
  () => majorCategories.value.find((category) => category.id === activeMajorId.value) ?? null
)

const minorCategories = computed(() =>
  minorCategoryList.value.filter((category) => category.parentId === activeMajorId.value)
)

const activeMinor = computed(
  () => minorCategories.value.find((category) => category.id === selectedMinorId.value) ?? null
)

const furnitureScrollKey = computed(() => {
  if (searchQuery.value.trim()) return 'search'
  if (selectedMinorId.value !== null) return `minor:${selectedMinorId.value}`
  return `major:${activeMajorId.value ?? 'none'}`
})

function getFurnitureScrollViewport(): HTMLElement | null {
  return furnitureScrollRef.value?.$el?.querySelector('[data-slot="scroll-area-viewport"]') ?? null
}

function getMinorCategoryScrollViewport(): HTMLElement | null {
  return (
    minorCategoryScrollRef.value?.$el?.querySelector('[data-slot="scroll-area-viewport"]') ?? null
  )
}

function handleMinorCategoryWheel(event: WheelEvent) {
  // Shift 保留浏览器原生的横向滚动行为。
  if (event.shiftKey) return

  const viewport = getMinorCategoryScrollViewport()
  // 未溢出时不拦截滚轮，让事件按默认方式继续处理。
  if (!viewport || viewport.scrollWidth <= viewport.clientWidth || event.deltaY === 0) return

  event.preventDefault()
  viewport.scrollLeft += event.deltaY
}

watch(furnitureScrollKey, async (key, previousKey) => {
  const previousViewport = getFurnitureScrollViewport()
  if (previousViewport) furnitureScrollPositions.set(previousKey, previousViewport.scrollTop)

  await nextTick()
  const viewport = getFurnitureScrollViewport()
  if (viewport) viewport.scrollTop = furnitureScrollPositions.get(key) ?? 0
})

function getCategoryName(category: FurnitureCategory): string {
  return locale.value === 'zh' ? category.name_cn : category.name_en
}

function getCategoryIconStyle(categoryId: number): CSSProperties {
  const url = gameDataStore.getCategoryIconUrl(categoryId)
  return {
    backgroundColor: 'currentColor',
    maskImage: `url("${url}")`,
    maskMode: 'luminance',
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskImage: `url("${url}")`,
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
  }
}

const classificationLabel = computed(() => {
  if (searchQuery.value.trim()) return t('furnitureLibrary.searchResults')
  if (!activeMajor.value) return ''
  return `${getCategoryName(activeMajor.value)} · ${activeMinor.value ? getCategoryName(activeMinor.value) : t('furnitureLibrary.all')}`
})

// 处理家具列表
const furnitureList = computed(() => {
  const data = gameDataStore.furnitureData
  const lang = locale.value

  return Object.entries(data)
    .map(([id, item]) => ({
      id: parseInt(id),
      name: lang === 'zh' ? item.name_cn : item.name_en,
      icon: gameDataStore.getIconUrl(parseInt(id)),
      categoryId: item.categoryId,
      colorPresets: item.combinationColorPresets,
    }))
    .sort((a, b) => a.id - b.id)
})

// 搜索过滤
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    return furnitureList.value.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.id.toString().includes(query) ||
        (locale.value === 'zh' && PinyinMatch.match(item.name, query))
    )
  }

  if (selectedMinorId.value !== null) {
    return furnitureList.value.filter((item) => item.categoryId === selectedMinorId.value)
  }

  const categoryIds = new Set(minorCategories.value.map((category) => category.id))
  return furnitureList.value.filter((item) => categoryIds.has(item.categoryId))
})

// 添加家具
function handleAddItem(itemId: number, colorPresetId?: number) {
  if (!editorStore.activeScheme) return

  const furniture = gameDataStore.getFurniture(itemId)
  const combination = furniture?.combination
  if (combination) {
    const colorPreset =
      colorPresetId === undefined
        ? furniture.combinationColorPresets?.find((preset) => preset.id === 0)
        : furniture.combinationColorPresets?.find((preset) => preset.id === colorPresetId)
    addFurnitureCombination(combination, colorPreset)
  } else {
    addFurnitureItem(itemId)
  }
  // 不关闭面板，方便连续添加
}

function getCombinationColorIconUrl(iconId: number): string {
  return `${import.meta.env.BASE_URL}assets/colors/${iconId}.png`
}

function getCombinationColorLabel(colorId: number): string {
  return colorId === 0
    ? t('furnitureLibrary.combinationDefaultColor')
    : t('furnitureLibrary.combinationColor', { id: colorId })
}

function close() {
  isVisible.value = false
}

function selectMajor(categoryId: number) {
  selectedMajorId.value = categoryId
  selectedMinorId.value = null
  searchQuery.value = ''
}

function selectMinor(categoryId: number | null) {
  selectedMinorId.value = categoryId
  searchQuery.value = ''
}

// 清除搜索
function clearSearch() {
  searchQuery.value = ''
}
</script>

<template>
  <!-- 悬浮在画布左上角 -->
  <div
    v-show="isVisible"
    class="furniture-library-container absolute top-4 bottom-18 left-4 z-50 flex w-[calc(100%-2rem)] flex-col overflow-hidden rounded-md border border-border bg-muted/90 shadow-2xl transition-[max-width] duration-300 ease-in-out"
    :class="isExpanded ? 'max-w-none' : 'max-w-xl'"
  >
    <TooltipProvider :delay-duration="600">
      <!-- 顶部搜索栏 -->
      <div class="flex items-center gap-2 p-2 pl-14">
        <div class="relative min-w-0 flex-1">
          <Search
            class="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            :placeholder="t('furnitureLibrary.searchPlaceholder')"
            class="h-8 rounded-md border-none bg-background pr-8 pl-7 text-xs shadow-none"
            autofocus
          />
          <Tooltip v-if="searchQuery.trim()">
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                @click="clearSearch"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="pointer-events-none text-xs">
              {{ locale === 'zh' ? '清除搜索' : 'Clear search' }}
            </TooltipContent>
          </Tooltip>
        </div>
        <!-- Expand / Collapse Toggle Button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="group hidden h-8 w-8 shrink-0 cursor-default items-center justify-center bg-transparent focus-visible:outline-none sm:flex"
              :aria-label="
                isExpanded ? t('furnitureLibrary.collapse') : t('furnitureLibrary.expand')
              "
              @click="isExpanded = !isExpanded"
            >
              <div
                class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all duration-200 group-hover:bg-accent group-hover:text-foreground"
              >
                <Minimize2 v-if="isExpanded" class="h-4 w-4" />
                <Maximize2 v-else class="h-4 w-4" />
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="pointer-events-none text-xs">
            {{ isExpanded ? t('furnitureLibrary.collapse') : t('furnitureLibrary.expand') }}
          </TooltipContent>
        </Tooltip>

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

      <div class="flex min-h-0 flex-1">
        <!-- 游戏中的左侧大类栏 -->
        <nav class="w-14 shrink-0" :aria-label="t('furnitureLibrary.majorCategories')">
          <ScrollArea class="h-full">
            <div class="flex flex-col items-center pb-2">
              <Tooltip v-for="category in majorCategories" :key="category.id">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="group flex h-11 w-full cursor-default items-center justify-center bg-transparent focus-visible:outline-none"
                    :aria-label="getCategoryName(category)"
                    :aria-pressed="activeMajorId === category.id"
                    @click="selectMajor(category.id)"
                  >
                    <div
                      class="flex h-8 w-8 items-center justify-center rounded-md transition-all duration-200"
                      :class="
                        activeMajorId === category.id
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-foreground/70 group-hover:bg-accent group-hover:text-foreground'
                      "
                    >
                      <span class="h-6 w-6" :style="getCategoryIconStyle(category.id)" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" :side-offset="-8" class="pointer-events-none text-xs">
                  {{ getCategoryName(category) }}
                </TooltipContent>
              </Tooltip>
            </div>
            <ScrollBar orientation="vertical" class="!w-1.5" />
          </ScrollArea>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col rounded-tl-md bg-background">
          <!-- 游戏中的顶部小类栏；“全部”是每个大类下的合并视图 -->
          <nav
            v-if="!searchQuery.trim()"
            class="flex h-11 items-center"
            :aria-label="t('furnitureLibrary.minorCategories')"
          >
            <ScrollArea
              ref="minorCategoryScrollRef"
              class="h-full min-w-0 flex-1 whitespace-nowrap"
              @wheel.capture="handleMinorCategoryWheel"
            >
              <div class="flex h-full w-max items-center gap-0.5 px-2">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="group flex h-full shrink-0 cursor-default items-center justify-center bg-transparent px-1.5 focus-visible:outline-none"
                      :aria-label="t('furnitureLibrary.all')"
                      :aria-pressed="selectedMinorId === null"
                      @click="selectMinor(null)"
                    >
                      <div
                        class="flex h-8 w-8 items-center justify-center rounded-md transition-all duration-200"
                        :class="
                          selectedMinorId === null
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground group-hover:bg-accent group-hover:text-foreground'
                        "
                      >
                        <LayoutGrid class="h-5 w-5" />
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    :side-offset="-2"
                    class="pointer-events-none text-xs"
                  >
                    {{ t('furnitureLibrary.all') }}
                  </TooltipContent>
                </Tooltip>

                <Tooltip v-for="category in minorCategories" :key="category.id">
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="group flex h-full shrink-0 cursor-default items-center justify-center bg-transparent px-1.5 focus-visible:outline-none"
                      :aria-label="getCategoryName(category)"
                      :aria-pressed="selectedMinorId === category.id"
                      @click="
                        selectedMinorId === category.id
                          ? selectMinor(null)
                          : selectMinor(category.id)
                      "
                    >
                      <div
                        class="flex h-8 w-8 items-center justify-center rounded-md transition-all duration-200"
                        :class="
                          selectedMinorId === category.id
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-foreground/70 group-hover:bg-accent group-hover:text-foreground'
                        "
                      >
                        <span class="h-6 w-6" :style="getCategoryIconStyle(category.id)" />
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    :side-offset="-2"
                    class="pointer-events-none text-xs"
                  >
                    {{ getCategoryName(category) }}
                  </TooltipContent>
                </Tooltip>
              </div>
              <ScrollBar orientation="horizontal" class="!h-1.5" />
            </ScrollArea>
            <div
              class="max-w-32 shrink-0 truncate px-3 text-sm text-muted-foreground sm:max-w-56"
              :title="classificationLabel"
            >
              {{ classificationLabel }}
            </div>
          </nav>

          <!-- 家具网格（可滚动） -->
          <ScrollArea ref="furnitureScrollRef" class="min-h-0 flex-1">
            <div class="furniture-grid">
              <div
                v-for="item in filteredItems"
                :key="item.id"
                class="flex min-w-0 flex-col items-center rounded transition-colors hover:bg-accent"
              >
                <button
                  type="button"
                  class="flex w-full min-w-0 flex-col items-center p-1.5 active:scale-95"
                  :title="item.name"
                  @click="handleAddItem(item.id)"
                >
                  <img
                    :src="item.icon"
                    class="aspect-square w-full rounded border bg-muted object-cover"
                    :alt="item.name"
                    loading="lazy"
                    @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                  />
                  <span class="mt-1 line-clamp-2 max-w-full text-center text-[11px] leading-tight">
                    {{ item.name }}
                  </span>
                </button>
                <div
                  v-if="item.colorPresets?.length"
                  class="flex flex-wrap justify-center gap-1 px-1 pb-1.5"
                >
                  <button
                    v-for="preset in item.colorPresets"
                    :key="preset.id"
                    type="button"
                    class="h-5 w-5 rounded-full border border-border bg-background p-0.5 transition hover:ring-2 hover:ring-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
                    :title="getCombinationColorLabel(preset.id)"
                    :aria-label="`${item.name} · ${getCombinationColorLabel(preset.id)}`"
                    @click="handleAddItem(item.id, preset.id)"
                  >
                    <img
                      :src="getCombinationColorIconUrl(preset.iconId)"
                      class="h-full w-full rounded-full object-contain"
                      :class="preset.iconId === 0 ? 'invert dark:invert-0' : ''"
                      alt=""
                      @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                    />
                  </button>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div
              v-if="filteredItems.length === 0"
              class="flex h-32 flex-col items-center justify-center text-muted-foreground"
            >
              <Search class="mb-2 h-8 w-8 opacity-50" />
              <span class="text-sm">{{ t('furnitureLibrary.noResults') }}</span>
            </div>

            <ScrollBar orientation="vertical" class="!w-1.5" />
          </ScrollArea>
        </div>
      </div>
    </TooltipProvider>
  </div>
</template>

<style scoped>
.furniture-library-container {
  /* 使得 bg-accent 变为包含 20% 项目主色调的半透明色 */
  --accent: color-mix(in srgb, var(--primary) 20%, transparent);
  --accent-foreground: var(--primary);

  /* 如果您希望 Hover 更加突出，甚至可以使用 25% */
  /* --accent: color-mix(in srgb, var(--primary) 25%, transparent); */
}

.furniture-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.25rem;
  padding: 0 0.5rem 0.5rem 0.5rem;
}
</style>

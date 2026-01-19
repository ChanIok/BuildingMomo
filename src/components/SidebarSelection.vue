<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Ruler, X } from 'lucide-vue-next'
import { useEditorStore } from '../stores/editorStore'
import { useGameDataStore } from '../stores/gameDataStore'
import { useUIStore } from '../stores/uiStore'
import { useEditorGroups } from '../composables/editor/useEditorGroups'
import { useI18n } from '../composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const uiStore = useUIStore()
const { getGroupItems, groupSelected, ungroupSelected, clearGroupOrigin } = useEditorGroups()
const { t, locale } = useI18n()

// 辅助函数：根据语言获取名称
function getFurnitureName(furniture: any, fallbackId: number) {
  if (!furniture) return t('sidebar.itemDefaultName', { id: fallbackId })
  if (locale.value === 'zh') return furniture.name_cn
  return furniture.name_en || furniture.name_cn
}

// 计算属性:选中物品列表
const selectedItems = computed(() => {
  const scheme = editorStore.activeScheme
  if (!scheme) return []
  const ids = scheme.selectedItemIds.value
  if (ids.size === 0) return []
  return scheme.items.value.filter((item) => ids.has(item.internalId))
})

// 计算属性:选中物品的组信息
const selectedGroupInfo = computed(() => {
  const items = selectedItems.value
  if (items.length === 0) return null

  const groupIds = new Set(items.map((item) => item.groupId))

  // 如果所有选中物品都是无组
  if (groupIds.size === 1 && groupIds.has(0)) {
    return { type: 'none', count: items.length }
  }

  // 如果所有选中物品都属于同一组
  if (groupIds.size === 1) {
    const groupId = Array.from(groupIds)[0]!
    const groupItems = getGroupItems(groupId)
    return {
      type: 'single',
      groupId,
      selectedCount: items.length,
      totalCount: groupItems.length,
    }
  }

  // 如果选中了多个组(或混合)
  const groupCount = Array.from(groupIds).filter((id) => id > 0).length
  return {
    type: 'multiple',
    groupCount,
    selectedCount: items.length,
  }
})

// 计算属性:选中物品详情
const selectedItemDetails = computed(() => {
  const selected = selectedItems.value
  if (selected.length === 0) return null

  // 单个物品
  if (selected.length === 1) {
    const item = selected[0]
    if (!item) return null

    const furniture = gameDataStore.getFurniture(item.gameId)

    // 计算尺寸字符串
    let dimensions = null
    if (furniture) {
      const size = furniture.size
      const scale = item.extra.Scale
      const l = parseFloat((size[0] * scale.X).toFixed(1))
      const w = parseFloat((size[1] * scale.Y).toFixed(1))
      const h = parseFloat((size[2] * scale.Z).toFixed(1))
      dimensions = `${l}x${w}x${h} cm`
    }
    return {
      type: 'single' as const,
      name: getFurnitureName(furniture, item.gameId),
      icon: furniture ? gameDataStore.getIconUrl(item.gameId) : null,
      itemId: item.gameId,
      dimensions,
      x: item.x,
      y: item.y,
      z: item.z,
    }
  }

  // 多个物品 - 聚合统计
  const itemStats = new Map<
    number,
    {
      itemId: number
      name: string
      icon: string | null
      count: number
    }
  >()

  selected.forEach((item) => {
    const existing = itemStats.get(item.gameId)
    if (existing) {
      existing.count++
    } else {
      const furniture = gameDataStore.getFurniture(item.gameId)
      itemStats.set(item.gameId, {
        itemId: item.gameId,
        name: getFurnitureName(furniture, item.gameId),
        icon: furniture ? gameDataStore.getIconUrl(item.gameId) : null,
        count: 1,
      })
    }
  })

  // 按数量降序排序
  const items = Array.from(itemStats.values()).sort((a, b) => b.count - a.count)

  return {
    type: 'multiple' as const,
    totalCount: selected.length,
    items,
  }
})

// 分帧渲染逻辑
const renderLimit = ref(30)

const visibleItems = computed(() => {
  const details = selectedItemDetails.value
  if (details?.type !== 'multiple') return []
  return details.items.slice(0, renderLimit.value)
})

watch(
  () => selectedItemDetails.value,
  (newVal) => {
    // 重置显示数量，确保首屏快速响应
    renderLimit.value = 30

    // 如果列表较长，启动分帧加载
    if (newVal?.type === 'multiple' && newVal.items.length > 30) {
      const animate = () => {
        // 再次检查状态，防止在异步过程中数据已变化
        if (!selectedItemDetails.value || selectedItemDetails.value.type !== 'multiple') return

        // 如果已全部显示，停止
        if (renderLimit.value >= selectedItemDetails.value.items.length) return

        // 每一帧多渲染 20 个，既保持流畅又快速加载完
        renderLimit.value += 20

        requestAnimationFrame(animate)
      }
      requestAnimationFrame(animate)
    }
  },
  { immediate: true }
)

// ========== 组合原点相关逻辑 ==========

// 检查是否完整选中了一个组
const isEntireGroupSelected = computed(() => {
  if (!selectedGroupInfo.value || selectedGroupInfo.value.type !== 'single') return false
  const info = selectedGroupInfo.value
  return info.selectedCount === info.totalCount
})

// 当前选中组的 groupId
const currentGroupId = computed(() => {
  if (!isEntireGroupSelected.value || !selectedGroupInfo.value) return null
  if (selectedGroupInfo.value.type !== 'single') return null
  return selectedGroupInfo.value.groupId
})

// 当前原点物品
const currentOriginItem = computed(() => {
  const scheme = editorStore.activeScheme
  const groupId = currentGroupId.value
  if (!scheme || typeof groupId !== 'number') return null

  const originItemId = scheme.groupOrigins.value.get(groupId)
  if (!originItemId) return null

  return editorStore.itemsMap.get(originItemId) || null
})

// 当前原点物品名称
const currentOriginItemName = computed(() => {
  const item = currentOriginItem.value
  if (!item) return ''

  const furniture = gameDataStore.getFurniture(item.gameId)
  return getFurnitureName(furniture, item.gameId)
})

// 开始选择原点
function startSelectingOrigin() {
  const groupId = currentGroupId.value
  if (groupId === null) return

  uiStore.setSelectingGroupOrigin(true, groupId)
}

// 清除原点
function clearOrigin() {
  const groupId = currentGroupId.value
  if (typeof groupId !== 'number') return

  clearGroupOrigin(groupId)
}

// 监听方案切换，自动清除选择状态
watch(
  () => editorStore.activeSchemeId,
  () => {
    if (uiStore.isSelectingGroupOrigin) {
      uiStore.setSelectingGroupOrigin(false)
    }
  }
)

// 计算组信息文本标签
const groupBadgeText = computed(() => {
  const info = selectedGroupInfo.value
  if (!info) return null

  if (info.type === 'single') {
    return t('sidebar.groupMultiple', { count: 1 })
  } else if (info.type === 'multiple') {
    return t('sidebar.groupMultiple', { count: info.groupCount ?? 0 })
  }
  return null
})

function handleIconError(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <div
    v-if="selectedItemDetails"
    class="flex h-full flex-col items-stretch overflow-hidden p-4 pr-0"
  >
    <!-- 标题栏 -->
    <div class="flex shrink-0 items-center justify-between pr-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold">{{ t('sidebar.selectionList') }}</h2>
        <span class="font-semibold text-blue-500 dark:text-blue-400/90">{{
          editorStore.activeScheme?.selectedItemIds.value.size ?? 0
        }}</span>
      </div>
      <!-- 组信息徽章 -->
      <div v-if="groupBadgeText" class="flex items-center gap-1">
        <span
          :class="[
            'rounded-full px-2 py-0.5 text-xs font-medium',
            selectedGroupInfo?.type === 'single' || selectedGroupInfo?.type === 'multiple'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
              : 'bg-gray-100 text-gray-600 dark:bg-secondary dark:text-muted-foreground',
          ]"
        >
          {{ groupBadgeText }}
        </span>
      </div>
    </div>

    <!-- 物品详情内容 -->
    <div class="mt-2 flex min-h-0 flex-1 flex-col">
      <ScrollArea class="min-h-0 flex-1">
        <!-- 单个物品 -->
        <div v-if="selectedItemDetails.type === 'single'" class="space-y-3">
          <div class="flex flex-col gap-3">
            <!-- 大图标展示区 -->
            <div
              class="flex h-[150px] w-full items-center justify-center rounded-md bg-secondary p-4"
            >
              <img
                v-if="selectedItemDetails.icon"
                :src="selectedItemDetails.icon"
                :alt="selectedItemDetails.name"
                class="h-full w-full object-contain transition-transform hover:scale-105"
                @error="handleIconError"
              />
              <div v-else class="text-sm text-muted-foreground">{{ t('sidebar.noIcon') }}</div>
            </div>

            <!-- 物品信息 -->
            <div class="space-y-2">
              <div class="font-medium text-foreground">
                {{ selectedItemDetails.name }}
              </div>
              <div
                v-if="selectedItemDetails.dimensions"
                class="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <Ruler class="mr-1 h-3 w-3" />
                {{ selectedItemDetails.dimensions }}
              </div>
            </div>
          </div>
        </div>

        <!-- 多个物品 - 聚合统计 -->
        <div v-else-if="selectedItemDetails.type === 'multiple'" class="space-y-2 pr-2">
          <Item
            v-for="item in visibleItems"
            :key="item.itemId"
            variant="muted"
            class="gap-2 bg-muted/50 p-2"
          >
            <ItemMedia v-if="item.icon" variant="image" class="size-8 rounded border border-border">
              <img :src="item.icon" :alt="item.name" @error="handleIconError" />
            </ItemMedia>
            <ItemMedia
              v-else
              class="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-card text-xs text-muted-foreground"
            >
              ?
            </ItemMedia>
            <ItemContent>
              <ItemTitle class="text-sm font-medium text-foreground">{{ item.name }}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span class="text-sm font-semibold text-blue-500 dark:text-blue-400/90"
                >×{{ item.count }}</span
              >
            </ItemActions>
          </Item>
        </div>
        <ScrollBar orientation="vertical" class="!w-1.5" />
      </ScrollArea>
    </div>

    <!-- 组合原点设置（仅当完整选中一个组时显示） -->
    <div v-if="isEntireGroupSelected" class="flex flex-col gap-2 pt-3 pr-2">
      <div class="flex items-center justify-between gap-2">
        <TooltipProvider>
          <Tooltip :delay-duration="300">
            <TooltipTrigger as-child>
              <label class="cursor-help text-xs text-sidebar-foreground hover:text-foreground">
                {{ t('sidebar.groupOrigin') }}
              </label>
            </TooltipTrigger>
            <TooltipContent class="text-xs" variant="light">
              {{ t('sidebar.groupOriginHint') }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div class="flex items-center gap-1.5">
          <!-- 选择物品按钮 -->
          <button
            v-if="!uiStore.isSelectingGroupOrigin"
            @click="startSelectingOrigin"
            class="h-6 rounded-md bg-sidebar-accent px-2 text-[10px] font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {{ t('sidebar.selectItem') }}
          </button>
          <button
            v-else
            @click="uiStore.setSelectingGroupOrigin(false)"
            class="h-6 rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {{ t('sidebar.cancelSelecting') }}
          </button>

          <!-- 清除按钮 -->
          <button
            v-if="currentOriginItem"
            @click="clearOrigin"
            class="flex h-6 w-6 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :title="t('sidebar.clearOrigin')"
          >
            <X :size="12" />
          </button>
        </div>
      </div>

      <!-- 当前原点显示 -->
      <div
        v-if="currentOriginItem"
        class="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5"
      >
        <span class="text-[10px] text-muted-foreground">{{ t('sidebar.current') }}:</span>
        <TooltipProvider>
          <Tooltip :delay-duration="300">
            <TooltipTrigger as-child>
              <span class="flex-1 cursor-help truncate text-xs font-medium text-sidebar-foreground">
                {{ currentOriginItemName }}
              </span>
            </TooltipTrigger>
            <TooltipContent class="text-xs" variant="light">
              {{ currentOriginItemName }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>

    <!-- 成组/取消组合按钮 -->
    <div class="flex gap-2 pt-2 pr-2">
      <Button
        @click="groupSelected()"
        :disabled="
          (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) < 2 ||
          selectedGroupInfo?.type === 'single'
        "
        class="flex-1"
        size="sm"
        title="Ctrl+G"
      >
        {{ t('sidebar.group') }}
      </Button>
      <Button
        @click="ungroupSelected()"
        :disabled="!selectedItems.some((item) => item.groupId > 0)"
        variant="secondary"
        class="flex-1"
        size="sm"
        title="Ctrl+Shift+G"
      >
        {{ t('sidebar.ungroup') }}
      </Button>
    </div>
  </div>
</template>

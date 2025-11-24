<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useFurnitureStore } from '../stores/furnitureStore'
import { useEditorGroups } from '../composables/editor/useEditorGroups'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'

const editorStore = useEditorStore()
const furnitureStore = useFurnitureStore()
const { getGroupItems, groupSelected, ungroupSelected } = useEditorGroups()

// 计算属性:选中物品的组信息
const selectedGroupInfo = computed(() => {
  if (editorStore.selectedItems.length === 0) return null

  const groupIds = new Set(editorStore.selectedItems.map((item) => item.originalData.GroupID))

  // 如果所有选中物品都是无组
  if (groupIds.size === 1 && groupIds.has(0)) {
    return { type: 'none', count: editorStore.selectedItems.length }
  }

  // 如果所有选中物品都属于同一组
  if (groupIds.size === 1) {
    const groupId = Array.from(groupIds)[0]!
    const groupItems = getGroupItems(groupId)
    return {
      type: 'single',
      groupId,
      selectedCount: editorStore.selectedItems.length,
      totalCount: groupItems.length,
    }
  }

  // 如果选中了多个组(或混合)
  const groupCount = Array.from(groupIds).filter((id) => id > 0).length
  return {
    type: 'multiple',
    groupCount,
    selectedCount: editorStore.selectedItems.length,
  }
})

// 计算属性:选中物品详情
const selectedItemDetails = computed(() => {
  const selected = editorStore.selectedItems
  if (selected.length === 0) return null

  // 单个物品
  if (selected.length === 1) {
    const item = selected[0]
    if (!item) return null

    const furniture = furnitureStore.getFurniture(item.gameId)

    return {
      type: 'single' as const,
      name: furniture?.name_cn || `物品 ${item.gameId}`,
      icon: furniture ? furnitureStore.getIconUrl(item.gameId) : null,
      itemId: item.gameId,
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
      const furniture = furnitureStore.getFurniture(item.gameId)
      itemStats.set(item.gameId, {
        itemId: item.gameId,
        name: furniture?.name_cn || `物品 ${item.gameId}`,
        icon: furniture ? furnitureStore.getIconUrl(item.gameId) : null,
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

// 计算组信息文本标签
const groupBadgeText = computed(() => {
  if (!selectedGroupInfo.value) return null

  if (selectedGroupInfo.value.type === 'single') {
    return `组 #${selectedGroupInfo.value.groupId}`
  } else if (selectedGroupInfo.value.type === 'multiple') {
    return `${selectedGroupInfo.value.groupCount} 个组`
  }
  return null
})

function handleIconError(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <Item v-if="selectedItemDetails" variant="outline" class="flex-col items-stretch">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-gray-700">选中列表</h2>
        <span class="font-semibold text-blue-600">{{ editorStore.stats.selectedItems }}</span>
      </div>
      <!-- 组信息徽章 -->
      <div v-if="groupBadgeText" class="flex items-center gap-1">
        <span
          :class="[
            'rounded-full px-2 py-0.5 text-xs font-medium',
            selectedGroupInfo?.type === 'single'
              ? 'bg-purple-100 text-purple-700'
              : selectedGroupInfo?.type === 'multiple'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-100 text-gray-600',
          ]"
        >
          {{ groupBadgeText }}
        </span>
      </div>
    </div>

    <!-- 物品详情内容 -->
    <div class="space-y-2">
      <ScrollArea class="max-h-64">
        <!-- 单个物品 -->
        <div v-if="selectedItemDetails.type === 'single'" class="space-y-3 pr-3">
          <Item class="gap-3 border-none p-0 hover:bg-transparent">
            <ItemMedia
              v-if="selectedItemDetails.icon"
              variant="image"
              class="size-12 rounded border border-gray-200"
            >
              <img
                :src="selectedItemDetails.icon"
                :alt="selectedItemDetails.name"
                @error="handleIconError"
              />
            </ItemMedia>
            <ItemMedia
              v-else
              class="flex size-12 items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs text-gray-400"
            >
              无图标
            </ItemMedia>
            <ItemContent>
              <ItemTitle class="font-medium text-gray-800">{{
                selectedItemDetails.name
              }}</ItemTitle>
              <ItemDescription>ID: {{ selectedItemDetails.itemId }}</ItemDescription>
            </ItemContent>
          </Item>
        </div>

        <!-- 多个物品 - 聚合统计 -->
        <div v-else-if="selectedItemDetails.type === 'multiple'" class="space-y-2 pr-3">
          <Item
            v-for="item in selectedItemDetails.items"
            :key="item.itemId"
            variant="muted"
            class="gap-2 bg-gray-50 p-2"
          >
            <ItemMedia
              v-if="item.icon"
              variant="image"
              class="size-8 rounded border border-gray-200"
            >
              <img :src="item.icon" :alt="item.name" @error="handleIconError" />
            </ItemMedia>
            <ItemMedia
              v-else
              class="flex size-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-xs text-gray-400"
            >
              ?
            </ItemMedia>
            <ItemContent>
              <ItemTitle class="text-sm font-medium text-gray-800">{{ item.name }}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span class="text-sm font-semibold text-blue-600">×{{ item.count }}</span>
            </ItemActions>
          </Item>
        </div>
        <ScrollBar orientation="vertical" class="!w-1.5" />
      </ScrollArea>
    </div>

    <!-- 成组/取消组合按钮 -->
    <div class="flex gap-2">
      <Button
        @click="groupSelected()"
        :disabled="editorStore.selectedItemIds.size < 2 || selectedGroupInfo?.type === 'single'"
        class="flex-1"
        size="sm"
        title="Ctrl+G"
      >
        成组
      </Button>
      <Button
        @click="ungroupSelected()"
        :disabled="!editorStore.selectedItems.some((item) => item.originalData.GroupID > 0)"
        variant="secondary"
        class="flex-1"
        size="sm"
        title="Ctrl+Shift+G"
      >
        取消组合
      </Button>
    </div>
  </Item>
</template>

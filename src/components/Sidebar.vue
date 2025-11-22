<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useFurnitureStore } from '../stores/furnitureStore'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

const editorStore = useEditorStore()
const furnitureStore = useFurnitureStore()

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
    const groupItems = editorStore.getGroupItems(groupId)
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
  <div class="flex h-full w-64 flex-col">
    <!-- 可滚动内容区域 -->
    <ScrollArea class="flex-1">
      <div class="flex flex-col gap-4 p-3">
        <!-- 选中物品卡片 -->
        <div v-if="selectedItemDetails" class="rounded-lg bg-white shadow-sm">
          <!-- 标题栏 -->
          <div class="border-b border-gray-100 px-4 py-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <h2 class="text-sm font-semibold text-gray-700">已选中</h2>
                <span class="font-semibold text-blue-600">{{
                  editorStore.stats.selectedItems
                }}</span>
                <span class="text-sm text-gray-500">个物品</span>
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
          </div>

          <!-- 物品详情内容 -->
          <div class="px-4 py-3">
            <ScrollArea class="max-h-64">
              <!-- 单个物品 -->
              <div v-if="selectedItemDetails.type === 'single'" class="space-y-3 pr-3">
                <div class="flex items-center gap-3">
                  <img
                    v-if="selectedItemDetails.icon"
                    :src="selectedItemDetails.icon"
                    class="h-12 w-12 rounded border border-gray-200"
                    :alt="selectedItemDetails.name"
                    @error="handleIconError"
                  />
                  <div
                    v-else
                    class="flex h-12 w-12 items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs text-gray-400"
                  >
                    无图标
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium text-gray-800">
                      {{ selectedItemDetails.name }}
                    </div>
                  </div>
                </div>

                <div class="space-y-1 border-t pt-2 text-xs text-gray-600">
                  <div class="flex justify-between">
                    <span>坐标 X:</span>
                    <span class="font-mono">{{ selectedItemDetails.x.toFixed(2) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span>坐标 Y:</span>
                    <span class="font-mono">{{ selectedItemDetails.y.toFixed(2) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span>高度 Z:</span>
                    <span class="font-mono">{{ selectedItemDetails.z.toFixed(2) }}</span>
                  </div>
                </div>
              </div>

              <!-- 多个物品 - 聚合统计 -->
              <div v-else-if="selectedItemDetails.type === 'multiple'" class="space-y-2 pr-3">
                <div
                  v-for="item in selectedItemDetails.items"
                  :key="item.itemId"
                  class="flex items-center gap-2 rounded-md bg-gray-50 p-2"
                >
                  <img
                    v-if="item.icon"
                    :src="item.icon"
                    class="h-8 w-8 rounded border border-gray-200"
                    :alt="item.name"
                    @error="handleIconError"
                  />
                  <div
                    v-else
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-xs text-gray-400"
                  >
                    ?
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-gray-800">{{ item.name }}</div>
                  </div>
                  <div class="shrink-0 text-sm font-semibold text-blue-600">×{{ item.count }}</div>
                </div>
              </div>
              <ScrollBar orientation="vertical" class="!w-1.5" />
            </ScrollArea>
          </div>

          <!-- 快捷操作栏 -->
          <div class="border-t border-gray-100 px-4 py-3">
            <div class="flex gap-2">
              <button
                @click="editorStore.groupSelected()"
                :disabled="
                  editorStore.selectedItemIds.size < 2 || selectedGroupInfo?.type === 'single'
                "
                :class="[
                  'flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors',
                  editorStore.selectedItemIds.size >= 2 && selectedGroupInfo?.type !== 'single'
                    ? 'bg-purple-600 text-white hover:bg-purple-700 active:bg-purple-800'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400',
                ]"
                title="Ctrl+G"
              >
                成组
              </button>
              <button
                @click="editorStore.ungroupSelected()"
                :disabled="!editorStore.selectedItems.some((item) => item.originalData.GroupID > 0)"
                :class="[
                  'flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors',
                  editorStore.selectedItems.some((item) => item.originalData.GroupID > 0)
                    ? 'bg-gray-600 text-white hover:bg-gray-700 active:bg-gray-800'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400',
                ]"
                title="Ctrl+Shift+G"
              >
                取消组合
              </button>
            </div>
          </div>
        </div>

        <!-- 提示信息 -->
        <div v-if="editorStore.items.length === 0" class="text-center text-xs text-gray-500">
          请导入建造数据文件开始编辑
        </div>
      </div>
      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>

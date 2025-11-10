<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useFurnitureStore } from '../stores/furnitureStore'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

const editorStore = useEditorStore()
const furnitureStore = useFurnitureStore()

// 计算属性：格式化Z轴范围显示
const formattedZRange = computed(() => {
  const { min, max } = editorStore.heightFilter
  return {
    min: min.toFixed(2),
    max: max.toFixed(2),
  }
})

// 计算属性：选中物品的组信息
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

  // 如果选中了多个组（或混合）
  const groupCount = Array.from(groupIds).filter((id) => id > 0).length
  return {
    type: 'multiple',
    groupCount,
    selectedCount: editorStore.selectedItems.length,
  }
})

// 计算属性：选中物品详情
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

// 更新高度过滤器
function updateMinFilter(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value)
  editorStore.updateHeightFilter(value, editorStore.heightFilter.currentMax)
}

function updateMaxFilter(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value)
  editorStore.updateHeightFilter(editorStore.heightFilter.currentMin, value)
}

function handleIconError(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <ScrollArea class="h-full w-64">
    <div class="flex flex-col gap-6 p-2">
      <!-- 统计信息 -->
      <div class="rounded-lg bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-sm font-semibold text-gray-700">统计信息</h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-600">总物品数：</span>
            <span class="font-medium">{{ editorStore.stats.totalItems }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">可见物品：</span>
            <span class="font-medium text-blue-600">{{ editorStore.stats.visibleItems }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">已选中：</span>
            <span
              class="font-medium"
              :class="editorStore.stats.selectedItems > 0 ? 'text-blue-600' : 'text-gray-400'"
            >
              {{ editorStore.stats.selectedItems }}
            </span>
          </div>
          <div class="flex justify-between border-t border-gray-100 pt-2">
            <span class="text-gray-600">组数量：</span>
            <span class="font-medium text-purple-600">{{
              editorStore.stats.groups.totalGroups
            }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">成组物品：</span>
            <span class="font-medium text-purple-600">{{
              editorStore.stats.groups.groupedItems
            }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">独立物品：</span>
            <span class="font-medium text-gray-500">{{
              editorStore.stats.groups.ungroupedItems
            }}</span>
          </div>
        </div>
      </div>

      <!-- 选中物品组信息 -->
      <div v-if="selectedGroupInfo" class="rounded-lg bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-sm font-semibold text-gray-700">选中物品</h2>
        <div class="space-y-2 text-sm">
          <!-- 单一组 -->
          <template v-if="selectedGroupInfo.type === 'single'">
            <div class="rounded-md bg-purple-50 p-3">
              <div class="flex items-center justify-between">
                <span class="font-medium text-purple-700">组 #{{ selectedGroupInfo.groupId }}</span>
                <span class="text-xs text-purple-600">
                  {{ selectedGroupInfo.selectedCount }} / {{ selectedGroupInfo.totalCount }} 个物品
                </span>
              </div>
            </div>
          </template>

          <!-- 多个组 -->
          <template v-else-if="selectedGroupInfo.type === 'multiple'">
            <div class="rounded-md bg-orange-50 p-3">
              <div class="text-sm text-orange-700">
                已选中 {{ selectedGroupInfo.groupCount }} 个组的物品
              </div>
            </div>
          </template>

          <!-- 无组 -->
          <template v-else-if="selectedGroupInfo.type === 'none'">
            <div class="rounded-md bg-gray-50 p-3">
              <div class="text-sm text-gray-600">
                {{ selectedGroupInfo.count }} 个独立物品（未成组）
              </div>
            </div>
          </template>

          <!-- 成组/取消组合按钮 -->
          <div class="mt-3 flex gap-2">
            <button
              @click="editorStore.groupSelected()"
              :disabled="
                editorStore.selectedItemIds.size < 2 || selectedGroupInfo.type === 'single'
              "
              :class="[
                'flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors',
                editorStore.selectedItemIds.size >= 2 && selectedGroupInfo.type !== 'single'
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
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
                  ? 'bg-gray-600 text-white hover:bg-gray-700'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400',
              ]"
              title="Ctrl+Shift+G"
            >
              取消组合
            </button>
          </div>
        </div>
      </div>

      <!-- 新增：选中物品详情 -->
      <div v-if="selectedItemDetails" class="rounded-lg bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-sm font-semibold text-gray-700">物品详情</h2>
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
          <div v-else-if="selectedItemDetails.type === 'multiple'" class="space-y-3 pr-3">
            <div class="border-b pb-2 text-sm text-gray-600">
              已选中
              <span class="font-semibold text-blue-600">{{ selectedItemDetails.totalCount }}</span>
              个物品
            </div>

            <!-- 物品类型统计列表 -->
            <div class="space-y-2">
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
          </div>
          <ScrollBar orientation="vertical" class="!w-1.5" />
        </ScrollArea>
      </div>

      <!-- 高度过滤器 -->
      <div class="rounded-lg bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-sm font-semibold text-gray-700">高度过滤 (Z轴)</h2>

        <!-- Z轴范围显示 -->
        <div class="mb-4 text-xs text-gray-500">
          范围: {{ formattedZRange.min }} ~ {{ formattedZRange.max }}
        </div>

        <!-- 最小值滑块 -->
        <div class="mb-4">
          <label class="mb-1 block text-xs text-gray-600">
            最小值: {{ editorStore.heightFilter.currentMin.toFixed(2) }}
          </label>
          <input
            type="range"
            :min="editorStore.heightFilter.min"
            :max="editorStore.heightFilter.max"
            :value="editorStore.heightFilter.currentMin"
            :step="(editorStore.heightFilter.max - editorStore.heightFilter.min) / 100"
            @input="updateMinFilter"
            class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
          />
        </div>

        <!-- 最大值滑块 -->
        <div>
          <label class="mb-1 block text-xs text-gray-600">
            最大值: {{ editorStore.heightFilter.currentMax.toFixed(2) }}
          </label>
          <input
            type="range"
            :min="editorStore.heightFilter.min"
            :max="editorStore.heightFilter.max"
            :value="editorStore.heightFilter.currentMax"
            :step="(editorStore.heightFilter.max - editorStore.heightFilter.min) / 100"
            @input="updateMaxFilter"
            class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
          />
        </div>
      </div>

      <!-- 提示信息 -->
      <div v-if="editorStore.items.length === 0" class="mt-4 text-center text-xs text-gray-500">
        请导入建造数据文件开始编辑
      </div>
    </div>
    <ScrollBar orientation="vertical" class="!w-1.5" />
  </ScrollArea>
</template>

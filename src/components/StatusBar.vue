<script setup lang="ts">
import { computed } from 'vue'
import { useDateFormat } from '@vueuse/core'
import { useEditorStore } from '../stores/editorStore'
import { useUIStore } from '../stores/uiStore'
import { useCommandStore } from '../stores/commandStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy } from 'lucide-vue-next'

const editorStore = useEditorStore()
const uiStore = useUIStore()
const commandStore = useCommandStore()
const settingsStore = useSettingsStore()

// 方案信息
const fileName = computed(() => {
  return editorStore.activeScheme?.filePath?.replace(/\\/g, '/') || '未命名'
})

const currentIndex = computed(() => {
  const activeId = editorStore.activeSchemeId
  return editorStore.schemes.findIndex((s) => s.id === activeId) + 1
})

const schemeCount = computed(() => editorStore.schemes.length)

// 修改时间
const lastModified = computed(() => {
  // 优先使用 scheme 的 lastModified，其次使用 watchState
  return editorStore.activeScheme?.lastModified || commandStore.fileOps.watchState.lastModifiedTime
})

const shortTime = computed(() => {
  if (!lastModified.value) return ''
  return useDateFormat(lastModified.value, 'MM-DD HH:mm').value
})

const fullTimeTooltip = computed(() => {
  if (!lastModified.value) return ''
  return `最后修改: ${useDateFormat(lastModified.value, 'YYYY-MM-DD HH:mm:ss').value}`
})

// 统计信息
const stats = computed(() => ({
  total: editorStore.stats.totalItems,
  selected: editorStore.stats.selectedItems,
}))

// 组信息
const groupStats = computed(() => ({
  count: editorStore.stats.groups.totalGroups,
  grouped: editorStore.stats.groups.groupedItems,
  ungrouped: editorStore.stats.groups.ungroupedItems,
}))

// 工作坐标系
const coordinateSystem = computed(() => ({
  enabled: uiStore.workingCoordinateSystem.enabled,
  angle: uiStore.workingCoordinateSystem.rotationAngle,
}))

const coordinateTooltip = computed(() => {
  const state = coordinateSystem.value.enabled ? '已启用' : '未启用'
  return `工作坐标系: ${coordinateSystem.value.angle}° (${state}) - 点击调整`
})

const handleCoordinateClick = () => {
  commandStore.executeCommand('view.coordinateSystem')
}

// 重复物品检测
const duplicateDetectionEnabled = computed(() => settingsStore.settings.enableDuplicateDetection)
const hasDuplicate = computed(() => editorStore.hasDuplicate)
const duplicateItemCount = computed(() => editorStore.duplicateItemCount)

const duplicateTooltip = computed(() => {
  if (!duplicateDetectionEnabled.value) return ''
  if (!hasDuplicate.value) return ''
  return `发现 ${duplicateItemCount.value} 个重复物品 - 点击选中`
})

const handleDuplicateClick = () => {
  if (hasDuplicate.value) {
    editorStore.selectDuplicateItems()
  }
}
</script>

<template>
  <div class="h-6">
    <div
      class="flex h-full items-center justify-between gap-4 px-3 pb-2 text-sm"
      v-if="schemeCount > 0"
    >
      <!-- 左: 方案信息 -->
      <div class="flex min-w-0 items-center gap-2 text-gray-600">
        <span v-if="schemeCount > 1" class="shrink-0 text-xs text-gray-400">
          [{{ currentIndex }}/{{ schemeCount }}]
        </span>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="shrink-0 truncate text-xs text-gray-800">{{ fileName }}</span>
          </TooltipTrigger>
          <TooltipContent>
            {{ fileName }}
          </TooltipContent>
        </Tooltip>
        <Tooltip v-if="shortTime">
          <TooltipTrigger as-child>
            <span class="shrink-0 text-xs text-gray-400"> • {{ shortTime }} </span>
          </TooltipTrigger>
          <TooltipContent>
            {{ fullTimeTooltip }}
          </TooltipContent>
        </Tooltip>
      </div>

      <!-- 右: 统计信息、组信息、工作坐标系 -->
      <div class="flex shrink-0 items-center gap-4">
        <!-- 重复物品检测 -->
        <Tooltip v-if="duplicateDetectionEnabled && hasDuplicate">
          <TooltipTrigger as-child>
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-amber-600 transition-colors hover:bg-amber-50"
              @click="handleDuplicateClick"
            >
              <Copy :size="14" />
              <span class="text-xs">{{ duplicateItemCount }} 个重复物品</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{ duplicateTooltip }}
          </TooltipContent>
        </Tooltip>

        <!-- 统计信息 -->
        <div class="flex shrink-0 items-center gap-3 text-gray-600">
          <span class="text-xs">总计 {{ stats.total }}</span>
          <span class="text-gray-300">|</span>
          <span
            class="text-xs"
            :class="stats.selected > 0 ? 'font-semibold text-blue-600' : 'text-gray-400'"
          >
            已选 {{ stats.selected }}
          </span>
        </div>

        <!-- 组信息 -->
        <div class="flex shrink-0 items-center gap-1 text-purple-600">
          <span class="text-xs">组 {{ groupStats.count }}</span>
          <span class="text-xs text-gray-500"
            >({{ groupStats.grouped }}/{{ groupStats.ungrouped }})</span
          >
        </div>

        <!-- 工作坐标系 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-gray-100"
              :class="coordinateSystem.enabled ? 'font-medium text-orange-600' : 'text-gray-400'"
              @click="handleCoordinateClick"
            >
              <span>⟲</span>
              <span class="text-xs">{{ coordinateSystem.angle }}°</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{ coordinateTooltip }}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

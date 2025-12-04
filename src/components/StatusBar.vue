<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { useDateFormat } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useValidationStore } from '../stores/validationStore'
import { useUIStore } from '../stores/uiStore'
import { useCommandStore } from '../stores/commandStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '@/composables/useI18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy, AlertTriangle, Layers, EyeOff } from 'lucide-vue-next'
import { MAX_RENDER_INSTANCES } from '@/types/constants'

const editorStore = useEditorStore()
const validationStore = useValidationStore()
const { hasDuplicate, duplicateItemCount, limitIssues } = storeToRefs(validationStore)

const { selectDuplicateItems, selectOutOfBoundsItems, selectOversizedGroupItems } = validationStore
const uiStore = useUIStore()
const commandStore = useCommandStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// 方案信息
const fileName = computed(() => {
  return editorStore.activeScheme?.filePath.value?.replace(/\\/g, '/') || t('status.unnamed')
})

const currentIndex = computed(() => {
  const activeId = editorStore.activeSchemeId
  return editorStore.schemes.findIndex((s) => s.id === activeId) + 1
})

const schemeCount = computed(() => editorStore.schemes.length)

// 修改时间
const lastModified = computed(() => {
  // 优先使用 scheme 的 lastModified，其次使用 watchState
  return (
    editorStore.activeScheme?.lastModified.value || commandStore.fileOps.watchState.lastModifiedTime
  )
})

const shortTime = computed(() => {
  if (!lastModified.value) return ''
  return useDateFormat(lastModified.value, 'MM-DD HH:mm').value
})

const fullTimeTooltip = computed(() => {
  if (!lastModified.value) return ''
  return t('status.lastModified').replace(
    '{time}',
    useDateFormat(lastModified.value, 'YYYY-MM-DD HH:mm:ss').value
  )
})

// 统计信息
const stats = computed(() => {
  const scheme = editorStore.activeScheme
  return {
    total: scheme?.items.value.length ?? 0,
    selected: scheme?.selectedItemIds.value.size ?? 0,
    groupsCount: editorStore.groupsMap.size ?? 0,
  }
})

const isRenderLimitExceeded = computed(() => stats.value.total > MAX_RENDER_INSTANCES)

// 工作坐标系
const coordinateSystem = computed(() => ({
  enabled: uiStore.workingCoordinateSystem.enabled,
  angle: uiStore.workingCoordinateSystem.rotationAngle,
}))

const coordinateTooltip = computed(() => {
  const state = coordinateSystem.value.enabled
    ? t('status.coordinate.enabled')
    : t('status.coordinate.disabled')
  return t('status.coordinate.tooltip')
    .replace('{angle}', String(coordinateSystem.value.angle))
    .replace('{state}', state)
})

const handleCoordinateClick = () => {
  commandStore.executeCommand('view.coordinateSystem')
}

const handleFileNameClick = () => {
  commandStore.showSchemeSettingsDialog = true
}

// 重复物品检测
const duplicateDetectionEnabled = computed(() => settingsStore.settings.enableDuplicateDetection)

const duplicateTooltip = computed(() => {
  if (!duplicateDetectionEnabled.value) return ''
  if (!hasDuplicate.value) return ''
  return t('status.duplicate.found').replace('{count}', String(duplicateItemCount.value))
})

const handleDuplicateClick = () => {
  if (hasDuplicate.value) {
    selectDuplicateItems()
  }
}

const isDialogClosing = ref(false)

// 监听对话框关闭事件，在焦点还原后立即移除焦点
// 这解决了 Dialog 关闭后 Tooltip 仍保持打开（因为触发器获得了焦点）的问题
watch(
  [() => commandStore.showCoordinateDialog, () => commandStore.showSchemeSettingsDialog],
  ([newCoord, newScheme], [oldCoord, oldScheme]) => {
    // 任何一个对话框打开时
    if (newCoord || newScheme) {
      isDialogClosing.value = true
    }

    // 当任一对话框从打开变为关闭时
    if ((oldCoord && !newCoord) || (oldScheme && !newScheme)) {
      isDialogClosing.value = true
      // 使用 setTimeout 确保在 Radix UI 还原焦点之后执行
      setTimeout(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }

        isDialogClosing.value = false
      }, 500)
    }
  }
)
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
            <span
              tabindex="0"
              class="shrink-0 cursor-pointer truncate rounded px-1.5 py-0.5 text-xs text-gray-800 transition-colors hover:bg-gray-200"
              @click="handleFileNameClick"
            >
              {{ fileName }}
            </span>
          </TooltipTrigger>
          <TooltipContent v-if="!isDialogClosing">
            {{ t('status.rename').replace('{name}', fileName) }}
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
        <!-- 限制警告：坐标超限 -->
        <Tooltip v-if="limitIssues.outOfBoundsItemIds.length > 0">
          <TooltipTrigger as-child>
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-red-600 transition-colors hover:bg-red-50"
              @click="selectOutOfBoundsItems()"
            >
              <AlertTriangle :size="14" />
              <span class="text-xs">{{
                t('status.limit.outOfBounds').replace(
                  '{count}',
                  String(limitIssues.outOfBoundsItemIds.length)
                )
              }}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{
              t('status.limit.outOfBoundsTip').replace(
                '{count}',
                String(limitIssues.outOfBoundsItemIds.length)
              )
            }}
          </TooltipContent>
        </Tooltip>

        <!-- 限制警告：组超限 -->
        <Tooltip v-if="limitIssues.oversizedGroups.length > 0">
          <TooltipTrigger as-child>
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-orange-600 transition-colors hover:bg-orange-50"
              @click="selectOversizedGroupItems()"
            >
              <Layers :size="14" />
              <span class="text-xs">{{
                t('status.limit.oversized').replace(
                  '{count}',
                  String(limitIssues.oversizedGroups.length)
                )
              }}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{
              t('status.limit.oversizedTip').replace(
                '{count}',
                String(limitIssues.oversizedGroups.length)
              )
            }}
          </TooltipContent>
        </Tooltip>

        <!-- 重复物品检测 -->
        <Tooltip v-if="duplicateDetectionEnabled && hasDuplicate">
          <TooltipTrigger as-child>
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-amber-600 transition-colors hover:bg-amber-50"
              @click="handleDuplicateClick"
            >
              <Copy :size="14" />
              <span class="text-xs">{{
                t('status.duplicate.label').replace('{count}', String(duplicateItemCount))
              }}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{ duplicateTooltip }}
          </TooltipContent>
        </Tooltip>

        <!-- 渲染限制警告 -->
        <Tooltip v-if="isRenderLimitExceeded">
          <TooltipTrigger as-child>
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <EyeOff :size="14" />
              <span class="text-xs">{{ t('status.render.limited') }}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{
              t('status.render.limitedTip')
                .replace('{total}', String(stats.total))
                .replace('{max}', String(MAX_RENDER_INSTANCES))
            }}
          </TooltipContent>
        </Tooltip>

        <!-- 统计信息 -->
        <div class="flex shrink-0 items-center gap-3 text-gray-600">
          <span class="text-xs">{{
            t('status.stats.total').replace('{count}', String(stats.total))
          }}</span>
          <span class="text-gray-300">|</span>
          <span
            class="text-xs"
            :class="stats.selected > 0 ? 'font-semibold text-blue-500' : 'text-gray-400'"
          >
            {{ t('status.stats.selected').replace('{count}', String(stats.selected)) }}
          </span>
        </div>

        <!-- 组信息 -->
        <div class="flex shrink-0 items-center gap-1 text-purple-600">
          <span class="text-xs">{{
            t('status.stats.groups').replace('{count}', String(stats.groupsCount))
          }}</span>
        </div>

        <!-- 工作坐标系 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <div
              tabindex="0"
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-gray-100"
              :class="coordinateSystem.enabled ? 'font-medium text-orange-600' : 'text-gray-400'"
              @click="handleCoordinateClick"
            >
              <span>⟲</span>
              <span class="text-xs">{{ coordinateSystem.angle }}°</span>
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="!isDialogClosing">
            {{ coordinateTooltip }}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

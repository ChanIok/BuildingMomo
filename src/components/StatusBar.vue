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
import SchemeSettingsDialog from './SchemeSettingsDialog.vue'

const editorStore = useEditorStore()
const validationStore = useValidationStore()
const { hasDuplicate, duplicateItemCount, limitIssues } = storeToRefs(validationStore)

const { selectDuplicateItems, selectOutOfBoundsItems, selectOversizedGroupItems } = validationStore
const uiStore = useUIStore()
const commandStore = useCommandStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// 方案设置对话框状态
const schemeSettingsOpen = ref(false)
const schemeSettingsId = ref('')

// Tooltip 控制（避免与对话框焦点恢复导致的 Tooltip 悬挂问题）
const isFileNameTooltipAllowed = ref(true)
const isCoordinateTooltipAllowed = ref(true)

// 方案设置对话框打开时，禁用文件名 Tooltip 内容
watch(schemeSettingsOpen, (open) => {
  if (open) {
    isFileNameTooltipAllowed.value = false
  }
})

// 工作坐标系对话框打开时，禁用坐标 Tooltip 内容
watch(
  () => commandStore.showCoordinateDialog,
  (open) => {
    if (open) {
      isCoordinateTooltipAllowed.value = false
    }
  }
)

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
  if (editorStore.activeSchemeId) {
    schemeSettingsId.value = editorStore.activeSchemeId
    schemeSettingsOpen.value = true
  }
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
</script>

<template>
  <div class="h-6 bg-statusbar text-statusbar-foreground">
    <div
      class="flex h-full items-center justify-between gap-4 px-3 pb-2 text-sm"
      v-if="schemeCount > 0"
    >
      <!-- 左: 方案信息 -->
      <div class="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span v-if="schemeCount > 1" class="shrink-0 text-xs text-muted-foreground">
          [{{ currentIndex }}/{{ schemeCount }}]
        </span>
        <Tooltip>
          <TooltipTrigger as-child @mouseenter="isFileNameTooltipAllowed = true">
            <span
              class="shrink-0 cursor-pointer truncate rounded px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
              @click="handleFileNameClick"
            >
              {{ fileName }}
            </span>
          </TooltipTrigger>
          <TooltipContent v-if="isFileNameTooltipAllowed">
            {{ t('status.rename').replace('{name}', fileName) }}
          </TooltipContent>
        </Tooltip>
        <Tooltip v-if="shortTime">
          <TooltipTrigger as-child>
            <span class="shrink-0 text-xs text-muted-foreground"> • {{ shortTime }} </span>
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
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-500/90"
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
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-orange-600 transition-colors hover:bg-orange-500/10 dark:text-orange-500/90"
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
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-500/90"
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
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/10"
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
        <div class="flex shrink-0 items-center gap-3 text-muted-foreground">
          <span class="text-xs">{{
            t('status.stats.total').replace('{count}', String(stats.total))
          }}</span>
          <span class="text-border">|</span>
          <span
            class="text-xs"
            :class="
              stats.selected > 0 ? 'text-blue-500 dark:text-blue-400/90' : 'text-muted-foreground'
            "
          >
            {{ t('status.stats.selected').replace('{count}', String(stats.selected)) }}
          </span>
        </div>

        <!-- 组信息 -->
        <div class="flex shrink-0 items-center gap-1 text-purple-600 dark:text-purple-400">
          <span class="text-xs">{{
            t('status.stats.groups').replace('{count}', String(stats.groupsCount))
          }}</span>
        </div>

        <!-- 工作坐标系 -->
        <Tooltip>
          <TooltipTrigger as-child @mouseenter="isCoordinateTooltipAllowed = true">
            <div
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-accent"
              :class="
                coordinateSystem.enabled
                  ? 'font-medium text-orange-600 dark:text-orange-400/90'
                  : 'text-muted-foreground'
              "
              @click="handleCoordinateClick"
            >
              <span>⟲</span>
              <span class="text-xs">{{ coordinateSystem.angle }}°</span>
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="isCoordinateTooltipAllowed">
            {{ coordinateTooltip }}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- 方案设置对话框 -->
    <SchemeSettingsDialog
      v-if="schemeSettingsOpen"
      v-model:open="schemeSettingsOpen"
      :scheme-id="schemeSettingsId"
    />
  </div>
</template>

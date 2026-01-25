<script setup lang="ts">
import { useUIStore } from '../../stores/uiStore'
import { useEditorManipulation } from '../../composables/editor/useEditorManipulation'
import { useI18n } from '../../composables/useI18n'
import type { SelectionInfo } from '../../composables/transform/useTransformSelection'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Toggle } from '@/components/ui/toggle'
import {
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignVerticalSpaceBetween,
  X,
} from 'lucide-vue-next'

interface Props {
  selectionInfo: SelectionInfo
  alignReferenceItemName: string
}

defineProps<Props>()

const uiStore = useUIStore()
const { t } = useI18n()
const { alignSelectedItems, distributeSelectedItems } = useEditorManipulation()

// 开始选择参照物
function startSelectingAlignReference() {
  uiStore.setSelectingAlignReference(true)
}

// 清除参照物
function clearAlignReference() {
  uiStore.setAlignReferenceItem(null)
}
</script>

<template>
  <div class="flex flex-col items-stretch gap-2">
    <div class="flex flex-wrap items-center justify-between gap-y-2">
      <div class="flex items-center gap-1">
        <label class="text-xs font-semibold text-sidebar-foreground">{{
          t('transform.alignAndDistribute')
        }}</label>
        <TooltipProvider v-if="uiStore.workingCoordinateSystem.enabled">
          <Tooltip :delay-duration="300">
            <TooltipTrigger as-child>
              <span class="cursor-help text-[10px] text-primary">{{
                t('transform.workingCoord')
              }}</span>
            </TooltipTrigger>
            <TooltipContent class="text-xs" variant="light">
              <div
                v-html="
                  t('transform.workingCoordTip', {
                    angle: `${uiStore.workingCoordinateSystem.rotation.x}°, ${uiStore.workingCoordinateSystem.rotation.y}°, ${uiStore.workingCoordinateSystem.rotation.z}°`,
                  })
                "
              ></div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>

    <!-- 参照物 -->
    <div class="flex items-center justify-between gap-2">
      <TooltipProvider>
        <Tooltip :delay-duration="300">
          <TooltipTrigger as-child>
            <label class="cursor-help text-xs text-sidebar-foreground hover:text-foreground">
              {{ t('transform.referenceObject') }}
            </label>
          </TooltipTrigger>
          <TooltipContent class="text-xs" variant="light">
            {{ t('transform.alignToReferenceHint') }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div class="flex items-center gap-1.5">
        <!-- 选择按钮 -->
        <button
          v-if="!uiStore.isSelectingAlignReference"
          @click="startSelectingAlignReference"
          class="h-[18.5px] rounded-md bg-sidebar-accent px-2 text-[10px] font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {{ t('transform.select') }}
        </button>
        <button
          v-else
          @click="uiStore.setSelectingAlignReference(false)"
          class="h-[18.5px] rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {{ t('sidebar.cancelSelecting') }}
        </button>
        <!-- 清除按钮 -->
        <button
          v-if="uiStore.alignReferenceItemId"
          @click="clearAlignReference"
          class="flex h-[18.5px] w-[18.5px] items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          :title="t('transform.clearReference')"
        >
          <X :size="12" />
        </button>
      </div>
    </div>

    <!-- 当前参照物显示 -->
    <div
      v-if="uiStore.alignReferenceItemId"
      class="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5"
    >
      <span class="text-[10px] text-muted-foreground">{{ t('sidebar.current') }}:</span>
      <TooltipProvider>
        <Tooltip :delay-duration="300">
          <TooltipTrigger as-child>
            <span class="flex-1 cursor-help truncate text-xs font-medium text-sidebar-foreground">
              {{ alignReferenceItemName }}
            </span>
          </TooltipTrigger>
          <TooltipContent class="text-xs" variant="light">
            {{ alignReferenceItemName }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- 目标位置 toggle -->
    <div v-if="uiStore.alignReferenceItemId" class="flex items-center gap-2">
      <label class="text-xs text-sidebar-foreground">{{ t('transform.targetPosition') }}</label>
      <div class="flex flex-1 items-center gap-1">
        <Toggle
          size="sm"
          :model-value="uiStore.alignReferencePosition === 'min'"
          @update:model-value="
            (v) => {
              if (v) uiStore.setAlignReferencePosition('min')
            }
          "
          class="h-7.5 flex-1"
        >
          <span class="text-xs">{{ t('transform.targetMin') }}</span>
        </Toggle>
        <Toggle
          size="sm"
          :model-value="uiStore.alignReferencePosition === 'center'"
          @update:model-value="
            (v) => {
              if (v) uiStore.setAlignReferencePosition('center')
            }
          "
          class="h-7.5 flex-1"
        >
          <span class="text-xs">{{ t('transform.targetCenter') }}</span>
        </Toggle>
        <Toggle
          size="sm"
          :model-value="uiStore.alignReferencePosition === 'max'"
          @update:model-value="
            (v) => {
              if (v) uiStore.setAlignReferencePosition('max')
            }
          "
          class="h-7.5 flex-1"
        >
          <span class="text-xs">{{ t('transform.targetMax') }}</span>
        </Toggle>
      </div>
    </div>

    <!-- 对齐按钮 -->
    <div class="flex flex-col gap-2">
      <!-- X轴 -->
      <div class="flex items-center gap-2">
        <span class="w-4 text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
          >X</span
        >
        <div class="flex flex-1 gap-1.5">
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('x', 'min')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignStartVertical :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignMinHintReference')
                    : t('transform.alignMinHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('x', 'center')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignCenterVertical :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignCenterHintReference')
                    : t('transform.alignCenterHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('x', 'max')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignEndVertical :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignMaxHintReference')
                    : t('transform.alignMaxHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="distributeSelectedItems('x')"
                  :disabled="selectionInfo.count < 3"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignHorizontalSpaceBetween :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{ t('transform.distributeHint') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <!-- Y轴 -->
      <div class="flex items-center gap-2">
        <span class="w-4 text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
          >Y</span
        >
        <div class="flex flex-1 gap-1.5">
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('y', 'min')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignStartHorizontal :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignMinHintReference')
                    : t('transform.alignMinHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('y', 'center')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignCenterHorizontal :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignCenterHintReference')
                    : t('transform.alignCenterHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('y', 'max')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignEndHorizontal :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignMaxHintReference')
                    : t('transform.alignMaxHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="distributeSelectedItems('y')"
                  :disabled="selectionInfo.count < 3"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignVerticalSpaceBetween :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{ t('transform.distributeHint') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <!-- Z轴 -->
      <div class="flex items-center gap-2">
        <span class="w-4 text-[10px] font-bold text-blue-500 select-none dark:text-blue-500/90"
          >Z</span
        >
        <div class="flex flex-1 gap-1.5">
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('z', 'min')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignEndHorizontal :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignMinHintReference')
                    : t('transform.alignMinHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('z', 'center')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignCenterHorizontal :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignCenterHintReference')
                    : t('transform.alignCenterHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="alignSelectedItems('z', 'max')"
                  :disabled="selectionInfo.count < 2 && !uiStore.alignReferenceItemId"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignStartHorizontal :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{
                  uiStore.alignReferenceItemId
                    ? t('transform.alignMaxHintReference')
                    : t('transform.alignMaxHint')
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip :delay-duration="500">
              <TooltipTrigger as-child>
                <button
                  @click="distributeSelectedItems('z')"
                  :disabled="selectionInfo.count < 3"
                  class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AlignVerticalSpaceBetween :size="14" class="shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{ t('transform.distributeHint') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  </div>
</template>

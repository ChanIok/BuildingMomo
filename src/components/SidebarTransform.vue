<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditorManipulation } from '../composables/editor/useEditorManipulation'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import { convertPositionWorkingToGlobal } from '../lib/coordinateTransform'
import { useTransformSelection, fmt } from '../composables/transform/useTransformSelection'
import TransformAxisInputs from './transform/TransformAxisInputs.vue'
import TransformRotationSection from './transform/TransformRotationSection.vue'
import TransformAlignSection from './transform/TransformAlignSection.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'

const editorStore = useEditorStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()
const { updateSelectedItemsTransform, mirrorSelectedItems } = useEditorManipulation()

// 使用抽取的 composable
const {
  selectionInfo,
  isScaleAllowed,
  alignReferenceItemName,
  isRotationXAllowed,
  isRotationYAllowed,
} = useTransformSelection()

// 位置和缩放默认为绝对模式 (false)
const isPositionRelative = ref(false)
const isScaleRelative = ref(false)

// 范围模式：pivot（轴点范围）或 bbox（包围盒范围）
const rangeMode = ref<'pivot' | 'bbox'>('pivot')

// 定点旋转状态（提升到父组件，防止子组件卸载时丢失）
const customPivotEnabled = ref(false)

// 位置相对输入的临时状态
const positionState = ref({ x: 0, y: 0, z: 0 })
// 缩放输入的临时状态（相对模式默认为 1，因为是乘法）
const scaleState = ref({ x: 1, y: 1, z: 1 })

// Tabs 绑定的计算属性
const positionMode = computed({
  get: () => (isPositionRelative.value ? 'relative' : 'absolute'),
  set: (val) => {
    isPositionRelative.value = val === 'relative'
  },
})

const scaleMode = computed({
  get: () => (isScaleRelative.value ? 'relative' : 'absolute'),
  set: (val) => {
    isScaleRelative.value = val === 'relative'
  },
})

// 监听选择变化以重置输入
watch(
  () => editorStore.activeScheme?.selectedItemIds.value,
  () => {
    positionState.value = { x: 0, y: 0, z: 0 }
    scaleState.value = { x: 1, y: 1, z: 1 }
  },
  { deep: true }
)

// 位置值（根据模式）
const positionValue = computed(() => {
  if (!selectionInfo.value) return { x: 0, y: 0, z: 0 }
  if (isPositionRelative.value) {
    return positionState.value
  } else {
    return selectionInfo.value.center
  }
})

// 缩放值（根据模式）
const scaleValue = computed(() => {
  if (!selectionInfo.value) return { x: 1, y: 1, z: 1 }
  if (isScaleRelative.value) {
    return scaleState.value
  } else {
    return selectionInfo.value.scale
  }
})

// 更新位置
function updatePosition(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return
  if (!editorStore.activeScheme) return

  if (isPositionRelative.value) {
    // 相对模式：值为增量
    const delta = value
    if (delta === 0) return

    let posArgs: any = { x: 0, y: 0, z: 0 }
    posArgs[axis] = delta

    // 获取有效的坐标系旋转（视觉空间）
    const effectiveRotation = uiStore.getEffectiveCoordinateRotation(
      editorStore.activeScheme.selectedItemIds.value,
      editorStore.itemsMap
    )

    // 如果有有效的坐标系，将增量向量转换到全局坐标系
    if (effectiveRotation) {
      // 用户输入的 Y 值需要取反，因为 Gizmo 的 Y 轴视觉上被翻转了
      // 用户看到的"向上"实际对应世界空间的 -Y
      const visualPosArgs = { x: posArgs.x, y: -posArgs.y, z: posArgs.z }
      // 工作坐标系 -> 世界空间
      const worldDelta = convertPositionWorkingToGlobal(visualPosArgs, effectiveRotation)
      // 世界空间 -> 数据空间：Y 轴翻转
      posArgs = { x: worldDelta.x, y: -worldDelta.y, z: worldDelta.z }
    }

    updateSelectedItemsTransform({
      mode: 'relative',
      position: posArgs,
    })

    // 重置输入为0
    positionState.value[axis] = 0
  } else {
    // 绝对模式
    // 用户输入的是有效坐标系下的目标值
    // 我们需要结合其他两个轴的当前值（有效坐标系下），构造完整的坐标点，然后转回全局

    const currentEffective = selectionInfo.value.center // 这是已经在 computed 中转换过的
    const newEffectivePos = { ...currentEffective, [axis]: value }

    // 转换回全局
    const effectiveRotation = uiStore.getEffectiveCoordinateRotation(
      editorStore.activeScheme.selectedItemIds.value,
      editorStore.itemsMap
    )
    let newGlobalPos = newEffectivePos
    if (effectiveRotation) {
      // 工作坐标系 -> 世界空间
      const worldPos = convertPositionWorkingToGlobal(newEffectivePos, effectiveRotation)
      // 世界空间 -> 数据空间：Y 轴翻转
      newGlobalPos = { x: worldPos.x, y: -worldPos.y, z: worldPos.z }
    }

    updateSelectedItemsTransform({
      mode: 'absolute',
      position: newGlobalPos,
    })
  }
}

// 更新缩放
function updateScale(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return

  if (isScaleRelative.value) {
    // 相对模式：值为乘数（例如 1.5 表示放大到 1.5 倍）
    const multiplier = value
    if (multiplier === 1) return // 乘以 1 无变化

    const scaleArgs: any = {}
    scaleArgs[axis] = multiplier

    updateSelectedItemsTransform({
      mode: 'relative',
      scale: scaleArgs,
    })

    // 重置输入为1
    scaleState.value[axis] = 1
  } else {
    // 绝对模式：直接设置缩放值
    const scaleArgs: any = {}
    scaleArgs[axis] = value

    updateSelectedItemsTransform({
      mode: 'absolute',
      scale: scaleArgs,
    })
  }
}

// 更新范围
function updateBounds(axis: 'x' | 'y' | 'z', type: 'min' | 'max', value: number) {
  if (!editorStore.activeScheme) return

  // 根据当前范围模式选择对应的 bounds
  const currentBounds =
    rangeMode.value === 'pivot' ? selectionInfo.value?.bounds : selectionInfo.value?.bboxBounds
  if (!currentBounds) return

  const currentVal = currentBounds[type][axis]
  const delta = value - currentVal

  if (delta === 0) return

  // 构造位移向量
  let posArgs: any = { x: 0, y: 0, z: 0 }
  posArgs[axis] = delta

  // 获取有效的坐标系旋转（视觉空间）
  const effectiveRotation = uiStore.getEffectiveCoordinateRotation(
    editorStore.activeScheme.selectedItemIds.value,
    editorStore.itemsMap
  )

  // 如果有有效的坐标系，将位移向量转换到全局坐标系
  if (effectiveRotation) {
    // 用户输入的 Y 值需要取反，因为 Gizmo 的 Y 轴视觉上被翻转了
    const visualPosArgs = { x: posArgs.x, y: -posArgs.y, z: posArgs.z }
    // 工作坐标系 -> 世界空间
    const worldDelta = convertPositionWorkingToGlobal(visualPosArgs, effectiveRotation)
    // 世界空间 -> 数据空间：Y 轴翻转
    posArgs = { x: worldDelta.x, y: -worldDelta.y, z: worldDelta.z }
  }

  updateSelectedItemsTransform({
    mode: 'relative',
    position: posArgs,
  })
}
</script>

<template>
  <div v-if="selectionInfo" class="p-4">
    <div class="flex flex-col items-stretch gap-3">
      <!-- 位置 -->
      <div class="flex flex-col items-stretch gap-2">
        <div class="flex flex-wrap items-center justify-between gap-y-2">
          <div class="flex items-center gap-1">
            <label class="text-xs font-semibold text-sidebar-foreground">{{
              t('transform.position')
            }}</label>
            <!-- Local 模式提示 (单选时显示) -->
            <TooltipProvider v-if="uiStore.gizmoSpace === 'local' && selectionInfo?.count === 1">
              <Tooltip :delay-duration="300">
                <TooltipTrigger as-child>
                  <span class="cursor-help text-[10px] text-primary">{{
                    t('transform.localCoord')
                  }}</span>
                </TooltipTrigger>
                <TooltipContent class="text-xs" variant="light">
                  {{ t('transform.localCoordTip') }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <!-- 工作坐标系提示 -->
            <TooltipProvider v-else-if="uiStore.workingCoordinateSystem.enabled">
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
          <Tabs v-model="positionMode" class="w-auto">
            <TabsList class="h-6 p-0.5">
              <TabsTrigger
                value="absolute"
                class="h-full px-2 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {{ t('transform.absolute') }}
              </TabsTrigger>
              <TabsTrigger
                value="relative"
                class="h-full px-2 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {{ t('transform.relative') }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <TransformAxisInputs
          :model-value="positionValue"
          :mode="positionMode"
          :formatter="fmt"
          @update:x="updatePosition('x', $event)"
          @update:y="updatePosition('y', $event)"
          @update:z="updatePosition('z', $event)"
        />
      </div>

      <!-- 旋转 -->
      <TransformRotationSection
        :selection-info="selectionInfo"
        :is-rotation-x-allowed="isRotationXAllowed"
        :is-rotation-y-allowed="isRotationYAllowed"
        v-model:custom-pivot-enabled="customPivotEnabled"
      />

      <!-- 缩放 -->
      <div v-if="isScaleAllowed" class="flex flex-col items-stretch gap-2">
        <div class="flex flex-wrap items-center justify-between gap-y-2">
          <label class="text-xs font-semibold text-sidebar-foreground">{{
            t('transform.scale')
          }}</label>
          <Tabs v-model="scaleMode" class="w-auto">
            <TabsList class="h-6 p-0.5">
              <TabsTrigger
                value="absolute"
                class="h-full px-2 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {{ t('transform.absolute') }}
              </TabsTrigger>
              <TabsTrigger
                value="relative"
                class="h-full px-2 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {{ t('transform.relative') }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <TransformAxisInputs
          :model-value="scaleValue"
          :mode="scaleMode"
          :default-value="1"
          :formatter="fmt"
          @update:x="updateScale('x', $event)"
          @update:y="updateScale('y', $event)"
          @update:z="updateScale('z', $event)"
        />
      </div>

      <!-- 对齐与分布 -->
      <TransformAlignSection
        :selection-info="selectionInfo"
        :align-reference-item-name="alignReferenceItemName"
      />

      <!-- 镜像 -->
      <div v-if="isScaleAllowed" class="flex flex-col items-stretch gap-2">
        <div class="flex flex-wrap items-center justify-between gap-y-2">
          <div class="flex items-center gap-1">
            <label class="text-xs font-semibold text-sidebar-foreground">{{
              t('transform.mirror')
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
        <!-- 镜像旋转开关 -->
        <div class="flex items-center justify-between gap-2">
          <TooltipProvider>
            <Tooltip :delay-duration="300">
              <TooltipTrigger as-child>
                <label
                  for="mirror-rotation-toggle"
                  class="cursor-pointer text-xs text-sidebar-foreground hover:text-foreground"
                >
                  {{ t('transform.mirrorWithRotation') }}
                </label>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{ t('transform.mirrorWithRotationHint') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch id="mirror-rotation-toggle" v-model="settingsStore.settings.mirrorWithRotation" />
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button
            @click="mirrorSelectedItems('x')"
            class="flex items-center justify-center gap-1.5 rounded-md bg-sidebar-accent px-3 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span class="text-[10px] font-bold text-red-500 dark:text-red-500/90">X</span>
          </button>
          <button
            @click="mirrorSelectedItems('y')"
            class="flex items-center justify-center gap-1.5 rounded-md bg-sidebar-accent px-3 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span class="text-[10px] font-bold text-green-500 dark:text-green-500/90">Y</span>
          </button>
          <button
            @click="mirrorSelectedItems('z')"
            class="flex items-center justify-center gap-1.5 rounded-md bg-sidebar-accent px-3 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span class="text-[10px] font-bold text-blue-500 dark:text-blue-500/90">Z</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 多选范围 -->
    <div
      v-if="selectionInfo.bounds"
      class="mt-3 flex flex-col gap-3 border-t border-sidebar-border pt-3"
    >
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs text-secondary-foreground">{{ t('transform.range') }}</span>
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
                      t('transform.rangeTip', {
                        angle: `${uiStore.workingCoordinateSystem.rotation.x}°, ${uiStore.workingCoordinateSystem.rotation.y}°, ${uiStore.workingCoordinateSystem.rotation.z}°`,
                      })
                    "
                  ></div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Tabs v-model="rangeMode" class="w-auto">
            <TabsList class="h-6 p-0.5">
              <TabsTrigger
                value="pivot"
                class="h-full px-2 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {{ t('transform.rangeModePivot') }}
              </TabsTrigger>
              <TabsTrigger
                value="bbox"
                :disabled="!selectionInfo.bboxBounds"
                class="h-full px-2 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {{ t('transform.rangeModeBBox') }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <!-- X Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
            >X</span
          >
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              step="any"
              :value="
                fmt(
                  (rangeMode === 'pivot' ? selectionInfo.bounds : selectionInfo.bboxBounds)?.min
                    .x ?? 0
                )
              "
              @change="
                (e) => updateBounds('x', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-muted-foreground">~</span>
            <input
              type="number"
              step="any"
              :value="
                fmt(
                  (rangeMode === 'pivot' ? selectionInfo.bounds : selectionInfo.bboxBounds)?.max
                    .x ?? 0
                )
              "
              @change="
                (e) => updateBounds('x', 'max', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>

        <!-- Y Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
            >Y</span
          >
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              step="any"
              :value="
                fmt(
                  (rangeMode === 'pivot' ? selectionInfo.bounds : selectionInfo.bboxBounds)?.min
                    .y ?? 0
                )
              "
              @change="
                (e) => updateBounds('y', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-muted-foreground">~</span>
            <input
              type="number"
              step="any"
              :value="
                fmt(
                  (rangeMode === 'pivot' ? selectionInfo.bounds : selectionInfo.bboxBounds)?.max
                    .y ?? 0
                )
              "
              @change="
                (e) => updateBounds('y', 'max', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>

        <!-- Z Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-blue-500 select-none dark:text-blue-500/90"
            >Z</span
          >
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              step="any"
              :value="
                fmt(
                  (rangeMode === 'pivot' ? selectionInfo.bounds : selectionInfo.bboxBounds)?.min
                    .z ?? 0
                )
              "
              @change="
                (e) => updateBounds('z', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-muted-foreground">~</span>
            <input
              type="number"
              step="any"
              :value="
                fmt(
                  (rangeMode === 'pivot' ? selectionInfo.bounds : selectionInfo.bboxBounds)?.max
                    .z ?? 0
                )
              "
              @change="
                (e) => updateBounds('z', 'max', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

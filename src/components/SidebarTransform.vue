<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditorManipulation } from '../composables/editor/useEditorManipulation'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useGameDataStore } from '../stores/gameDataStore'
import { useI18n } from '../composables/useI18n'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { toast } from 'vue-sonner'
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

const editorStore = useEditorStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const gameDataStore = useGameDataStore()
const { t } = useI18n()
const {
  updateSelectedItemsTransform,
  getSelectedItemsCenter,
  mirrorSelectedItems,
  alignSelectedItems,
  distributeSelectedItems,
} = useEditorManipulation()

// 三个独立的开关，默认都开启绝对模式 (false)
const isPositionRelative = ref(false)
const isRotationRelative = ref(false)
const isScaleRelative = ref(false)

// 旋转输入的临时状态
const rotationState = ref({ x: 0, y: 0, z: 0 })
// 位置相对输入的临时状态
const positionState = ref({ x: 0, y: 0, z: 0 })
// 缩放输入的临时状态（相对模式默认为 1，因为是乘法）
const scaleState = ref({ x: 1, y: 1, z: 1 })

// 定点旋转状态（存储工作坐标系的值，即用户直接输入的值）
const customPivotEnabled = ref(false)
const customPivotWorkingX = ref<number | null>(null)
const customPivotWorkingY = ref<number | null>(null)
const customPivotWorkingZ = ref<number | null>(null)

// 定点旋转显示值（直接使用工作坐标，用户输入什么就显示什么）
const customPivotDisplayX = computed({
  get: () => customPivotWorkingX.value,
  set: (value: number | null) => {
    customPivotWorkingX.value = value
  },
})

const customPivotDisplayY = computed({
  get: () => customPivotWorkingY.value,
  set: (value: number | null) => {
    customPivotWorkingY.value = value
  },
})

const customPivotDisplayZ = computed({
  get: () => customPivotWorkingZ.value,
  set: (value: number | null) => {
    customPivotWorkingZ.value = value
  },
})

// Tabs 绑定的计算属性
const positionMode = computed({
  get: () => (isPositionRelative.value ? 'relative' : 'absolute'),
  set: (val) => {
    isPositionRelative.value = val === 'relative'
  },
})

const rotationMode = computed({
  get: () => {
    // 多选强制相对，单选遵循用户偏好
    if (selectionInfo.value?.count && selectionInfo.value.count > 1) {
      return 'relative'
    }
    return isRotationRelative.value ? 'relative' : 'absolute'
  },
  set: (val) => {
    // 只更新用户偏好
    isRotationRelative.value = val === 'relative'
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
    rotationState.value = { x: 0, y: 0, z: 0 }
    positionState.value = { x: 0, y: 0, z: 0 }
    scaleState.value = { x: 1, y: 1, z: 1 }
  },
  { deep: true }
)

// 监听定点旋转开关，同步到 uiStore
watch(customPivotEnabled, (enabled) => {
  uiStore.setCustomPivotEnabled(enabled)
  if (!enabled) {
    // 清空工作坐标
    customPivotWorkingX.value = null
    customPivotWorkingY.value = null
    customPivotWorkingZ.value = null
  }
})

// 监听定点旋转坐标变化（工作坐标），转换成全局坐标同步到 uiStore
watch([customPivotWorkingX, customPivotWorkingY, customPivotWorkingZ], ([x, y, z]) => {
  if (customPivotEnabled.value && x !== null && y !== null && z !== null) {
    // 将工作坐标转换为全局坐标
    const global = uiStore.workingToGlobal({ x, y, z })
    uiStore.setCustomPivotPosition(global)
  } else {
    uiStore.setCustomPivotPosition(null)
  }
})

const selectionInfo = computed(() => {
  const scheme = editorStore.activeScheme
  if (!scheme) return null
  const ids = scheme.selectedItemIds.value
  if (ids.size === 0) return null
  const selected = scheme.items.value.filter((item) => ids.has(item.internalId))

  // 位置中心点（用于绝对模式显示）
  let center = { x: 0, y: 0, z: 0 }

  // 如果有参照物，使用参照物的位置
  if (pivotItem.value) {
    center = { x: pivotItem.value.x, y: pivotItem.value.y, z: pivotItem.value.z }
  } else {
    // 否则使用选区中心
    center = getSelectedItemsCenter() || { x: 0, y: 0, z: 0 }
  }

  // 如果启用了工作坐标系，将中心点转换到工作坐标系
  if (uiStore.workingCoordinateSystem.enabled) {
    center = uiStore.globalToWorking(center)
  }

  // 旋转角度（用于绝对模式显示）
  let rotation = { x: 0, y: 0, z: 0 }
  if (selected.length === 1) {
    const item = selected[0]
    if (item) {
      rotation = {
        x: item.rotation.x,
        y: item.rotation.y,
        z: item.rotation.z,
      }
      // 工作坐标系下，将全局旋转转换为工作坐标系下的相对旋转（使用四元数精确转换）
      if (uiStore.workingCoordinateSystem.enabled) {
        rotation = uiStore.rotationGlobalToWorking(rotation)
      }
    }
  } else {
    // 多选绝对模式显示，显示0或保持最后已知值
    rotation = rotationState.value
  }

  // 缩放（不受工作坐标系影响）
  let scale = { x: 1, y: 1, z: 1 }
  if (selected.length === 1) {
    const item = selected[0]
    if (item && item.extra.Scale) {
      scale = {
        x: item.extra.Scale.X,
        y: item.extra.Scale.Y,
        z: item.extra.Scale.Z,
      }
    }
  } else if (selected.length > 1) {
    // 多选时计算平均缩放
    const scales = selected.map((item) => item.extra.Scale || { X: 1, Y: 1, Z: 1 })
    const avgX = scales.reduce((sum, s) => sum + s.X, 0) / scales.length
    const avgY = scales.reduce((sum, s) => sum + s.Y, 0) / scales.length
    const avgZ = scales.reduce((sum, s) => sum + s.Z, 0) / scales.length
    scale = { x: avgX, y: avgY, z: avgZ }
  }

  // 边界（最小/最大值）
  let bounds = null
  if (selected.length > 1) {
    const points = selected.map((i) => ({ x: i.x, y: i.y, z: i.z }))

    // 如果启用了工作坐标系，将所有点转换到工作坐标系
    const transformedPoints = uiStore.workingCoordinateSystem.enabled
      ? points.map((p) => uiStore.globalToWorking(p))
      : points

    const xs = transformedPoints.map((p) => p.x)
    const ys = transformedPoints.map((p) => p.y)
    const zs = transformedPoints.map((p) => p.z)

    bounds = {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    }
  }

  return {
    count: selected.length,
    center,
    rotation,
    scale,
    bounds,
  }
})

// 获取当前选中物品的变换约束信息
const transformConstraints = computed(() => {
  if (!selectionInfo.value) return null

  const scheme = editorStore.activeScheme
  if (!scheme) return null

  const selected = scheme.items.value.filter((item) =>
    scheme.selectedItemIds.value.has(item.internalId)
  )

  if (selected.length === 0) return null

  // 多选时取交集（最严格限制）
  let scaleMin = 0
  let scaleMax = Infinity
  let canRotateX = true
  let canRotateY = true

  for (const item of selected) {
    const furniture = gameDataStore.getFurniture(item.gameId)
    if (furniture) {
      scaleMin = Math.max(scaleMin, furniture.scaleRange[0])
      scaleMax = Math.min(scaleMax, furniture.scaleRange[1])
      canRotateX &&= furniture.rotationAllowed.x
      canRotateY &&= furniture.rotationAllowed.y
    }
  }

  return {
    scaleRange: [scaleMin, scaleMax] as [number, number],
    rotationAllowed: { x: canRotateX, y: canRotateY, z: true },
    isScaleLocked: scaleMin >= scaleMax,
  }
})

// 计算各个控制的可用性
const isRotationXAllowed = computed(() => {
  if (!settingsStore.settings.enableLimitDetection) return true
  return transformConstraints.value?.rotationAllowed.x ?? false
})

const isRotationYAllowed = computed(() => {
  if (!settingsStore.settings.enableLimitDetection) return true
  return transformConstraints.value?.rotationAllowed.y ?? false
})

const isScaleAllowed = computed(() => {
  if (!settingsStore.settings.enableLimitDetection) return true
  return !(transformConstraints.value?.isScaleLocked ?? false)
})

// ========== 参照物相关逻辑 ==========

// 当前参照物
const pivotItem = computed(() => {
  if (!uiStore.alignmentPivotId) return null

  const pivotId = uiStore.alignmentPivotId
  return editorStore.itemsMap.get(pivotId) || null
})

// 参照物名称
const pivotItemName = computed(() => {
  if (!pivotItem.value) return ''
  const furniture = gameDataStore.getFurniture(pivotItem.value.gameId)

  if (!furniture) {
    return t('sidebar.itemDefaultName', { id: pivotItem.value.gameId })
  }

  // 根据当前语言选择名称（与 useThreeTooltip 保持一致）
  const { locale } = useI18n()
  return locale.value === 'zh' ? furniture.name_cn : furniture.name_en || furniture.name_cn
})

// 开始选择参照物
function startSelectingPivot() {
  if (!editorStore.activeScheme) return
  if (editorStore.activeScheme.selectedItemIds.value.size < 2) {
    toast.warning(t('transform.requireTwoItems'))
    return
  }

  uiStore.setSelectingAlignmentPivot(true)
  toast.info(t('transform.selectingPivot'))
}

// 清除参照物
function clearPivot() {
  uiStore.clearAlignmentPivot()
}

// 监听选区变化，自动清除不在选区内的参照物
watch(
  () => editorStore.activeScheme?.selectedItemIds.value,
  (newSelection) => {
    if (!uiStore.alignmentPivotId) return

    const pivotId = uiStore.alignmentPivotId
    if (newSelection && !newSelection.has(pivotId)) {
      // 参照物不在选区内，清除
      uiStore.clearAlignmentPivot()
    }
  },
  { deep: true }
)

// 更新处理函数
function updatePosition(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return

  if (isPositionRelative.value) {
    // 相对模式：值为增量
    const delta = value
    if (delta === 0) return

    let posArgs: any = { x: 0, y: 0, z: 0 }
    posArgs[axis] = delta

    // 工作坐标系下的相对移动：将增量向量从工作坐标系转换到全局坐标系
    if (uiStore.workingCoordinateSystem.enabled) {
      posArgs = uiStore.workingToGlobal(posArgs)
    }

    updateSelectedItemsTransform({
      mode: 'relative',
      position: posArgs,
    })

    // 重置输入为0
    positionState.value[axis] = 0
  } else {
    // 绝对模式
    // 用户输入的是工作坐标系下的目标值
    // 我们需要结合其他两个轴的当前值（工作坐标系下），构造完整的工作坐标点，然后转回全局

    const currentWorking = selectionInfo.value.center // 这是已经在 computed 中转换过的
    const newWorkingPos = { ...currentWorking, [axis]: value }

    // 转换回全局
    let newGlobalPos = newWorkingPos
    if (uiStore.workingCoordinateSystem.enabled) {
      newGlobalPos = uiStore.workingToGlobal(newWorkingPos)
    }

    updateSelectedItemsTransform({
      mode: 'absolute',
      position: newGlobalPos,
    })
  }
}

function updateRotation(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return

  if (rotationMode.value === 'relative') {
    // 相对模式
    const delta = value
    if (delta === 0) return

    const rotationArgs: any = {}
    rotationArgs[axis] = delta

    updateSelectedItemsTransform({
      mode: 'relative',
      rotation: rotationArgs,
    })

    // 重置输入为0
    rotationState.value[axis] = 0
  } else {
    // 绝对模式
    // 此时肯定是单选，因为多选强制为 relative
    if (selectionInfo.value.count === 1) {
      // 单选绝对模式：将工作坐标系下的输入值转换为全局旋转

      // 构建完整的工作坐标系旋转（用户输入 + 其他轴的当前值）
      const workingRotation = { ...selectionInfo.value.rotation }
      workingRotation[axis] = value

      // 转换为全局旋转（使用四元数精确转换）
      const globalRotation = uiStore.workingCoordinateSystem.enabled
        ? uiStore.rotationWorkingToGlobal(workingRotation)
        : workingRotation

      const rotationArgs: any = {}
      rotationArgs[axis] = globalRotation[axis]

      updateSelectedItemsTransform({
        mode: 'absolute',
        rotation: rotationArgs,
      })
    }
  }
}

function updateScale(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return

  // 应用范围限制（如果启用合规检测）
  let clampedValue = value
  if (settingsStore.settings.enableLimitDetection && transformConstraints.value) {
    const [min, max] = transformConstraints.value.scaleRange
    if (!isScaleRelative.value) {
      // 绝对模式：只截断，不舍入（保持精确值，由逻辑层统一处理）
      clampedValue = Math.max(min, Math.min(max, value))
    }
    // 相对模式：在 updateSelectedItemsTransform 内部处理
  }

  if (isScaleRelative.value) {
    // 相对模式：值为乘数（例如 1.5 表示放大到 1.5 倍）
    const multiplier = clampedValue
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
    scaleArgs[axis] = clampedValue

    updateSelectedItemsTransform({
      mode: 'absolute',
      scale: scaleArgs,
    })
  }
}

function updateBounds(axis: 'x' | 'y' | 'z', type: 'min' | 'max', value: number) {
  if (!selectionInfo.value?.bounds) return

  const currentVal = selectionInfo.value.bounds[type][axis]
  const delta = value - currentVal

  if (delta === 0) return

  // 构造位移向量
  let posArgs: any = { x: 0, y: 0, z: 0 }
  posArgs[axis] = delta

  // 如果启用了工作坐标系，将位移向量从工作坐标系转回全局坐标系
  if (uiStore.workingCoordinateSystem.enabled) {
    posArgs = uiStore.workingToGlobal(posArgs)
  }

  updateSelectedItemsTransform({
    mode: 'relative',
    position: posArgs,
  })
}

// 数字格式化辅助函数
const fmt = (n: number) => Math.round(n * 100) / 100
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

        <!-- 参照物选择 (仅在多选时显示) -->
        <div v-if="selectionInfo.count > 1" class="flex items-center justify-between gap-2">
          <TooltipProvider>
            <Tooltip :delay-duration="300">
              <TooltipTrigger as-child>
                <label class="cursor-help text-xs text-sidebar-foreground hover:text-foreground">
                  {{ t('transform.pivotReference') }}
                </label>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{ t('transform.pivotReferenceHint') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div class="flex min-w-0 flex-1 items-center justify-end">
            <!-- 未选择且未在选择中 -->
            <button
              v-if="!pivotItem && !uiStore.isSelectingAlignmentPivot"
              @click="startSelectingPivot"
              class="h-6 rounded-md bg-sidebar-accent px-2 text-[10px] font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {{ t('transform.selectButton') }}
            </button>
            <!-- 选择中状态 -->
            <button
              v-else-if="!pivotItem && uiStore.isSelectingAlignmentPivot"
              @click="uiStore.setSelectingAlignmentPivot(false)"
              class="h-6 rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {{ t('transform.cancelSelectingPivot') }}
            </button>
            <!-- 已设置参照物 -->
            <div
              v-else-if="pivotItem"
              class="flex min-w-0 items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1"
            >
              <TooltipProvider>
                <Tooltip :delay-duration="300">
                  <TooltipTrigger as-child>
                    <span class="min-w-0 cursor-help truncate text-[10px] text-sidebar-foreground">
                      {{ pivotItemName }}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ pivotItemName }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <button
                @click="clearPivot"
                class="flex-shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                :title="t('transform.clearPivot')"
              >
                <X :size="12" />
              </button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
              >X</span
            >
            <input
              type="number"
              step="any"
              :value="
                isPositionRelative
                  ? positionState.x === 0
                    ? ''
                    : positionState.x
                  : fmt(selectionInfo.center.x)
              "
              @change="(e) => updatePosition('x', Number((e.target as HTMLInputElement).value))"
              :placeholder="isPositionRelative ? '0' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
              >Y</span
            >
            <input
              type="number"
              step="any"
              :value="
                isPositionRelative
                  ? positionState.y === 0
                    ? ''
                    : positionState.y
                  : fmt(selectionInfo.center.y)
              "
              @change="(e) => updatePosition('y', Number((e.target as HTMLInputElement).value))"
              :placeholder="isPositionRelative ? '0' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-blue-500 select-none dark:text-blue-500/90"
              >Z</span
            >
            <input
              type="number"
              step="any"
              :value="
                isPositionRelative
                  ? positionState.z === 0
                    ? ''
                    : positionState.z
                  : fmt(selectionInfo.center.z)
              "
              @change="(e) => updatePosition('z', Number((e.target as HTMLInputElement).value))"
              :placeholder="isPositionRelative ? '0' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
      <!-- 旋转 -->
      <div class="flex flex-col items-stretch gap-2">
        <div class="flex flex-wrap items-center justify-between gap-y-2">
          <div class="flex items-center gap-1">
            <label class="text-xs font-semibold text-sidebar-foreground">{{
              t('transform.rotation')
            }}</label>
            <TooltipProvider v-if="uiStore.workingCoordinateSystem.enabled">
              <Tooltip :delay-duration="300">
                <TooltipTrigger as-child>
                  <span class="cursor-help text-[10px] text-primary">{{
                    t('transform.correction')
                  }}</span>
                </TooltipTrigger>
                <TooltipContent class="text-xs" variant="light">
                  <div
                    v-html="
                      t('transform.correctionTip', {
                        angle: `${uiStore.workingCoordinateSystem.rotation.x}°, ${uiStore.workingCoordinateSystem.rotation.y}°, ${uiStore.workingCoordinateSystem.rotation.z}°`,
                      })
                    "
                  ></div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Tabs v-model="rotationMode" class="w-auto">
            <TabsList class="h-6 p-0.5">
              <TabsTrigger
                value="absolute"
                :disabled="selectionInfo?.count > 1"
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
        <!-- 定点旋转 -->
        <div class="flex items-center justify-between gap-2">
          <TooltipProvider>
            <Tooltip :delay-duration="300">
              <TooltipTrigger as-child>
                <div class="flex items-center gap-1">
                  <label
                    for="custom-pivot-toggle"
                    class="cursor-pointer text-xs text-sidebar-foreground hover:text-foreground"
                  >
                    {{ t('transform.customPivot') }}
                  </label>
                  <span
                    v-if="uiStore.workingCoordinateSystem.enabled"
                    class="cursor-help text-[10px] text-primary"
                  >
                    {{ t('transform.workingCoord') }}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                {{ t('transform.customPivotHint') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch id="custom-pivot-toggle" v-model="customPivotEnabled" />
        </div>
        <div v-if="customPivotEnabled" class="grid grid-cols-3 gap-2">
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span class="mr-1.5 text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
              >X</span
            >
            <input
              type="number"
              step="any"
              v-model.number="customPivotDisplayX"
              placeholder=""
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
              >Y</span
            >
            <input
              type="number"
              step="any"
              v-model.number="customPivotDisplayY"
              placeholder=""
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 text-[10px] font-bold text-blue-500 select-none dark:text-blue-500/90"
              >Z</span
            >
            <input
              type="number"
              step="any"
              v-model.number="customPivotDisplayZ"
              placeholder=""
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <!-- Roll (X) -->
          <div
            v-if="isRotationXAllowed"
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
              >X</span
            >
            <input
              type="number"
              step="any"
              :value="
                rotationMode === 'relative'
                  ? rotationState.x === 0
                    ? ''
                    : rotationState.x
                  : fmt(selectionInfo.rotation.x)
              "
              @change="(e) => updateRotation('x', Number((e.target as HTMLInputElement).value))"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :placeholder="rotationMode === 'relative' ? '0' : ''"
            />
          </div>
          <!-- Pitch (Y) -->
          <div
            v-if="isRotationYAllowed"
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
              >Y</span
            >
            <input
              type="number"
              step="any"
              :value="
                rotationMode === 'relative'
                  ? rotationState.y === 0
                    ? ''
                    : rotationState.y
                  : fmt(selectionInfo.rotation.y)
              "
              @change="(e) => updateRotation('y', Number((e.target as HTMLInputElement).value))"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :placeholder="rotationMode === 'relative' ? '0' : ''"
            />
          </div>
          <!-- Yaw (Z) -->
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-blue-500 select-none dark:text-blue-500/90"
              >Z</span
            >
            <input
              type="number"
              step="any"
              :value="
                rotationMode === 'relative'
                  ? rotationState.z === 0
                    ? ''
                    : rotationState.z
                  : fmt(selectionInfo.rotation.z)
              "
              @change="(e) => updateRotation('z', Number((e.target as HTMLInputElement).value))"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :placeholder="rotationMode === 'relative' ? '0' : ''"
            />
          </div>
        </div>
      </div>
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
        <div class="grid grid-cols-2 gap-2">
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
              >X</span
            >
            <input
              type="number"
              step="any"
              :value="
                isScaleRelative
                  ? scaleState.x === 1
                    ? ''
                    : scaleState.x
                  : fmt(selectionInfo.scale.x)
              "
              @change="(e) => updateScale('x', Number((e.target as HTMLInputElement).value))"
              :placeholder="isScaleRelative ? '1' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
              >Y</span
            >
            <input
              type="number"
              step="any"
              :value="
                isScaleRelative
                  ? scaleState.y === 1
                    ? ''
                    : scaleState.y
                  : fmt(selectionInfo.scale.y)
              "
              @change="(e) => updateScale('y', Number((e.target as HTMLInputElement).value))"
              :placeholder="isScaleRelative ? '1' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
          >
            <span
              class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-blue-500 select-none dark:text-blue-500/90"
              >Z</span
            >
            <input
              type="number"
              step="any"
              :value="
                isScaleRelative
                  ? scaleState.z === 1
                    ? ''
                    : scaleState.z
                  : fmt(selectionInfo.scale.z)
              "
              @change="(e) => updateScale('z', Number((e.target as HTMLInputElement).value))"
              :placeholder="isScaleRelative ? '1' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
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
      <!-- 对齐与分布 -->
      <div v-if="selectionInfo.count > 1" class="flex flex-col items-stretch gap-2">
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
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignStartVertical :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignMinHint') }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('x', 'center')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignCenterVertical :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignCenterHint') }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('x', 'max')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignEndVertical :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignMaxHint') }}
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
            <span
              class="w-4 text-[10px] font-bold text-green-500 select-none dark:text-green-500/90"
              >Y</span
            >
            <div class="flex flex-1 gap-1.5">
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('y', 'min')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignStartHorizontal :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignMinHint') }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('y', 'center')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignCenterHorizontal :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignCenterHint') }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('y', 'max')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignEndHorizontal :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignMaxHint') }}
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
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignEndHorizontal :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignMinHint') }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('z', 'center')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignCenterHorizontal :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignCenterHint') }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip :delay-duration="500">
                  <TooltipTrigger as-child>
                    <button
                      @click="alignSelectedItems('z', 'max')"
                      :disabled="selectionInfo.count < 2"
                      class="flex flex-1 items-center justify-center rounded-md bg-sidebar-accent px-2 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AlignStartHorizontal :size="14" class="shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="text-xs" variant="light">
                    {{ t('transform.alignMaxHint') }}
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
    </div>

    <!-- 多选范围 -->
    <div
      v-if="selectionInfo.bounds"
      class="mt-3 flex flex-col gap-3 border-t border-sidebar-border pt-3"
    >
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
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

        <!-- X Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-red-500 select-none dark:text-red-500/90"
            >X</span
          >
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              step="any"
              :value="fmt(selectionInfo.bounds.min.x)"
              @change="
                (e) => updateBounds('x', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-muted-foreground">~</span>
            <input
              type="number"
              step="any"
              :value="fmt(selectionInfo.bounds.max.x)"
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
              :value="fmt(selectionInfo.bounds.min.y)"
              @change="
                (e) => updateBounds('y', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-muted-foreground">~</span>
            <input
              type="number"
              step="any"
              :value="fmt(selectionInfo.bounds.max.y)"
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
              :value="fmt(selectionInfo.bounds.min.z)"
              @change="
                (e) => updateBounds('z', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-sidebar-accent px-2 py-1 text-right text-xs text-sidebar-foreground ring-1 ring-transparent transition-all outline-none hover:bg-accent focus:bg-background focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-muted-foreground">~</span>
            <input
              type="number"
              step="any"
              :value="fmt(selectionInfo.bounds.max.z)"
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

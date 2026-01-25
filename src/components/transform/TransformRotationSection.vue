<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useEditorManipulation } from '../../composables/editor/useEditorManipulation'
import { useI18n } from '../../composables/useI18n'
import {
  convertPositionGlobalToWorking,
  convertRotationWorkingToGlobal,
} from '../../lib/coordinateTransform'
import { matrixTransform } from '../../lib/matrixTransform'
import type { SelectionInfo } from '../../composables/transform/useTransformSelection'
import TransformAxisInputs from './TransformAxisInputs.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'

interface Props {
  selectionInfo: SelectionInfo
  isRotationXAllowed: boolean
  isRotationYAllowed: boolean
}

const props = defineProps<Props>()

// 定点旋转状态（从父组件接收，防止子组件卸载时丢失）
const customPivotEnabled = defineModel<boolean>('customPivotEnabled', { default: false })

const editorStore = useEditorStore()
const uiStore = useUIStore()
const { t } = useI18n()
const { updateSelectedItemsTransform } = useEditorManipulation()

// 旋转默认为相对模式 (true)
const isRotationRelative = ref(false)

// 旋转输入的临时状态
const rotationState = ref({ x: 0, y: 0, z: 0 })
const customPivotWorkingX = ref<number | null>(null)
const customPivotWorkingY = ref<number | null>(null)
const customPivotWorkingZ = ref<number | null>(null)

// Tabs 绑定的计算属性
const rotationMode = computed({
  get: () => {
    // 多选强制相对，单选遵循用户偏好
    if (props.selectionInfo?.count && props.selectionInfo.count > 1) {
      return 'relative'
    }
    return isRotationRelative.value ? 'relative' : 'absolute'
  },
  set: (val) => {
    // 只更新用户偏好
    isRotationRelative.value = val === 'relative'
  },
})

// 监听选择变化以重置输入
watch(
  () => editorStore.activeScheme?.selectedItemIds.value,
  () => {
    rotationState.value = { x: 0, y: 0, z: 0 }
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

// 监听选择结果，填入坐标（工作坐标系下的值）
watch(
  () => uiStore.selectedPivotPosition,
  (pos) => {
    if (pos && customPivotEnabled.value) {
      // 获取有效的坐标系旋转（视觉空间）
      const effectiveRotation = uiStore.getEffectiveCoordinateRotation(
        editorStore.activeScheme?.selectedItemIds.value || new Set(),
        editorStore.itemsMap
      )

      // 数据空间 -> 世界空间：Y 轴翻转
      const worldPos = { x: pos.x, y: -pos.y, z: pos.z }

      // 如果有有效的坐标系，将世界空间坐标转换到工作坐标系
      let workingPos = pos // 默认使用数据空间值
      if (effectiveRotation) {
        // 世界空间 -> 工作坐标系
        const working = convertPositionGlobalToWorking(worldPos, effectiveRotation)
        // 世界空间 -> 数据空间：Y 轴翻转回来
        workingPos = { x: working.x, y: -working.y, z: working.z }
      }

      // 填入工作坐标系下的值
      customPivotWorkingX.value = workingPos.x
      customPivotWorkingY.value = workingPos.y
      customPivotWorkingZ.value = workingPos.z

      // 清空临时状态
      uiStore.setSelectedPivotPosition(null)
    }
  }
)

// 更新旋转
function updateRotation(axis: 'x' | 'y' | 'z', value: number) {
  if (!props.selectionInfo) return
  if (!editorStore.activeScheme) return

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
    if (props.selectionInfo.count === 1) {
      // 单选绝对模式：将有效坐标系下的输入值转换为全局旋转

      // 构建完整的有效坐标系旋转（用户输入 + 其他轴的当前值）
      const effectiveRotation = { ...props.selectionInfo.rotation }
      effectiveRotation[axis] = value

      // 转换为全局旋转（使用四元数精确转换）
      const coordRotation = uiStore.getEffectiveCoordinateRotation(
        editorStore.activeScheme.selectedItemIds.value,
        editorStore.itemsMap
      )
      let globalRotation = effectiveRotation
      if (coordRotation) {
        // 直接使用视觉空间的旋转值，与 Gizmo 一致
        globalRotation = convertRotationWorkingToGlobal(effectiveRotation, coordRotation)
      }

      // 传递完整的三轴旋转，而非仅单轴
      updateSelectedItemsTransform({
        mode: 'absolute',
        rotation: matrixTransform.visualRotationToData(globalRotation),
      })
    }
  }
}

// 开始选择物品
function startSelectingPivotItem() {
  uiStore.setSelectingPivotItem(true)
}

// 定点旋转坐标值（用于显示）
const customPivotValue = computed(() => ({
  x: customPivotWorkingX.value ?? 0,
  y: customPivotWorkingY.value ?? 0,
  z: customPivotWorkingZ.value ?? 0,
}))

// 可见轴（根据约束）
const visibleAxes = computed(() => {
  const axes: ('x' | 'y' | 'z')[] = []
  if (props.isRotationXAllowed) axes.push('x')
  if (props.isRotationYAllowed) axes.push('y')
  axes.push('z') // Z轴总是允许
  return axes
})

// 旋转值（根据模式）
const rotationValue = computed(() => {
  if (rotationMode.value === 'relative') {
    return rotationState.value
  } else {
    return props.selectionInfo.rotation
  }
})
</script>

<template>
  <div class="flex flex-col items-stretch gap-2">
    <div class="flex flex-wrap items-center justify-between gap-y-2">
      <div class="flex items-center gap-1">
        <label class="text-xs font-semibold text-sidebar-foreground">{{
          t('transform.rotation')
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
            <label
              for="custom-pivot-toggle"
              class="cursor-pointer text-xs text-sidebar-foreground hover:text-foreground"
            >
              {{ t('transform.customPivot') }}
            </label>
          </TooltipTrigger>
          <TooltipContent class="text-xs" variant="light">
            {{ t('transform.customPivotHint') }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div class="flex items-center gap-1.5">
        <!-- 选择按钮 -->
        <button
          v-if="customPivotEnabled && !uiStore.isSelectingPivotItem"
          @click="startSelectingPivotItem"
          class="h-[18.5px] rounded-md bg-sidebar-accent px-2 text-[10px] font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {{ t('transform.selectPivotItem') }}
        </button>
        <button
          v-else-if="customPivotEnabled && uiStore.isSelectingPivotItem"
          @click="uiStore.setSelectingPivotItem(false)"
          class="h-[18.5px] rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {{ t('transform.cancelPivotSelect') }}
        </button>
        <Switch id="custom-pivot-toggle" v-model="customPivotEnabled" />
      </div>
    </div>

    <!-- 定点坐标输入 -->
    <TransformAxisInputs
      v-if="customPivotEnabled"
      :model-value="customPivotValue"
      mode="absolute"
      :cols="3"
      @update:x="customPivotWorkingX = $event"
      @update:y="customPivotWorkingY = $event"
      @update:z="customPivotWorkingZ = $event"
    />

    <!-- 旋转输入 -->
    <TransformAxisInputs
      :model-value="rotationValue"
      :mode="rotationMode"
      :axes="visibleAxes"
      :formatter="(v) => Math.round(v * 100) / 100"
      @update:x="updateRotation('x', $event)"
      @update:y="updateRotation('y', $event)"
      @update:z="updateRotation('z', $event)"
    />
  </div>
</template>

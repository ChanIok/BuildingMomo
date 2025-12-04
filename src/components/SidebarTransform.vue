<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditorManipulation } from '../composables/editor/useEditorManipulation'
import { useUIStore } from '../stores/uiStore'
import { useI18n } from '../composables/useI18n'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const editorStore = useEditorStore()
const uiStore = useUIStore()
const { t } = useI18n()
const { updateSelectedItemsTransform, getSelectedItemsCenter } = useEditorManipulation()

// 两个独立的开关，默认都开启绝对模式 (false)
const isPositionRelative = ref(false)
const isRotationRelative = ref(false)

// 旋转输入的临时状态
const rotationState = ref({ x: 0, y: 0, z: 0 })
// 位置相对输入的临时状态
const positionState = ref({ x: 0, y: 0, z: 0 })

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

// 监听选择变化以重置输入
watch(
  () => editorStore.activeScheme?.selectedItemIds.value,
  () => {
    rotationState.value = { x: 0, y: 0, z: 0 }
    positionState.value = { x: 0, y: 0, z: 0 }
  },
  { deep: true }
)

const selectionInfo = computed(() => {
  const scheme = editorStore.activeScheme
  if (!scheme) return null
  const ids = scheme.selectedItemIds.value
  if (ids.size === 0) return null
  const selected = scheme.items.value.filter((item) => ids.has(item.internalId))

  // 位置中心点（用于绝对模式显示）
  let center = getSelectedItemsCenter() || { x: 0, y: 0, z: 0 }

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
      // 工作坐标系下，Z轴旋转需要减去坐标系角度
      if (uiStore.workingCoordinateSystem.enabled) {
        rotation.z -= uiStore.workingCoordinateSystem.rotationAngle
      }
    }
  } else {
    // 多选绝对模式显示，显示0或保持最后已知值
    rotation = rotationState.value
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
    bounds,
  }
})

// 更新处理函数
function updatePosition(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return

  if (isPositionRelative.value) {
    // 相对模式：值为增量
    const delta = value
    if (delta === 0) return

    let posArgs: any = { x: 0, y: 0, z: 0 }
    posArgs[axis] = delta

    // 工作坐标系下的相对移动：需要旋转增量向量
    if (uiStore.workingCoordinateSystem.enabled) {
      // 这里不需要平移，只需要旋转向量
      // workingToGlobal 包含平移逻辑吗？uiStore 中的实现是纯旋转变换（看起来是 2D 旋转 + Z 不变）
      // 让我们检查 uiStore.workingToGlobal 的实现
      // 实现是: x' = x*cos - y*sin ... 这是一个纯线性变换（旋转），所以对向量也适用
      posArgs = uiStore.workingToGlobal(posArgs)
    }

    // updateSelectedItemsTransform 接受的是全局增量
    // 但注意：这个函数签名的 posArgs 是 Partial<{x,y,z}>
    // 如果旋转后 x,y 都有值，我们需要正确传递
    // 为了安全，我们需要构造一个完整的 delta 对象传递给 updateSelectedItemsTransform
    // 但是 updateSelectedItemsTransform 在 relative 模式下接受的是 Partial
    // 我们传递旋转后的完整对象即可

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

  if (isRotationRelative.value) {
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
    if (selectionInfo.value.count === 1) {
      // 单选绝对模式：直接应用目标值
      const rotationArgs: any = {}
      let targetValue = value

      // 如果启用了工作坐标系，且修改的是 Z 轴，需要还原回全局角度
      if (axis === 'z' && uiStore.workingCoordinateSystem.enabled) {
        targetValue += uiStore.workingCoordinateSystem.rotationAngle
      }

      rotationArgs[axis] = targetValue

      updateSelectedItemsTransform({
        mode: 'absolute',
        rotation: rotationArgs,
      })
    } else {
      // 多选绝对旋转：实际表现为相对模式
      const currentVal = rotationState.value[axis]
      const delta = value - currentVal
      const rotationArgs: any = {}
      rotationArgs[axis] = delta

      updateSelectedItemsTransform({
        mode: 'relative',
        rotation: rotationArgs,
      })
      rotationState.value[axis] = value
    }
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
  <div v-if="selectionInfo" class="p-4 pr-2">
    <div class="flex flex-col items-stretch gap-3">
      <!-- 位置 -->
      <div class="flex flex-col items-stretch gap-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <label class="text-xs font-bold text-gray-700">{{ t('transform.position') }}</label>
            <TooltipProvider v-if="uiStore.workingCoordinateSystem.enabled">
              <Tooltip :delay-duration="300">
                <TooltipTrigger as-child>
                  <span class="cursor-help text-[10px] font-medium text-blue-600">{{
                    t('transform.workingCoord')
                  }}</span>
                </TooltipTrigger>
                <TooltipContent class="text-xs" variant="light">
                  <div
                    v-html="
                      t('transform.workingCoordTip', {
                        angle: uiStore.workingCoordinateSystem.rotationAngle,
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
                class="h-full px-2 text-[10px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                {{ t('transform.absolute') }}
              </TabsTrigger>
              <TabsTrigger
                value="relative"
                class="h-full px-2 text-[10px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                {{ t('transform.relative') }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div
            class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
          >
            <span class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-red-500 select-none"
              >X</span
            >
            <input
              type="number"
              :value="
                isPositionRelative
                  ? positionState.x === 0
                    ? ''
                    : positionState.x
                  : fmt(selectionInfo.center.x)
              "
              @change="(e) => updatePosition('x', Number((e.target as HTMLInputElement).value))"
              :placeholder="isPositionRelative ? '0' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs font-medium text-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
          >
            <span class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-green-500 select-none"
              >Y</span
            >
            <input
              type="number"
              :value="
                isPositionRelative
                  ? positionState.y === 0
                    ? ''
                    : positionState.y
                  : fmt(selectionInfo.center.y)
              "
              @change="(e) => updatePosition('y', Number((e.target as HTMLInputElement).value))"
              :placeholder="isPositionRelative ? '0' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs font-medium text-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div
            class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
          >
            <span class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-blue-500 select-none"
              >Z</span
            >
            <input
              type="number"
              :value="
                isPositionRelative
                  ? positionState.z === 0
                    ? ''
                    : positionState.z
                  : fmt(selectionInfo.center.z)
              "
              @change="(e) => updatePosition('z', Number((e.target as HTMLInputElement).value))"
              :placeholder="isPositionRelative ? '0' : ''"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs font-medium text-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
      <!-- 旋转 -->
      <div class="flex flex-col items-stretch gap-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <label class="text-xs font-bold text-gray-700">{{ t('transform.rotation') }}</label>
            <TooltipProvider v-if="uiStore.workingCoordinateSystem.enabled">
              <Tooltip :delay-duration="300">
                <TooltipTrigger as-child>
                  <span class="cursor-help text-[10px] font-medium text-blue-600">{{
                    t('transform.correction')
                  }}</span>
                </TooltipTrigger>
                <TooltipContent class="text-xs" variant="light">
                  <div
                    v-html="
                      t('transform.correctionTip', {
                        angle: uiStore.workingCoordinateSystem.rotationAngle,
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
                class="h-full px-2 text-[10px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                {{ t('transform.absolute') }}
              </TabsTrigger>
              <TabsTrigger
                value="relative"
                class="h-full px-2 text-[10px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                {{ t('transform.relative') }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <!-- Roll (X) -->
          <div
            class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
          >
            <span class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-red-500 select-none"
              >X</span
            >
            <input
              type="number"
              :value="
                isRotationRelative
                  ? rotationState.x === 0
                    ? ''
                    : rotationState.x
                  : fmt(selectionInfo.rotation.x)
              "
              @change="(e) => updateRotation('x', Number((e.target as HTMLInputElement).value))"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs font-medium text-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :placeholder="isRotationRelative ? '0' : ''"
            />
          </div>
          <!-- Pitch (Y) -->
          <div
            class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
          >
            <span class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-green-500 select-none"
              >Y</span
            >
            <input
              type="number"
              :value="
                isRotationRelative
                  ? rotationState.y === 0
                    ? ''
                    : rotationState.y
                  : fmt(selectionInfo.rotation.y)
              "
              @change="(e) => updateRotation('y', Number((e.target as HTMLInputElement).value))"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs font-medium text-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :placeholder="isRotationRelative ? '0' : ''"
            />
          </div>
          <!-- Yaw (Z) -->
          <div
            class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
          >
            <span class="mr-1.5 cursor-ew-resize text-[10px] font-bold text-blue-500 select-none"
              >Z</span
            >
            <input
              type="number"
              :value="
                isRotationRelative
                  ? rotationState.z === 0
                    ? ''
                    : rotationState.z
                  : fmt(selectionInfo.rotation.z)
              "
              @change="(e) => updateRotation('z', Number((e.target as HTMLInputElement).value))"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs font-medium text-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :placeholder="isRotationRelative ? '0' : ''"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 多选范围 -->
    <div v-if="selectionInfo.bounds" class="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3">
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-gray-500">{{ t('transform.range') }}</span>
          <TooltipProvider v-if="uiStore.workingCoordinateSystem.enabled">
            <Tooltip :delay-duration="300">
              <TooltipTrigger as-child>
                <span class="cursor-help text-[10px] font-medium text-blue-600">{{
                  t('transform.workingCoord')
                }}</span>
              </TooltipTrigger>
              <TooltipContent class="text-xs" variant="light">
                <div
                  v-html="
                    t('transform.rangeTip', {
                      angle: uiStore.workingCoordinateSystem.rotationAngle,
                    })
                  "
                ></div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <!-- X Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-red-500 select-none">X</span>
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              :value="fmt(selectionInfo.bounds.min.x)"
              @change="
                (e) => updateBounds('x', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-gray-50 px-2 py-1 text-right text-xs font-medium text-gray-700 ring-1 ring-transparent transition-all outline-none hover:bg-gray-100 focus:bg-white focus:ring-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-gray-400">~</span>
            <input
              type="number"
              :value="fmt(selectionInfo.bounds.max.x)"
              @change="
                (e) => updateBounds('x', 'max', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-gray-50 px-2 py-1 text-right text-xs font-medium text-gray-700 ring-1 ring-transparent transition-all outline-none hover:bg-gray-100 focus:bg-white focus:ring-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>

        <!-- Y Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-green-500 select-none">Y</span>
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              :value="fmt(selectionInfo.bounds.min.y)"
              @change="
                (e) => updateBounds('y', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-gray-50 px-2 py-1 text-right text-xs font-medium text-gray-700 ring-1 ring-transparent transition-all outline-none hover:bg-gray-100 focus:bg-white focus:ring-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-gray-400">~</span>
            <input
              type="number"
              :value="fmt(selectionInfo.bounds.max.y)"
              @change="
                (e) => updateBounds('y', 'max', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-gray-50 px-2 py-1 text-right text-xs font-medium text-gray-700 ring-1 ring-transparent transition-all outline-none hover:bg-gray-100 focus:bg-white focus:ring-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>

        <!-- Z Axis -->
        <div class="flex items-center gap-2">
          <span class="w-3 text-[10px] font-bold text-blue-500 select-none">Z</span>
          <div class="flex flex-1 items-center gap-2">
            <input
              type="number"
              :value="fmt(selectionInfo.bounds.min.z)"
              @change="
                (e) => updateBounds('z', 'min', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-gray-50 px-2 py-1 text-right text-xs font-medium text-gray-700 ring-1 ring-transparent transition-all outline-none hover:bg-gray-100 focus:bg-white focus:ring-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span class="text-[10px] text-gray-400">~</span>
            <input
              type="number"
              :value="fmt(selectionInfo.bounds.max.z)"
              @change="
                (e) => updateBounds('z', 'max', Number((e.target as HTMLInputElement).value))
              "
              class="w-full min-w-0 flex-1 [appearance:textfield] rounded-md bg-gray-50 px-2 py-1 text-right text-xs font-medium text-gray-700 ring-1 ring-transparent transition-all outline-none hover:bg-gray-100 focus:bg-white focus:ring-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

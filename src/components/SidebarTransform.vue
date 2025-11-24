<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditorManipulation } from '../composables/editor/useEditorManipulation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Item } from '@/components/ui/item'

const editorStore = useEditorStore()
const { updateSelectedItemsTransform } = useEditorManipulation()

// 两个独立的开关，默认都开启绝对模式 (false)
const isPositionRelative = ref(false)
const isRotationRelative = ref(false)

// 旋转输入的临时状态
const rotationState = ref({ x: 0, y: 0, z: 0 })
// 位置相对输入的临时状态
const positionState = ref({ x: 0, y: 0, z: 0 })

// 监听选择变化以重置输入
watch(
  () => editorStore.selectedItemIds,
  () => {
    rotationState.value = { x: 0, y: 0, z: 0 }
    positionState.value = { x: 0, y: 0, z: 0 }
  },
  { deep: true }
)

const selectionInfo = computed(() => {
  const selected = editorStore.selectedItems
  if (selected.length === 0) return null

  // 位置中心点（用于绝对模式显示）
  const center = editorStore.getSelectedItemsCenter() || { x: 0, y: 0, z: 0 }

  // 旋转角度（用于绝对模式显示）
  let rotation = { x: 0, y: 0, z: 0 }
  if (selected.length === 1) {
    const item = selected[0]
    if (item) {
      rotation = {
        x: item.originalData.Rotation.Roll,
        y: item.originalData.Rotation.Pitch,
        z: item.originalData.Rotation.Yaw,
      }
    }
  } else {
    // 多选绝对模式显示，显示0或保持最后已知值
    rotation = rotationState.value
  }

  // 边界（最小/最大值）
  let bounds = null
  if (selected.length > 1) {
    const xs = selected.map((i) => i.x)
    const ys = selected.map((i) => i.y)
    const zs = selected.map((i) => i.z)
    bounds = {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
      size: {
        x: Math.max(...xs) - Math.min(...xs),
        y: Math.max(...ys) - Math.min(...ys),
        z: Math.max(...zs) - Math.min(...zs),
      },
    }
  }

  return {
    count: selected.length,
    center,
    rotation,
    bounds,
  }
})

// 监听选择数量，多选时强制使用相对旋转
watch(
  () => selectionInfo.value?.count,
  (count) => {
    if (count && count > 1) {
      isRotationRelative.value = true
    }
  }
)

// 更新处理函数
function updatePosition(axis: 'x' | 'y' | 'z', value: number) {
  if (!selectionInfo.value) return

  if (isPositionRelative.value) {
    // 相对模式：值为增量
    const delta = value
    if (delta === 0) return

    const posArgs: any = { x: 0, y: 0, z: 0 }
    posArgs[axis] = delta

    updateSelectedItemsTransform({
      mode: 'relative',
      position: posArgs,
    })

    // 重置输入为0
    positionState.value[axis] = 0
  } else {
    // 绝对模式
    const current = selectionInfo.value.center
    const newPos = { ...current, [axis]: value }

    updateSelectedItemsTransform({
      mode: 'absolute',
      position: newPos,
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
      const currentRotation = selectionInfo.value.rotation[axis]
      const delta = value - currentRotation

      const rotationArgs: any = {}
      rotationArgs[axis] = delta

      updateSelectedItemsTransform({
        mode: 'relative', // 计算增量并相对应用以达到绝对结果
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

// 数字格式化辅助函数
const fmt = (n: number) => Math.round(n * 100) / 100
</script>

<template>
  <Item v-if="selectionInfo" variant="outline" class="flex-col items-stretch">
    <!-- 位置 -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="text-xs font-bold text-gray-700">位置</label>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-gray-400">{{ isPositionRelative ? '相对' : '绝对' }}</span>
          <Switch v-model="isPositionRelative" class="scale-75" />
        </div>
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
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip :delay-duration="300">
              <TooltipTrigger as-child>
                <div class="flex cursor-help items-center gap-1">
                  <label
                    class="border-b border-dashed border-gray-300 text-xs font-bold text-gray-700"
                    >旋转 (°)</label
                  >
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" class="text-xs" variant="light">
                <p class="mb-1 font-semibold">旋转轴说明:</p>
                <ul class="space-y-1">
                  <li>
                    <span class="font-bold text-red-500">R</span> (Roll) 翻滚角 &rarr; 绕
                    <span class="font-bold text-red-500">X</span> 轴
                  </li>
                  <li>
                    <span class="font-bold text-green-500">P</span> (Pitch) 俯仰角 &rarr; 绕
                    <span class="font-bold text-green-500">Y</span> 轴
                  </li>
                  <li>
                    <span class="font-bold text-blue-500">Y</span> (Yaw) 偏航角 &rarr; 绕
                    <span class="font-bold text-blue-500">Z</span> 轴
                  </li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-gray-400">{{ isRotationRelative ? '相对' : '绝对' }}</span>
          <Switch
            v-model="isRotationRelative"
            :disabled="selectionInfo?.count > 1"
            class="scale-75"
          />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <!-- Roll (X) -->
        <div
          class="group relative flex items-center rounded-md bg-gray-50 px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-white focus-within:ring-blue-500 hover:bg-gray-100"
        >
          <div
            class="mr-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-600 select-none"
          >
            R
          </div>
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
          <div
            class="mr-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-[10px] font-bold text-green-600 select-none"
          >
            P
          </div>
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
          <div
            class="mr-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-600 select-none"
          >
            Y
          </div>
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

    <!-- 多选包围盒 -->
    <div v-if="selectionInfo.bounds" class="mt-2 space-y-2 border-t border-gray-100 pt-2">
      <div class="text-xs font-medium text-gray-500">包围盒尺寸</div>
      <div class="grid grid-cols-3 gap-2 text-[10px] text-gray-600">
        <div class="flex flex-col items-center rounded bg-gray-50 p-1">
          <span class="font-bold text-gray-400">宽(X)</span>
          <span>{{ fmt(selectionInfo.bounds.size.x) }}</span>
        </div>
        <div class="flex flex-col items-center rounded bg-gray-50 p-1">
          <span class="font-bold text-gray-400">长(Y)</span>
          <span>{{ fmt(selectionInfo.bounds.size.y) }}</span>
        </div>
        <div class="flex flex-col items-center rounded bg-gray-50 p-1">
          <span class="font-bold text-gray-400">高(Z)</span>
          <span>{{ fmt(selectionInfo.bounds.size.z) }}</span>
        </div>
      </div>

      <div class="mt-2 text-xs font-medium text-gray-500">范围 (Min ~ Max)</div>
      <div class="space-y-1 text-xs text-gray-600">
        <div class="flex justify-between border-b border-gray-50 pb-0.5">
          <span class="font-bold text-red-400">X</span>
          <span class="font-mono"
            >{{ fmt(selectionInfo.bounds.min.x) }} ~ {{ fmt(selectionInfo.bounds.max.x) }}</span
          >
        </div>
        <div class="flex justify-between border-b border-gray-50 pb-0.5">
          <span class="font-bold text-green-400">Y</span>
          <span class="font-mono"
            >{{ fmt(selectionInfo.bounds.min.y) }} ~ {{ fmt(selectionInfo.bounds.max.y) }}</span
          >
        </div>
        <div class="flex justify-between border-b border-gray-50 pb-0.5">
          <span class="font-bold text-blue-400">Z</span>
          <span class="font-mono"
            >{{ fmt(selectionInfo.bounds.min.z) }} ~ {{ fmt(selectionInfo.bounds.max.z) }}</span
          >
        </div>
      </div>
    </div>
  </Item>
</template>

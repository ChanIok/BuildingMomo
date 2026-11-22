<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'

interface Props {
  modelValue: { x: number; y: number; z: number }
  mode: 'absolute' | 'relative'
  defaultValue?: number // 相对模式的默认值（位置=0，缩放=1）
  axes?: ('x' | 'y' | 'z')[] // 可选显示哪些轴
  disabled?: Partial<Record<'x' | 'y' | 'z', boolean>>
  cols?: 2 | 3 // 列数布局
  formatter?: (value: number) => number | string // 显示格式化
}

const props = withDefaults(defineProps<Props>(), {
  defaultValue: 0,
  axes: () => ['x', 'y', 'z'],
  disabled: () => ({}),
  cols: 2,
  formatter: (v: number) => v,
})

const emit = defineEmits<{
  (e: 'update:x', value: number): void
  (e: 'update:y', value: number): void
  (e: 'update:z', value: number): void
}>()

// 内部维护 input 显示值，解决 Vue 响应式 + input 同步问题
const inputValues = ref({ x: '', y: '', z: '' })

// 计算显示值
function computeDisplayValue(axis: 'x' | 'y' | 'z'): string {
  const value = props.modelValue[axis]
  if (props.mode === 'relative' && value === props.defaultValue) {
    return ''
  }
  return String(props.formatter(value))
}

// 监听 props 变化，同步内部状态
watch(
  () => [props.modelValue.x, props.modelValue.y, props.modelValue.z, props.mode],
  () => {
    inputValues.value.x = computeDisplayValue('x')
    inputValues.value.y = computeDisplayValue('y')
    inputValues.value.z = computeDisplayValue('z')
  },
  { immediate: true }
)

// 显示的轴
const visibleAxes = computed(() => {
  return props.axes.filter((axis) => !props.disabled[axis])
})

// 网格列数样式
const gridClass = computed(() => {
  return props.cols === 3 ? 'grid-cols-3' : 'grid-cols-2'
})

// 获取占位符
function getPlaceholder(): string {
  return props.mode === 'relative' ? String(props.defaultValue) : ''
}

// 更新值
function updateValue(axis: 'x' | 'y' | 'z', event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (axis === 'x') {
    emit('update:x', value)
  } else if (axis === 'y') {
    emit('update:y', value)
  } else {
    emit('update:z', value)
  }
  // 在 emit 后，等待父组件更新 props，然后同步显示值
  nextTick(() => {
    inputValues.value[axis] = computeDisplayValue(axis)
  })
}

// 轴颜色配置
const axisColors = {
  x: 'text-red-500 dark:text-red-500/90',
  y: 'text-green-500 dark:text-green-500/90',
  z: 'text-blue-500 dark:text-blue-500/90',
}
</script>

<template>
  <div class="grid gap-2" :class="gridClass">
    <template v-for="axis in visibleAxes" :key="axis">
      <div
        class="group relative flex items-center rounded-md bg-sidebar-accent px-2 py-1 ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-ring hover:bg-accent"
      >
        <span
          class="mr-1.5 cursor-ew-resize text-[10px] font-bold select-none"
          :class="axisColors[axis]"
        >
          {{ axis.toUpperCase() }}
        </span>
        <input
          type="number"
          step="any"
          v-model="inputValues[axis]"
          @change="(e) => updateValue(axis, e)"
          :placeholder="getPlaceholder()"
          class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
    </template>
  </div>
</template>

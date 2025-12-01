<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useUIStore } from '../stores/uiStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const uiStore = useUIStore()

// 坐标系角度（默认为 0）
const workingAngle = ref<number>(0)

// 当对话框打开时，填充当前状态
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (uiStore.workingCoordinateSystem.enabled) {
        workingAngle.value = uiStore.workingCoordinateSystem.rotationAngle
      } else {
        workingAngle.value = 0
      }
    }
  }
)

// 计算坐标轴显示角度
const displayAngle = computed(() => {
  return workingAngle.value
})

const angleRad = computed(() => (displayAngle.value * Math.PI) / 180)

// SVG 坐标轴的端点（箭头长度为 40，比原来的 25 稍大）
const xAxisEnd = computed(() => ({
  x: 40 * Math.cos(angleRad.value),
  y: 40 * Math.sin(angleRad.value),
}))

const yAxisEnd = computed(() => ({
  x: 40 * Math.cos(angleRad.value + Math.PI / 2),
  y: 40 * Math.sin(angleRad.value + Math.PI / 2),
}))

// 文字标签位置（稍微偏移）
const xLabelPos = computed(() => ({
  x: xAxisEnd.value.x + (xAxisEnd.value.x > 0 ? 10 : -10),
  y: xAxisEnd.value.y + 5,
}))

const yLabelPos = computed(() => ({
  x: yAxisEnd.value.x + (yAxisEnd.value.x > 0 ? 10 : -10),
  y: yAxisEnd.value.y + 5,
}))

// 确认按钮处理
function handleConfirm() {
  if (workingAngle.value === 0) {
    uiStore.setWorkingCoordinateSystem(false, 0)
  } else {
    uiStore.setWorkingCoordinateSystem(true, workingAngle.value)
  }
  emit('update:open', false)
}

// 取消按钮处理
function handleCancel() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[450px]">
      <DialogHeader>
        <DialogTitle>{{ t('coordinate.title') }}</DialogTitle>
        <DialogDescription> {{ t('coordinate.description') }} </DialogDescription>
      </DialogHeader>

      <div class="grid gap-6 py-4">
        <!-- 坐标系可视化 -->
        <div class="flex justify-center">
          <div class="rounded-lg bg-gray-50 p-4">
            <div class="mb-2 text-center text-sm font-medium text-gray-700">
              {{
                workingAngle === 0
                  ? t('coordinate.globalLabel')
                  : t('coordinate.workingLabel', { angle: workingAngle })
              }}
            </div>
            <svg width="120" height="120" viewBox="-60 -60 120 120" class="mx-auto">
              <!-- 背景圆 -->
              <circle cx="0" cy="0" r="50" fill="white" stroke="#e5e7eb" stroke-width="1.5" />

              <!-- 原点 -->
              <circle cx="0" cy="0" r="3" fill="#6b7280" />

              <!-- 箭头标记定义 -->
              <defs>
                <marker
                  id="arrowRed"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="#ef4444" />
                </marker>
                <marker
                  id="arrowGreen"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="#22c55e" />
                </marker>
              </defs>

              <!-- X 轴（红色）-->
              <line
                x1="0"
                y1="0"
                :x2="xAxisEnd.x"
                :y2="xAxisEnd.y"
                stroke="#ef4444"
                stroke-width="3"
                marker-end="url(#arrowRed)"
              />
              <text
                :x="xLabelPos.x"
                :y="xLabelPos.y"
                fill="#ef4444"
                font-size="16"
                font-weight="bold"
                text-anchor="middle"
                dominant-baseline="middle"
              >
                X
              </text>

              <!-- Y 轴（绿色）-->
              <line
                x1="0"
                y1="0"
                :x2="yAxisEnd.x"
                :y2="yAxisEnd.y"
                stroke="#22c55e"
                stroke-width="3"
                marker-end="url(#arrowGreen)"
              />
              <text
                :x="yLabelPos.x"
                :y="yLabelPos.y"
                fill="#22c55e"
                font-size="16"
                font-weight="bold"
                text-anchor="middle"
                dominant-baseline="middle"
              >
                Y
              </text>
            </svg>
          </div>
        </div>

        <!-- 工作坐标系角度调整 -->
        <div class="grid gap-3">
          <Label class="text-sm font-medium">{{ t('coordinate.rotationLabel') }}</Label>
          <div class="flex items-center gap-2">
            <Input v-model.number="workingAngle" type="number" class="h-9 w-24" />
            <span class="text-sm text-muted-foreground">{{ t('coordinate.unit') }}</span>
          </div>

          <!-- 快捷角度按钮 -->
          <div class="grid grid-cols-5 gap-2">
            <Button
              size="sm"
              variant="outline"
              :class="{ 'border-blue-500 bg-blue-50': workingAngle === -45 }"
              @click="workingAngle = -45"
            >
              -45°
            </Button>
            <Button
              size="sm"
              variant="outline"
              :class="{ 'border-blue-500 bg-blue-50': workingAngle === -30 }"
              @click="workingAngle = -30"
            >
              -30°
            </Button>
            <Button
              size="sm"
              variant="outline"
              :class="{ 'border-blue-500 bg-blue-50': workingAngle === 0 }"
              @click="workingAngle = 0"
            >
              0°
            </Button>
            <Button
              size="sm"
              variant="outline"
              :class="{ 'border-blue-500 bg-blue-50': workingAngle === 30 }"
              @click="workingAngle = 30"
            >
              30°
            </Button>
            <Button
              size="sm"
              variant="outline"
              :class="{ 'border-blue-500 bg-blue-50': workingAngle === 45 }"
              @click="workingAngle = 45"
            >
              45°
            </Button>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button @click="handleConfirm">{{ t('common.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useUIStore } from '../stores/uiStore'
import { useEditorStore } from '../stores/editorStore'
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
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Kbd } from '@/components/ui/kbd'
import { RotateCcw } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const uiStore = useUIStore()
const editorStore = useEditorStore()

// 三轴旋转角度
const rotationX = ref<number>(0)
const rotationY = ref<number>(0)
const rotationZ = ref<number>(0)

// 局部坐标系开关
const useLocalSpace = ref<boolean>(false)

// 当对话框打开时，填充当前状态
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      const ws = uiStore.workingCoordinateSystem
      if (ws.enabled) {
        rotationX.value = ws.rotation.x
        rotationY.value = ws.rotation.y
        rotationZ.value = ws.rotation.z
      } else {
        rotationX.value = 0
        rotationY.value = 0
        rotationZ.value = 0
      }
      useLocalSpace.value = uiStore.gizmoSpace === 'local'
    }
  }
)

// 检查是否有单个选中物体
const hasSelectedSingleItem = computed(() => {
  return editorStore.activeScheme?.selectedItemIds.value.size === 1
})

// 从选中物体设置
function setFromSelection() {
  const scheme = editorStore.activeScheme
  if (!scheme) return

  const selectedIds = Array.from(scheme.selectedItemIds.value)
  if (selectedIds.length !== 1) return

  const firstId = selectedIds[0]
  if (!firstId) return

  const item = editorStore.itemsMap.get(firstId)
  if (item) {
    rotationX.value = item.rotation.x
    rotationY.value = item.rotation.y
    rotationZ.value = item.rotation.z
  }
}

// 重置旋转
function resetRotation() {
  rotationX.value = 0
  rotationY.value = 0
  rotationZ.value = 0
}

// Input 输入处理
function handleRotationInput(axis: 'x' | 'y' | 'z', event: Event) {
  const input = event.target as HTMLInputElement
  let value = parseInt(input.value)

  // 验证范围
  if (isNaN(value)) value = 0
  if (value < -180) value = -180
  if (value > 180) value = 180

  if (axis === 'x') rotationX.value = value
  else if (axis === 'y') rotationY.value = value
  else rotationZ.value = value
}

// 确认按钮处理
function handleConfirm() {
  // 保存 gizmoSpace
  uiStore.gizmoSpace = useLocalSpace.value ? 'local' : 'world'

  // 保存工作坐标系（全零时自动禁用）
  const allZero = rotationX.value === 0 && rotationY.value === 0 && rotationZ.value === 0

  uiStore.setWorkingCoordinateSystem(!allZero, {
    x: rotationX.value,
    y: rotationY.value,
    z: rotationZ.value,
  })

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
        <DialogDescription>{{ t('coordinate.description') }}</DialogDescription>
      </DialogHeader>

      <div class="grid gap-6 py-4">
        <!-- 局部坐标系开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="flex items-center gap-2 text-sm font-medium">
              {{ t('coordinate.localSpace') }}
              <Kbd>X</Kbd>
            </Label>
            <p class="text-xs text-muted-foreground">
              {{ t('coordinate.localSpaceHint') }}
            </p>
          </div>
          <Switch v-model="useLocalSpace" />
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-border"></div>

        <!-- 工作坐标系旋转 -->
        <div class="grid gap-4">
          <div class="flex items-center justify-between">
            <Label class="text-sm font-medium">{{ t('coordinate.workingRotation') }}</Label>
            <Button
              @click="resetRotation"
              variant="ghost"
              size="icon-sm"
              class="h-6 w-6"
              :title="t('coordinate.resetRotation')"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
          </div>

          <!-- X 轴 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">{{ t('coordinate.axisX') }}</Label>
              <Input
                :model-value="rotationX"
                @blur="(e: Event) => handleRotationInput('x', e)"
                type="number"
                min="-180"
                max="180"
                size="xs"
                class="w-16 text-center [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <Slider
              :model-value="[rotationX]"
              @update:model-value="(v) => (rotationX = v?.[0] ?? 0)"
              :min="-180"
              :max="180"
              :step="5"
              class="w-full"
            />
          </div>

          <!-- Y 轴 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">{{ t('coordinate.axisY') }}</Label>
              <Input
                :model-value="rotationY"
                @blur="(e: Event) => handleRotationInput('y', e)"
                type="number"
                min="-180"
                max="180"
                size="xs"
                class="w-16 text-center [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <Slider
              :model-value="[rotationY]"
              @update:model-value="(v) => (rotationY = v?.[0] ?? 0)"
              :min="-180"
              :max="180"
              :step="5"
              class="w-full"
            />
          </div>

          <!-- Z 轴 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">{{ t('coordinate.axisZ') }}</Label>
              <Input
                :model-value="rotationZ"
                @blur="(e: Event) => handleRotationInput('z', e)"
                type="number"
                min="-180"
                max="180"
                size="xs"
                class="w-16 text-center [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <Slider
              :model-value="[rotationZ]"
              @update:model-value="(v) => (rotationZ = v?.[0] ?? 0)"
              :min="-180"
              :max="180"
              :step="5"
              class="w-full"
            />
          </div>
        </div>

        <!-- 从选中物体设置 -->
        <Button
          v-if="hasSelectedSingleItem"
          @click="setFromSelection"
          variant="outline"
          size="sm"
          class="gap-2"
        >
          {{ t('coordinate.setFromSelection') }}
          <Kbd>Z</Kbd>
        </Button>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button @click="handleConfirm">{{ t('common.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

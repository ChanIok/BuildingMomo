<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const editorStore = useEditorStore()

// 表单数据
const mode = ref<'relative' | 'absolute'>('relative')

// 坐标系选择
const coordinateMode = ref<'global' | 'working'>('global')
const workingAngle = ref<number>(0)

// 位置输入
const posX = ref<string>('')
const posY = ref<string>('')
const posZ = ref<string>('')

// 旋转输入（绕X/Y/Z轴）
const rotX = ref<string>('')
const rotY = ref<string>('')
const rotZ = ref<string>('')

// 计算当前选中物品的中心坐标
const selectedCenter = computed(() => {
  return editorStore.getSelectedItemsCenter()
})

// 显示的提示信息
const centerHint = computed(() => {
  if (mode.value === 'absolute' && selectedCenter.value) {
    const { x, y, z } = selectedCenter.value
    return `当前中心: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`
  }
  return ''
})

// 计算全局坐标系下的位移（用于预览）
const globalDelta = computed(() => {
  const dx = parseInputValue(posX.value) ?? 0
  const dy = parseInputValue(posY.value) ?? 0
  const dz = parseInputValue(posZ.value) ?? 0

  if (coordinateMode.value === 'global') {
    return { x: dx, y: dy, z: dz }
  }

  // 工作坐标系 -> 全局坐标系转换
  const angleRad = (workingAngle.value * Math.PI) / 180
  return {
    x: dx * Math.cos(angleRad) - dy * Math.sin(angleRad),
    y: dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
    z: dz,
  }
})

// 当对话框打开时，重置表单并填充默认值
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm()
      // 如果当前有激活的工作坐标系，使用它
      if (editorStore.workingCoordinateSystem.enabled) {
        coordinateMode.value = 'working'
        workingAngle.value = editorStore.workingCoordinateSystem.rotationAngle
      } else {
        coordinateMode.value = 'global'
      }
    }
  }
)

// 重置表单
function resetForm() {
  mode.value = 'relative'
  posX.value = ''
  posY.value = ''
  posZ.value = ''
  rotX.value = ''
  rotY.value = ''
  rotZ.value = ''
}

// 解析输入值（允许空值）
function parseInputValue(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const num = parseFloat(value)
  return isNaN(num) ? undefined : num
}

// 验证表单（至少有一个字段有值）
function validateForm(): boolean {
  const hasPosition = !!(posX.value || posY.value || posZ.value)
  const hasRotation = !!(rotX.value || rotY.value || rotZ.value)
  return hasPosition || hasRotation
}

// 确认按钮处理
function handleConfirm() {
  if (!validateForm()) {
    return
  }

  // 解析位置值
  let position:
    | {
        x?: number
        y?: number
        z?: number
      }
    | undefined

  if (posX.value || posY.value || posZ.value) {
    if (coordinateMode.value === 'working') {
      // 工作坐标系模式：需要转换到全局坐标系
      position = {
        x: globalDelta.value.x || undefined,
        y: globalDelta.value.y || undefined,
        z: globalDelta.value.z || undefined,
      }
    } else {
      // 全局坐标系模式：直接使用
      position = {
        x: parseInputValue(posX.value),
        y: parseInputValue(posY.value),
        z: parseInputValue(posZ.value),
      }
    }
  }

  // 解析旋转值
  const rotation =
    rotX.value || rotY.value || rotZ.value
      ? {
          x: parseInputValue(rotX.value),
          y: parseInputValue(rotY.value),
          z: parseInputValue(rotZ.value),
        }
      : undefined

  // 调用 store 方法
  editorStore.updateSelectedItemsTransform({
    mode: mode.value,
    position,
    rotation,
  })

  // 关闭对话框
  emit('update:open', false)
}

// 取消按钮处理
function handleCancel() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>移动和旋转</DialogTitle>
        <DialogDescription> 设置物品的位置和旋转角度。空值表示保持原值不变。 </DialogDescription>
      </DialogHeader>

      <div class="grid gap-6 py-4">
        <!-- 坐标系选择 -->
        <div class="rounded-lg border bg-muted/50 p-3">
          <Label class="text-sm font-medium">坐标系</Label>
          <RadioGroup v-model="coordinateMode" class="mt-2">
            <div class="flex items-center space-x-2">
              <RadioGroupItem id="global" value="global" />
              <Label for="global" class="cursor-pointer text-sm font-normal">全局坐标系</Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem id="working" value="working" />
              <Label for="working" class="cursor-pointer text-sm font-normal">
                工作坐标系（旋转 {{ workingAngle }}°）
              </Label>
            </div>
          </RadioGroup>

          <!-- 工作坐标系角度调整 -->
          <div v-if="coordinateMode === 'working'" class="mt-3 space-y-2">
            <Label class="text-xs">旋转角度</Label>
            <div class="flex items-center gap-2">
              <Input v-model.number="workingAngle" type="number" class="h-8 w-20 text-sm" />
              <span class="text-xs text-muted-foreground">度</span>
              <div class="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 px-2 text-xs"
                  @click="workingAngle = 0"
                >
                  0°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 px-2 text-xs"
                  @click="workingAngle = 45"
                >
                  45°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 px-2 text-xs"
                  @click="workingAngle = 90"
                >
                  90°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 px-2 text-xs"
                  @click="workingAngle = 135"
                >
                  135°
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- 模式选择 -->
        <div class="grid gap-2">
          <Label>移动模式</Label>
          <RadioGroup v-model="mode">
            <div class="flex items-center space-x-2">
              <RadioGroupItem id="relative" value="relative" />
              <Label for="relative" class="cursor-pointer font-normal">
                相对移动（在当前位置基础上偏移）
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem id="absolute" value="absolute" />
              <Label for="absolute" class="cursor-pointer font-normal">
                绝对移动（移动到指定坐标）
              </Label>
            </div>
          </RadioGroup>
        </div>

        <!-- 位置输入 -->
        <div class="grid gap-3">
          <div class="flex items-center justify-between">
            <Label class="text-base font-medium">
              位置
              <span
                v-if="coordinateMode === 'working'"
                class="ml-1 text-xs font-normal text-blue-600"
              >
                (工作坐标系)
              </span>
            </Label>
            <span v-if="centerHint" class="text-xs text-muted-foreground">{{ centerHint }}</span>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="grid gap-1.5">
              <Label for="pos-x" class="text-xs">X</Label>
              <Input
                id="pos-x"
                v-model="posX"
                type="text"
                placeholder="0"
                @keydown.enter="handleConfirm"
              />
            </div>
            <div class="grid gap-1.5">
              <Label for="pos-y" class="text-xs">Y</Label>
              <Input
                id="pos-y"
                v-model="posY"
                type="text"
                placeholder="0"
                @keydown.enter="handleConfirm"
              />
            </div>
            <div class="grid gap-1.5">
              <Label for="pos-z" class="text-xs">Z</Label>
              <Input
                id="pos-z"
                v-model="posZ"
                type="text"
                placeholder="0"
                @keydown.enter="handleConfirm"
              />
            </div>
          </div>

          <!-- 坐标转换预览 -->
          <div
            v-if="coordinateMode === 'working' && (posX || posY || posZ)"
            class="rounded-md bg-blue-50 px-3 py-2 text-xs"
          >
            <div class="font-medium text-blue-900">转换预览：</div>
            <div class="mt-1 text-blue-700">
              工作坐标系: ({{ posX || 0 }}, {{ posY || 0 }}, {{ posZ || 0 }})
            </div>
            <div class="text-blue-700">
              → 全局坐标系: ({{ globalDelta.x.toFixed(2) }}, {{ globalDelta.y.toFixed(2) }},
              {{ globalDelta.z.toFixed(2) }})
            </div>
          </div>
        </div>

        <!-- 旋转输入 -->
        <div class="grid gap-3">
          <Label class="text-base font-medium">旋转</Label>
          <div class="grid grid-cols-3 gap-3">
            <div class="grid gap-1.5">
              <Label for="rot-x" class="text-xs">绕X轴</Label>
              <div class="relative">
                <Input
                  id="rot-x"
                  v-model="rotX"
                  type="text"
                  placeholder="0"
                  class="pr-6"
                  @keydown.enter="handleConfirm"
                />
                <span
                  class="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground"
                  >°</span
                >
              </div>
            </div>
            <div class="grid gap-1.5">
              <Label for="rot-y" class="text-xs">绕Y轴</Label>
              <div class="relative">
                <Input
                  id="rot-y"
                  v-model="rotY"
                  type="text"
                  placeholder="0"
                  class="pr-6"
                  @keydown.enter="handleConfirm"
                />
                <span
                  class="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground"
                  >°</span
                >
              </div>
            </div>
            <div class="grid gap-1.5">
              <Label for="rot-z" class="text-xs">绕Z轴</Label>
              <div class="relative">
                <Input
                  id="rot-z"
                  v-model="rotZ"
                  type="text"
                  placeholder="0"
                  class="pr-6"
                  @keydown.enter="handleConfirm"
                />
                <span
                  class="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground"
                  >°</span
                >
              </div>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">取消</Button>
        <Button @click="handleConfirm" :disabled="!validateForm()">确定</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

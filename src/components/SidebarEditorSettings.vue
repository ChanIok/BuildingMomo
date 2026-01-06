<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

const settingsStore = useSettingsStore()
const { t } = useI18n()

// FOV 节流处理
const fovValue = ref(settingsStore.settings.cameraFov)
const handleFovChange = useThrottleFn((value: number[] | undefined) => {
  if (!value) return
  const newValue = value[0]!
  fovValue.value = newValue
  settingsStore.settings.cameraFov = newValue
}, 100)

// 监听 settings 变化，同步 fovValue
watch(
  () => settingsStore.settings.cameraFov,
  (newVal) => {
    if (fovValue.value !== newVal) {
      fovValue.value = newVal
    }
  }
)

// 其他相机参数的更新函数
function updateCameraBaseSpeed(value: number[] | undefined) {
  if (!value) return
  settingsStore.settings.cameraBaseSpeed = value[0]!
}

function updateCameraShiftMultiplier(value: number[] | undefined) {
  if (!value) return
  settingsStore.settings.cameraShiftMultiplier = value[0]!
}

function updateCameraMouseSensitivity(value: number[] | undefined) {
  if (!value) return
  settingsStore.settings.cameraMouseSensitivity = value[0]!
}

function updateCameraZoomSpeed(value: number[] | undefined) {
  if (!value) return
  settingsStore.settings.cameraZoomSpeed = value[0]!
}

// 步进预设档位
const TRANSLATION_SNAP_PRESETS = [0, 1, 5, 10, 50, 100, 500, 1000]
const ROTATION_SNAP_PRESETS = [0, 1, 5, 15, 30, 45, 90] // 角度

// 工具函数：从值找到最近的预设索引
function findClosestPresetIndex(value: number, presets: number[]): number {
  if (value <= 0 || presets.length === 0) return 0
  let closestIndex = 0
  let minDiff = Math.abs((presets[0] ?? 0) - value)

  for (let i = 1; i < presets.length; i++) {
    const diff = Math.abs((presets[i] ?? 0) - value)
    if (diff < minDiff) {
      minDiff = diff
      closestIndex = i
    }
  }
  return closestIndex
}

// 计算属性：平移步进的滑块索引
const translationSnapIndex = computed(() => {
  return findClosestPresetIndex(settingsStore.settings.translationSnap, TRANSLATION_SNAP_PRESETS)
})

// 计算属性：旋转步进的滑块索引
const rotationSnapIndex = computed(() => {
  const degrees =
    settingsStore.settings.rotationSnap > 0
      ? Math.round((settingsStore.settings.rotationSnap * 180) / Math.PI)
      : 0
  return findClosestPresetIndex(degrees, ROTATION_SNAP_PRESETS)
})

// 步进设置的更新函数
function updateTranslationSnap(value: number[] | undefined) {
  if (!value) return
  const index = Math.round(value[0]!)
  settingsStore.settings.translationSnap = TRANSLATION_SNAP_PRESETS[index] || 0
}

function updateRotationSnap(value: number[] | undefined) {
  if (!value) return
  const index = Math.round(value[0]!)
  const degrees = ROTATION_SNAP_PRESETS[index] || 0
  // 角度转弧度
  settingsStore.settings.rotationSnap = degrees > 0 ? (degrees * Math.PI) / 180 : 0
}

// Input 框的输入验证和更新
function handleTranslationSnapInput(event: Event) {
  const input = event.target as HTMLInputElement
  let value = parseInt(input.value)

  // 验证范围
  if (isNaN(value) || value < 0) value = 0
  if (value > 10000) value = 10000

  settingsStore.settings.translationSnap = value
}

function handleRotationSnapInput(event: Event) {
  const input = event.target as HTMLInputElement
  let degrees = parseInt(input.value)

  // 验证范围
  if (isNaN(degrees) || degrees < 0) degrees = 0
  if (degrees > 180) degrees = 180

  // 角度转弧度
  settingsStore.settings.rotationSnap = degrees > 0 ? (degrees * Math.PI) / 180 : 0
}

// 计算属性：旋转步进的角度值（用于 Input 显示）
const rotationSnapDegrees = computed(() => {
  const radians = settingsStore.settings.rotationSnap
  return radians > 0 ? Math.round((radians * 180) / Math.PI) : 0
})

// 格式化函数
const fmt = (n: number, decimals: number = 0) => {
  if (decimals === 0) return Math.round(n).toString()
  return n.toFixed(decimals)
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden p-4 pr-0">
    <ScrollArea class="h-full">
      <div class="flex flex-col gap-4 pr-4">
        <!-- 相机设置 -->
        <div class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.camera.label') }}
          </h3>

          <!-- FOV 滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.camera.fov') }}
              </Label>
              <span class="shrink-0 text-xs font-medium text-sidebar-foreground"
                >{{ fovValue }}°</span
              >
            </div>
            <Slider
              :model-value="[fovValue]"
              @update:model-value="handleFovChange"
              :min="30"
              :max="120"
              :step="5"
              variant="thin"
              class="w-full"
            />
          </div>

          <!-- 移动速度滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.camera.baseSpeed') }}
              </Label>
              <span class="shrink-0 text-xs font-medium text-sidebar-foreground">
                {{ fmt(settingsStore.settings.cameraBaseSpeed) }}
              </span>
            </div>
            <Slider
              :model-value="[settingsStore.settings.cameraBaseSpeed]"
              @update:model-value="updateCameraBaseSpeed"
              :min="50"
              :max="2000"
              :step="50"
              variant="thin"
              class="w-full"
            />
          </div>

          <!-- 速度倍率滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.camera.shiftMultiplier') }}
              </Label>
              <span class="shrink-0 text-xs font-medium text-sidebar-foreground">
                {{ fmt(settingsStore.settings.cameraShiftMultiplier, 1) }}×
              </span>
            </div>
            <Slider
              :model-value="[settingsStore.settings.cameraShiftMultiplier]"
              @update:model-value="updateCameraShiftMultiplier"
              :min="2"
              :max="10"
              :step="0.5"
              variant="thin"
              class="w-full"
            />
          </div>

          <!-- 鼠标灵敏度滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.camera.mouseSensitivity') }}
              </Label>
              <span class="shrink-0 text-xs font-medium text-sidebar-foreground">
                {{ fmt(settingsStore.settings.cameraMouseSensitivity, 4) }}
              </span>
            </div>
            <Slider
              :model-value="[settingsStore.settings.cameraMouseSensitivity]"
              @update:model-value="updateCameraMouseSensitivity"
              :min="0.0005"
              :max="0.005"
              :step="0.0001"
              variant="thin"
              class="w-full"
            />
          </div>

          <!-- 缩放速度滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.camera.zoomSpeed') }}
              </Label>
              <span class="shrink-0 text-xs font-medium text-sidebar-foreground">
                {{ fmt(settingsStore.settings.cameraZoomSpeed, 1) }}
              </span>
            </div>
            <Slider
              :model-value="[settingsStore.settings.cameraZoomSpeed]"
              @update:model-value="updateCameraZoomSpeed"
              :min="0.5"
              :max="5.0"
              :step="0.1"
              variant="thin"
              class="w-full"
            />
          </div>
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-sidebar-border"></div>

        <!-- 步进设置 -->
        <div class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.snap.label') }}
          </h3>

          <!-- 平移步进滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.snap.translationStep') }}
              </Label>
              <Input
                v-if="settingsStore.settings.translationSnap > 0"
                :model-value="settingsStore.settings.translationSnap"
                @blur="handleTranslationSnapInput"
                type="number"
                min="0"
                max="10000"
                size="xs"
                class="w-14 text-right [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&:focus-visible]:shadow-none [&:focus-visible]:ring-0"
              />
              <span
                v-else
                class="flex h-6 shrink-0 items-center text-xs font-medium text-sidebar-foreground"
              >
                {{ t('sidebar.snap.disabled') }}
              </span>
            </div>
            <Slider
              :model-value="[translationSnapIndex]"
              @update:model-value="updateTranslationSnap"
              :min="0"
              :max="7"
              :step="1"
              variant="thin"
              class="w-full"
            />
            <p class="text-[10px] text-muted-foreground">
              {{ t('sidebar.snap.translationStepHint') }}
            </p>
          </div>

          <!-- 旋转步进滑块 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('sidebar.snap.rotationStep') }}
              </Label>
              <div v-if="settingsStore.settings.rotationSnap > 0" class="flex items-center gap-1">
                <Input
                  :model-value="rotationSnapDegrees"
                  @blur="handleRotationSnapInput"
                  type="number"
                  min="0"
                  max="180"
                  size="xs"
                  class="w-12 text-right [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&:focus-visible]:shadow-none [&:focus-visible]:ring-0"
                />
                <span class="text-xs text-muted-foreground">°</span>
              </div>
              <span
                v-else
                class="flex h-6 shrink-0 items-center text-xs font-medium text-sidebar-foreground"
              >
                {{ t('sidebar.snap.disabled') }}
              </span>
            </div>
            <Slider
              :model-value="[rotationSnapIndex]"
              @update:model-value="updateRotationSnap"
              :min="0"
              :max="6"
              :step="1"
              variant="thin"
              class="w-full"
            />
            <p class="text-[10px] text-muted-foreground">
              {{ t('sidebar.snap.rotationStepHint') }}
            </p>
          </div>
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-sidebar-border"></div>

        <!-- 显示设置 -->
        <div class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.display.label') }}
          </h3>

          <!-- 家具Tooltip开关 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="text-xs">{{ t('settings.furnitureTooltip.label') }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.furnitureTooltip.hint') }}
              </p>
            </div>
            <Switch v-model="settingsStore.settings.showFurnitureTooltip" />
          </div>

          <!-- 背景图开关 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="text-xs">{{ t('settings.background.label') }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.background.hint') }}
              </p>
            </div>
            <Switch v-model="settingsStore.settings.showBackground" />
          </div>
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-sidebar-border"></div>

        <!-- 编辑辅助 -->
        <div class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.editAssist.label') }}
          </h3>

          <!-- 重复物品检测开关 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="text-xs">{{ t('settings.duplicateDetection.label') }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.duplicateDetection.hint') }}
              </p>
            </div>
            <Switch v-model="settingsStore.settings.enableDuplicateDetection" />
          </div>

          <!-- 限制检测开关 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="text-xs">{{ t('settings.limitDetection.label') }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.limitDetection.hint') }}
              </p>
            </div>
            <Switch v-model="settingsStore.settings.enableLimitDetection" />
          </div>
        </div>
      </div>

      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
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
              :max="90"
              :step="1"
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
              :min="100"
              :max="5000"
              :step="100"
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

<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { useI18n } from '@/composables/useI18n'
import { furnitureRender } from '@/composables/useFurnitureRender'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupButton } from '@/components/ui/radio-group'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CircleAlert, Clock } from 'lucide-vue-next'

const settingsStore = useSettingsStore()
const gameDataStore = useGameDataStore()
const loadingStore = useLoadingStore()
const preparingEnvironment = computed(
  () => loadingStore.isLoading && loadingStore.loadingType === 'environment'
)
const preparingRender = computed(
  () => loadingStore.isLoading && loadingStore.loadingType !== 'icon'
)
const { t } = useI18n()
const resourceStats = shallowRef({ materials: 0, models: 0, shaders: 0, canClearCache: false })

function refreshResourceStats() {
  resourceStats.value = furnitureRender.value?.getResourceStats() ?? {
    materials: 0,
    models: 0,
    shaders: 0,
    canClearCache: false,
  }
}

function clearRenderCache() {
  if (preparingRender.value || !furnitureRender.value) return
  furnitureRender.value.clearUnused()
  refreshResourceStats()
}

watch(furnitureRender, refreshResourceStats, { immediate: true })
let resourceStatsTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  resourceStatsTimer = setInterval(refreshResourceStats, 1000)
})
onUnmounted(() => clearInterval(resourceStatsTimer))

const resourceDetailRows = computed(() => [
  { labelKey: 'settings.resources.materials', value: resourceStats.value.materials },
  { labelKey: 'settings.resources.models', value: resourceStats.value.models },
  { labelKey: 'settings.resources.shaders', value: resourceStats.value.shaders },
])

const privateAssetsUnlocked = computed(
  () => import.meta.env.VITE_ENABLE_SECURE_MODE !== 'true' || settingsStore.isAuthenticated
)
const qualityOptions = ['lite', 'full'] as const
const renderQualityOptions = ['economy', 'original'] as const
const renderResolutionLabel = computed(() => {
  const percent = settingsStore.settings.renderResolution
  if (percent >= 100) return 'fine'
  if (percent >= 90) return 'standard'
  if (percent >= 80) return 'slightlyBlurry'
  if (percent >= 66) return 'blurry'
  return 'veryBlurry'
})
function updateRenderResolution(value: number[] | undefined) {
  if (value?.[0] !== undefined) settingsStore.settings.renderResolution = value[0]
}
const fpsOptions = [30, 60, 120, 240, 0] as const
const backgroundOptions = computed<readonly string[]>(() =>
  privateAssetsUnlocked.value ? ['off', 'simple', 'real'] : ['off', 'simple']
)
const backgroundMode = computed({
  get: () => {
    if (!settingsStore.settings.showBackground) return 'off'
    return settingsStore.settings.homeTerrainEnabled ? 'real' : 'simple'
  },
  set: (value: string) => {
    if (value !== 'off' && value !== 'simple' && value !== 'real') return
    settingsStore.settings.showBackground = value !== 'off'
    settingsStore.settings.homeTerrainEnabled = value === 'real'
  },
})
const useHomeLighting = computed({
  get: () => settingsStore.settings.lightingMode === 'home',
  set: (value: boolean) => {
    settingsStore.settings.lightingMode = value ? 'home' : 'studio'
  },
})
const todTime = computed(() => {
  const minute = settingsStore.settings.todMinute
  return `${Math.floor(minute / 60)
    .toString()
    .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`
})
let todStepDirection = 0

function handleTodKeydown(event: KeyboardEvent) {
  todStepDirection = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
}

function updateTodTime(event: Event) {
  const input = event.target as HTMLInputElement
  const direction = todStepDirection
  todStepDirection = 0
  const match = /^(\d{2}):(\d{2})$/.exec(input.value)
  if (!match) return
  const hour = Number(match[1]),
    minute = Number(match[2])
  if (hour >= 24 || minute >= 60) return

  const previous = settingsStore.settings.todMinute
  const previousMinute = previous % 60
  const wrappedMinute =
    (direction === 1 && previousMinute === 59 && minute === 0) ||
    (direction === -1 && previousMinute === 0 && minute === 59)
  // Native minute fields wrap independently; carry only keyboard minute steps.
  settingsStore.settings.todMinute =
    wrappedMinute && hour === Math.floor(previous / 60)
      ? (previous + direction + 1440) % 1440
      : hour * 60 + minute
  input.value = todTime.value
}

const timePickerOpen = ref(false)

const timePresets = [
  { label: 'sidebar.environment.presetSunrise', minute: 6 * 60 },
  { label: 'sidebar.environment.presetNoon', minute: 12 * 60 },
  { label: 'sidebar.environment.presetSunset', minute: 18 * 60 },
  { label: 'sidebar.environment.presetMidnight', minute: 0 },
] as const

function isPresetActive(presetMinute: number) {
  const current = settingsStore.settings.todMinute
  const diff = Math.abs(current - presetMinute)
  const circularDiff = Math.min(diff, 1440 - diff)
  return circularDiff < 30
}

function updateTodMinuteFromSlider(value: number[] | undefined) {
  if (value?.[0] !== undefined) {
    settingsStore.settings.todMinute = value[0]
  }
}

function updateThreeSymbolScale(value: number[] | undefined) {
  if (value) settingsStore.settings.threeSymbolScale = value[0]!
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden p-4 pr-0">
    <ScrollArea class="h-full">
      <div class="flex flex-col gap-4 pr-4">
        <section v-if="privateAssetsUnlocked" class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold">{{ t('sidebar.display.graphics') }}</h3>

          <div class="flex items-center justify-between gap-2">
            <Label class="shrink-0 text-xs">{{ t('settings.renderQuality.label') }}</Label>
            <RadioGroup
              v-model="settingsStore.settings.renderQuality"
              :aria-label="t('settings.renderQuality.label')"
              orientation="horizontal"
              class="inline-flex gap-0 rounded-md border border-input bg-muted/40 p-[1px]"
            >
              <RadioGroupButton
                v-for="quality in renderQualityOptions"
                :key="quality"
                :value="quality"
                :disabled="preparingRender"
              >
                {{ t(`settings.renderQuality.${quality}`) }}
              </RadioGroupButton>
            </RadioGroup>
          </div>

          <div class="flex items-center justify-between gap-2">
            <Label class="shrink-0 text-xs">{{ t('settings.modelGeometry.label') }}</Label>
            <RadioGroup
              v-model="settingsStore.settings.modelAssetProfile"
              :aria-label="t('settings.modelGeometry.label')"
              orientation="horizontal"
              class="inline-flex shrink-0 gap-0 rounded-md border border-input bg-muted/40 p-[1px]"
            >
              <RadioGroupButton
                v-for="quality in qualityOptions"
                :key="quality"
                :value="quality"
                :disabled="
                  preparingEnvironment || !gameDataStore.availableModelProfiles.includes(quality)
                "
              >
                {{ t(quality === 'lite' ? 'settings.quality.low' : 'settings.quality.medium') }}
              </RadioGroupButton>
            </RadioGroup>
          </div>

          <div class="flex items-center justify-between gap-2">
            <Label class="shrink-0 text-xs">{{ t('settings.modelAssets.label') }}</Label>
            <RadioGroup
              v-model="settingsStore.settings.materialAssetProfile"
              :aria-label="t('settings.modelAssets.label')"
              orientation="horizontal"
              class="inline-flex shrink-0 gap-0 rounded-md border border-input bg-muted/40 p-[1px]"
            >
              <RadioGroupButton
                v-for="quality in qualityOptions"
                :key="quality"
                :value="quality"
                :disabled="preparingEnvironment"
              >
                {{ t(quality === 'lite' ? 'settings.quality.low' : 'settings.quality.medium') }}
              </RadioGroupButton>
            </RadioGroup>
          </div>

          <div class="flex items-center justify-between gap-2">
            <Label for="scene-shadows" class="text-xs">{{ t('settings.shadows') }}</Label>
            <Switch
              id="scene-shadows"
              v-model="settingsStore.settings.shadowsEnabled"
              :disabled="preparingRender"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <Label for="render-resolution" class="text-xs">
                {{ t('settings.renderResolution.label') }}
              </Label>
              <span
                id="render-resolution-value"
                class="flex shrink-0 items-baseline gap-1 text-xs text-muted-foreground tabular-nums"
              >
                <span>{{ t(`settings.renderResolution.${renderResolutionLabel}`) }}</span>
                <span>{{ settingsStore.settings.renderResolution }}%</span>
              </span>
            </div>
            <Slider
              id="render-resolution"
              :model-value="[settingsStore.settings.renderResolution]"
              @update:model-value="updateRenderResolution"
              :min="50"
              :max="100"
              :step="1"
              variant="thin"
              class="w-full"
              :aria-label="t('settings.renderResolution.label')"
            />
          </div>

          <div class="flex items-center justify-between gap-2">
            <Tooltip :delay-duration="200">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="group -mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-primary transition-colors hover:text-primary/80 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span>{{ t('settings.resources.label') }}</span>
                  <CircleAlert
                    class="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-primary/70"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" class="min-w-32">
                <div class="flex flex-col gap-0.5 tabular-nums">
                  <div
                    v-for="row in resourceDetailRows"
                    :key="row.labelKey"
                    class="flex items-center justify-between gap-4"
                  >
                    <span class="text-primary-foreground/70">{{ t(row.labelKey) }}</span>
                    <span>{{ row.value }}</span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-7 px-2 text-xs"
              :disabled="preparingRender || !resourceStats.canClearCache"
              @click="clearRenderCache"
            >
              {{ t('settings.resources.clear') }}
            </Button>
          </div>
        </section>

        <div v-if="privateAssetsUnlocked" class="border-t border-sidebar-border"></div>

        <section class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold">
            {{
              t(privateAssetsUnlocked ? 'sidebar.environment.label' : 'sidebar.environment.scene')
            }}
          </h3>
          <div class="flex items-center justify-between gap-2">
            <Label class="shrink-0 text-xs">{{ t('settings.background.label') }}</Label>
            <RadioGroup
              v-model="backgroundMode"
              :aria-label="t('settings.background.label')"
              orientation="horizontal"
              class="inline-flex shrink-0 gap-0 rounded-md border border-input bg-muted/40 p-[1px]"
            >
              <RadioGroupButton
                v-for="option in backgroundOptions"
                :key="option"
                :value="option"
                :disabled="preparingEnvironment"
              >
                {{ t(`settings.background.${option}`) }}
              </RadioGroupButton>
            </RadioGroup>
          </div>

          <div class="flex items-center justify-between gap-2">
            <Label for="scene-grid" class="text-xs">{{ t('sidebar.environment.grid') }}</Label>
            <Switch id="scene-grid" v-model="settingsStore.settings.showGrid" />
          </div>

          <div v-if="privateAssetsUnlocked" class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label for="home-lighting" class="text-xs">{{ t('sidebar.environment.home') }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('sidebar.environment.homeHint') }}
              </p>
            </div>
            <Switch id="home-lighting" v-model="useHomeLighting" :disabled="preparingRender" />
          </div>
          <div v-if="privateAssetsUnlocked" class="flex items-center justify-between gap-2">
            <Label for="home-tod-time" class="text-xs">{{ t('sidebar.environment.time') }}</Label>
            <Popover v-model:open="timePickerOpen">
              <div class="relative flex items-center">
                <Input
                  id="home-tod-time"
                  type="time"
                  step="60"
                  size="sm"
                  class="w-20 justify-end pr-7 pl-2 text-right text-xs [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:ml-auto [&::-webkit-datetime-edit]:flex-none [&:focus-visible]:shadow-none [&:focus-visible]:ring-0"
                  :disabled="!useHomeLighting || preparingRender"
                  :model-value="todTime"
                  @input="updateTodTime"
                  @keydown="handleTodKeydown"
                  @keyup="todStepDirection = 0"
                  @blur="todStepDirection = 0"
                />
                <PopoverTrigger as-child>
                  <button
                    type="button"
                    class="absolute right-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    :disabled="!useHomeLighting || preparingRender"
                    :title="t('sidebar.environment.timePicker')"
                    :aria-label="t('sidebar.environment.timePicker')"
                  >
                    <Clock class="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
              </div>

              <PopoverContent class="w-64 p-3" align="end" :side-offset="6">
                <div class="flex flex-col gap-3">
                  <div>
                    <span class="text-xs font-medium">{{ t('sidebar.environment.time') }}</span>
                  </div>

                  <div class="flex flex-col gap-3">
                    <Slider
                      :model-value="[settingsStore.settings.todMinute]"
                      @update:model-value="updateTodMinuteFromSlider"
                      :min="0"
                      :max="1439"
                      :step="1"
                      variant="thin"
                      class="w-full"
                      :aria-label="t('sidebar.environment.time')"
                    />
                    <div class="flex justify-between text-xs text-muted-foreground">
                      <span>00:00</span>
                      <span>06:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>24:00</span>
                    </div>
                  </div>

                  <div class="grid grid-cols-4 gap-1.5 pt-0.5">
                    <button
                      v-for="preset in timePresets"
                      :key="preset.minute"
                      type="button"
                      class="flex items-center justify-center rounded-md border border-input bg-background/50 px-1 py-1.5 text-center transition-colors hover:bg-accent hover:text-accent-foreground"
                      :class="
                        isPresetActive(preset.minute)
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground'
                      "
                      @click="settingsStore.settings.todMinute = preset.minute"
                    >
                      <span class="text-[11px]">{{ t(preset.label) }}</span>
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </section>

        <div class="border-t border-sidebar-border"></div>

        <section class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold">{{ t('sidebar.display.helpers') }}</h3>
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label for="furniture-tooltip" class="text-xs">{{
                t('settings.furnitureTooltip.label')
              }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.furnitureTooltip.hint') }}
              </p>
            </div>
            <Switch id="furniture-tooltip" v-model="settingsStore.settings.showFurnitureTooltip" />
          </div>
          <div v-if="privateAssetsUnlocked" class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label for="model-group-color" class="text-xs">{{
                t('settings.modelGroupColor.label')
              }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.modelGroupColor.hint') }}
              </p>
            </div>
            <Switch id="model-group-color" v-model="settingsStore.settings.modelGroupColorTint" />
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-xs">{{ t('sidebar.display.iconSize') }}</Label>
              <span class="text-xs"
                >{{ Math.round(settingsStore.settings.threeSymbolScale * 100) }}%</span
              >
            </div>
            <Slider
              :model-value="[settingsStore.settings.threeSymbolScale]"
              @update:model-value="updateThreeSymbolScale"
              :min="0.1"
              :max="3"
              :step="0.1"
              variant="thin"
              :aria-label="t('sidebar.display.iconSize')"
            />
            <p class="text-[10px] text-muted-foreground">{{ t('editor.sizeControl.shortcut') }}</p>
          </div>
          <div class="flex items-center justify-between gap-2">
            <Label for="fps-monitor" class="text-xs">{{ t('settings.fpsMonitor') }}</Label>
            <Switch id="fps-monitor" v-model="settingsStore.settings.showFpsMonitor" />
          </div>
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label for="on-demand-rendering" class="text-xs">{{
                t('settings.onDemandRendering.label')
              }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.onDemandRendering.hint') }}
              </p>
            </div>
            <Switch id="on-demand-rendering" v-model="settingsStore.settings.onDemandRendering" />
          </div>
          <div class="flex items-center justify-between gap-2">
            <Label for="fps-limit" class="text-xs">{{ t('settings.fpsLimit.label') }}</Label>
            <Select v-model="settingsStore.settings.fpsLimit">
              <SelectTrigger id="fps-limit" size="sm" class="w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="fps in fpsOptions" :key="fps" :value="fps">
                  {{ fps || t('settings.fpsLimit.unlimited') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
      </div>
      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>

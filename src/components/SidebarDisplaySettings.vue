<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { useI18n } from '@/composables/useI18n'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupButton } from '@/components/ui/radio-group'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

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
const showModelOnlySettings = computed(
  () => import.meta.env.VITE_ENABLE_SECURE_MODE !== 'true' || settingsStore.isAuthenticated
)
const qualityOptions = ['lite', 'full'] as const
const backgroundOptions = ['off', 'simple', 'real'] as const
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

function updateThreeSymbolScale(value: number[] | undefined) {
  if (value) settingsStore.settings.threeSymbolScale = value[0]!
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden p-4 pr-0">
    <ScrollArea class="h-full">
      <div class="flex flex-col gap-4 pr-4">
        <section v-if="showModelOnlySettings" class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold">{{ t('sidebar.display.graphics') }}</h3>

          <div class="flex items-center justify-between gap-2">
            <Label class="shrink-0 text-xs">{{ t('settings.modelGeometry.label') }}</Label>
            <RadioGroup
              v-model="settingsStore.settings.modelAssetProfile"
              :aria-label="t('settings.modelGeometry.label')"
              orientation="horizontal"
              class="inline-flex shrink-0 gap-0 rounded-md border border-input bg-muted/40 p-0.5"
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
              class="inline-flex shrink-0 gap-0 rounded-md border border-input bg-muted/40 p-0.5"
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
        </section>

        <div v-if="showModelOnlySettings" class="border-t border-sidebar-border"></div>

        <section class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold">{{ t('sidebar.environment.label') }}</h3>
          <div class="flex items-center justify-between gap-2">
            <Label class="shrink-0 text-xs">{{ t('settings.background.label') }}</Label>
            <RadioGroup
              v-model="backgroundMode"
              :aria-label="t('settings.background.label')"
              orientation="horizontal"
              class="inline-flex shrink-0 gap-0 rounded-md border border-input bg-muted/40 p-0.5"
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

          <div class="space-y-1">
            <div class="flex items-center justify-between gap-2">
              <Label for="home-lighting" class="text-xs">{{ t('sidebar.environment.home') }}</Label>
              <Switch id="home-lighting" v-model="useHomeLighting" :disabled="preparingRender" />
            </div>
            <p class="text-[11px] text-muted-foreground">{{ t('sidebar.environment.homeHint') }}</p>
          </div>
          <div class="flex items-center justify-between gap-2">
            <Label for="home-tod-time" class="text-xs">{{ t('sidebar.environment.time') }}</Label>
            <Input
              id="home-tod-time"
              type="time"
              step="60"
              size="sm"
              class="w-24 justify-end px-2 text-right [&::-webkit-datetime-edit]:ml-auto [&::-webkit-datetime-edit]:flex-none"
              :disabled="!useHomeLighting || preparingRender"
              :model-value="todTime"
              @input="updateTodTime"
              @keydown="handleTodKeydown"
              @keyup="todStepDirection = 0"
              @blur="todStepDirection = 0"
            />
          </div>
        </section>

        <div class="border-t border-sidebar-border"></div>

        <section class="flex flex-col gap-4">
          <h3 class="text-xs font-semibold">{{ t('sidebar.display.helpers') }}</h3>
          <div class="flex items-center justify-between gap-2">
            <Label for="furniture-tooltip" class="text-xs">{{
              t('settings.furnitureTooltip.label')
            }}</Label>
            <Switch id="furniture-tooltip" v-model="settingsStore.settings.showFurnitureTooltip" />
          </div>
          <div v-if="showModelOnlySettings" class="flex items-center justify-between gap-2">
            <Label for="model-group-color" class="text-xs">{{
              t('settings.modelGroupColor.label')
            }}</Label>
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
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-2">
              <Label for="on-demand-rendering" class="text-xs">{{
                t('settings.onDemandRendering.label')
              }}</Label>
              <Switch id="on-demand-rendering" v-model="settingsStore.settings.onDemandRendering" />
            </div>
            <p class="text-[11px] text-muted-foreground">
              {{ t('settings.onDemandRendering.hint') }}
            </p>
          </div>
        </section>
      </div>
      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>

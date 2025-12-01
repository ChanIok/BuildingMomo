<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import type { Locale } from '../composables/useI18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

const settingsStore = useSettingsStore()
const { t, locale, setLocale } = useI18n()

const languageOptions = [
  { value: 'zh' as Locale, label: '中文' },
  { value: 'en' as Locale, label: 'English' },
]

function handleLanguageChange(newLocale: Locale) {
  setLocale(newLocale)
  // 同步到设置（可选）
  settingsStore.settings.language = newLocale
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-h-[80vh] max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('settings.title') }}</DialogTitle>
        <DialogDescription>{{ t('settings.description') }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- 语言选择 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.language') }}</Label>
            <p class="text-xs text-muted-foreground">{{ t('settings.languageHint') }}</p>
          </div>
          <Select :model-value="locale" @update:model-value="handleLanguageChange as any">
            <SelectTrigger class="w-40">
              <SelectValue :placeholder="t('settings.language')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in languageOptions" :key="opt.value" :value="opt.value">{{
                opt.label
              }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <!-- 家具Tooltip开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.furnitureTooltip.label') }}</Label>
            <p class="text-xs text-muted-foreground">{{ t('settings.furnitureTooltip.hint') }}</p>
          </div>
          <Switch v-model="settingsStore.settings.showFurnitureTooltip" />
        </div>

        <!-- 背景图开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.background.label') }}</Label>
            <p class="text-xs text-muted-foreground">{{ t('settings.background.hint') }}</p>
          </div>
          <Switch v-model="settingsStore.settings.showBackground" />
        </div>

        <!-- 分割线 -->
        <div class="border-t pt-4">
          <h3 class="mb-3 text-sm font-medium">{{ t('settings.editAssist') }}</h3>
        </div>

        <!-- 重复物品检测开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.duplicateDetection.label') }}</Label>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.duplicateDetection.hint') }}
            </p>
          </div>
          <Switch v-model="settingsStore.settings.enableDuplicateDetection" />
        </div>

        <!-- 限制检测开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.limitDetection.label') }}</Label>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.limitDetection.hint') }}
            </p>
          </div>
          <Switch v-model="settingsStore.settings.enableLimitDetection" />
        </div>

        <!-- 3D 视图设置分组 -->
        <!-- 3D 视图显示模式选择已移至侧边栏顶部工具栏 -->
      </div>
    </DialogContent>
  </Dialog>
</template>

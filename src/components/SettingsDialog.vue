<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import { useNotification } from '../composables/useNotification'
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
const notification = useNotification()
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

// 检查是否为私有版本
const isSecureMode = computed(() => {
  return import.meta.env.VITE_ENABLE_SECURE_MODE === 'true'
})

// 密码验证
const passwordInput = ref('')

async function handleVerify() {
  const success = await settingsStore.verifyPassword(passwordInput.value)
  if (success) {
    passwordInput.value = ''
  } else {
    notification.error('访问码无效')
  }
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

        <!-- 主题选择 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.theme.label') }}</Label>
            <p class="text-xs text-muted-foreground">{{ t('settings.theme.hint') }}</p>
          </div>
          <Select v-model="settingsStore.settings.theme">
            <SelectTrigger class="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{{ t('settings.theme.light') }}</SelectItem>
              <SelectItem value="dark">{{ t('settings.theme.dark') }}</SelectItem>
              <SelectItem value="auto">{{ t('settings.theme.auto') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 工作台记忆开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>{{ t('settings.autoSave.label') }}</Label>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.autoSave.hint') }}
            </p>
          </div>
          <Switch v-model="settingsStore.settings.enableAutoSave" />
        </div>

        <!-- 实验性功能 -->
        <div v-if="isSecureMode" class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>实验性功能</Label>
            <p class="text-xs text-muted-foreground">启用高级功能</p>
          </div>
          <div class="flex items-center gap-2">
            <template v-if="!settingsStore.isAuthenticated">
              <div class="flex gap-2">
                <input
                  v-model="passwordInput"
                  type="text"
                  placeholder="访问码"
                  class="password-style w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  @keyup.enter="handleVerify"
                />
                <button
                  @click="handleVerify"
                  :disabled="settingsStore.isVerifying || !passwordInput"
                  class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {{ settingsStore.isVerifying ? '...' : '启用' }}
                </button>
              </div>
            </template>
            <button
              v-else
              disabled
              class="cursor-not-allowed rounded-md bg-muted px-4 py-1.5 text-sm font-medium text-muted-foreground"
            >
              已启用
            </button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.password-style {
  -webkit-text-security: disc;
  text-security: disc;
}
</style>

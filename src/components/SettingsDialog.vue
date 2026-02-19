<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import { useNotification } from '../composables/useNotification'
import type { Locale } from '../composables/useI18n'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Settings, Keyboard } from 'lucide-vue-next'

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

// 当前选中的菜单项
const activeSection = ref<'general' | 'shortcuts'>('general')

// 菜单配置
const menuItems = computed(() => [
  { id: 'general' as const, label: t('settings.menu.general') },
  { id: 'shortcuts' as const, label: t('settings.menu.shortcuts') },
])

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
    <DialogContent class="p-0 md:max-w-2xl">
      <DialogTitle class="sr-only">{{ t('settings.title') }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t('settings.title') }}</DialogDescription>
      <!-- PC端：左右布局；高度上限 480px，横屏时不超过视口以显示滚动条 -->
      <div class="flex h-[min(480px,calc(100vh-2rem))] min-h-0">
        <!-- 左侧菜单栏 -->
        <nav class="hidden min-h-0 w-40 shrink-0 flex-col border-r md:flex">
          <!-- 标题区 -->
          <div class="px-6 pt-6">
            <h2 class="text-base">{{ t('settings.title') }}</h2>
          </div>

          <ScrollArea class="min-h-0 flex-1">
            <ul class="space-y-1 p-3">
              <li v-for="item in menuItems" :key="item.id">
                <button
                  @click="activeSection = item.id"
                  :class="[
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    activeSection === item.id
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  ]"
                >
                  <Settings v-if="item.id === 'general'" class="h-4 w-4" />
                  <Keyboard v-if="item.id === 'shortcuts'" class="h-4 w-4" />
                  <span>{{ item.label }}</span>
                </button>
              </li>
            </ul>
          </ScrollArea>
        </nav>

        <!-- 右侧内容区 -->
        <ScrollArea class="min-h-0 min-w-0 flex-1">
          <div class="p-6">
            <!-- 通用设置 -->
            <div v-show="activeSection === 'general'" class="space-y-6">
              <h3 class="mb-4 text-lg">{{ t('settings.menu.general') }}</h3>

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
                    <SelectItem
                      v-for="opt in languageOptions"
                      :key="opt.value"
                      :value="opt.value"
                      >{{ opt.label }}</SelectItem
                    >
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

              <!-- 文件监控弹窗提示 -->
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <Label>{{ t('settings.watchNotification.label') }}</Label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.watchNotification.hint') }}
                  </p>
                </div>
                <Switch v-model="settingsStore.settings.enableWatchNotification" />
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

            <!-- 快捷键设置 -->
            <div v-show="activeSection === 'shortcuts'" class="space-y-3">
              <h3 class="mb-4 text-lg">{{ t('settings.menu.shortcuts') }}</h3>

              <!-- 相机控制 -->
              <div class="space-y-2">
                <Label class="text-xs text-muted-foreground">{{
                  t('settings.inputBindings.camera.label')
                }}</Label>

                <div class="flex items-center justify-between">
                  <Label class="text-sm">{{
                    t('settings.inputBindings.camera.orbitRotate')
                  }}</Label>
                  <Select v-model="settingsStore.settings.inputBindings.camera.orbitRotate">
                    <SelectTrigger :class="locale === 'en' ? 'w-40' : 'w-32'">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="middle">{{
                        t('settings.inputBindings.keys.middle')
                      }}</SelectItem>
                      <SelectItem value="right">{{
                        t('settings.inputBindings.keys.right')
                      }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="flex items-center justify-between">
                  <Label class="text-sm">{{ t('settings.inputBindings.camera.flightLook') }}</Label>
                  <Select v-model="settingsStore.settings.inputBindings.camera.flightLook">
                    <SelectTrigger :class="locale === 'en' ? 'w-40' : 'w-32'">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="middle">{{
                        t('settings.inputBindings.keys.middle')
                      }}</SelectItem>
                      <SelectItem value="right">{{
                        t('settings.inputBindings.keys.right')
                      }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="flex items-center justify-between">
                  <div class="space-y-0.5">
                    <Label class="text-sm">{{
                      t('settings.inputBindings.camera.enableAltLeftClick')
                    }}</Label>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.inputBindings.camera.enableAltLeftClickHint') }}
                    </p>
                  </div>
                  <Switch
                    :model-value="settingsStore.settings.inputBindings.camera.enableAltLeftClick"
                    @update:model-value="
                      (val) => {
                        settingsStore.settings.inputBindings.camera.enableAltLeftClick = val
                        settingsStore.resolveAltCameraConflicts()
                      }
                    "
                  />
                </div>
              </div>

              <!-- 选择修饰键 -->
              <div class="space-y-2">
                <Label class="text-xs text-muted-foreground">{{
                  t('settings.inputBindings.selection.label')
                }}</Label>

                <div class="flex items-center justify-between">
                  <Label class="text-sm">{{ t('settings.inputBindings.selection.add') }}</Label>
                  <Select
                    :model-value="settingsStore.settings.inputBindings.selection.add"
                    @update:model-value="
                      (val) => {
                        settingsStore.settings.inputBindings.selection.add = val as any
                        settingsStore.resolveSelectionBindingConflicts('add', val as string)
                      }
                    "
                  >
                    <SelectTrigger class="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shift">{{
                        t('settings.inputBindings.keys.shift')
                      }}</SelectItem>
                      <SelectItem value="ctrl">{{
                        t('settings.inputBindings.keys.ctrl')
                      }}</SelectItem>
                      <SelectItem value="alt">{{
                        t('settings.inputBindings.keys.alt')
                      }}</SelectItem>
                      <SelectItem value="none">{{
                        t('settings.inputBindings.keys.disabled')
                      }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="flex items-center justify-between">
                  <Label class="text-sm">{{
                    t('settings.inputBindings.selection.subtract')
                  }}</Label>
                  <Select
                    :model-value="settingsStore.settings.inputBindings.selection.subtract"
                    @update:model-value="
                      (val) => {
                        settingsStore.settings.inputBindings.selection.subtract = val as any
                        settingsStore.resolveSelectionBindingConflicts('subtract', val as string)
                      }
                    "
                  >
                    <SelectTrigger class="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shift">{{
                        t('settings.inputBindings.keys.shift')
                      }}</SelectItem>
                      <SelectItem value="ctrl">{{
                        t('settings.inputBindings.keys.ctrl')
                      }}</SelectItem>
                      <SelectItem value="alt">{{
                        t('settings.inputBindings.keys.alt')
                      }}</SelectItem>
                      <SelectItem value="none">{{
                        t('settings.inputBindings.keys.disabled')
                      }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="flex items-center justify-between">
                  <Label class="text-sm">{{
                    t('settings.inputBindings.selection.intersect')
                  }}</Label>
                  <Select
                    :model-value="settingsStore.settings.inputBindings.selection.intersect"
                    @update:model-value="
                      (val) => {
                        settingsStore.settings.inputBindings.selection.intersect = val as any
                        settingsStore.resolveSelectionBindingConflicts('intersect', val as string)
                      }
                    "
                  >
                    <SelectTrigger class="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shift+alt"
                        >{{ t('settings.inputBindings.keys.shift') }}+{{
                          t('settings.inputBindings.keys.alt')
                        }}</SelectItem
                      >
                      <SelectItem value="ctrl+shift"
                        >{{ t('settings.inputBindings.keys.ctrl') }}+{{
                          t('settings.inputBindings.keys.shift')
                        }}</SelectItem
                      >
                      <SelectItem value="ctrl+alt"
                        >{{ t('settings.inputBindings.keys.ctrl') }}+{{
                          t('settings.inputBindings.keys.alt')
                        }}</SelectItem
                      >
                      <SelectItem value="none">{{
                        t('settings.inputBindings.keys.disabled')
                      }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="flex items-center justify-between">
                  <div class="space-y-0.5">
                    <Label class="text-sm">{{
                      t('settings.inputBindings.selection.toggleIndividual')
                    }}</Label>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.inputBindings.selection.toggleIndividualHint') }}
                    </p>
                  </div>
                  <Select
                    :model-value="settingsStore.settings.inputBindings.selection.toggleIndividual"
                    @update:model-value="
                      (val) => {
                        settingsStore.settings.inputBindings.selection.toggleIndividual = val as any
                        settingsStore.resolveSelectionBindingConflicts(
                          'toggleIndividual',
                          val as string
                        )
                      }
                    "
                  >
                    <SelectTrigger class="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ctrl">{{
                        t('settings.inputBindings.keys.ctrl')
                      }}</SelectItem>
                      <SelectItem value="alt">{{
                        t('settings.inputBindings.keys.alt')
                      }}</SelectItem>
                      <SelectItem value="shift">{{
                        t('settings.inputBindings.keys.shift')
                      }}</SelectItem>
                      <SelectItem value="ctrl+shift"
                        >{{ t('settings.inputBindings.keys.ctrl') }}+{{
                          t('settings.inputBindings.keys.shift')
                        }}</SelectItem
                      >
                      <SelectItem value="ctrl+alt"
                        >{{ t('settings.inputBindings.keys.ctrl') }}+{{
                          t('settings.inputBindings.keys.alt')
                        }}</SelectItem
                      >
                      <SelectItem value="shift+alt"
                        >{{ t('settings.inputBindings.keys.shift') }}+{{
                          t('settings.inputBindings.keys.alt')
                        }}</SelectItem
                      >
                      <SelectItem value="none">{{
                        t('settings.inputBindings.keys.disabled')
                      }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
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

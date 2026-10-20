<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDesktopStore } from '../stores/desktopStore'
import { useI18n } from '../composables/useI18n'
import { useNotification } from '../composables/useNotification'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

const desktopStore = useDesktopStore()
const { t } = useI18n()
const notification = useNotification()

const isCleaningGame = ref(false)
const isCleaningEditor = ref(false)

function handleToggleRunAsAdmin(enabled: boolean) {
  desktopStore.setRunAsAdmin(enabled)
  notification.info(t('sidebar.desktop.runAsAdminRestartHint'))
}

async function handleCleanMemory(target: 'game' | 'editor') {
  if (target === 'game') {
    isCleaningGame.value = true
  } else {
    isCleaningEditor.value = true
  }

  try {
    const res = await desktopStore.cleanMemory(target)
    if (res.success) {
      if (target === 'game') {
        notification.success(t('sidebar.desktop.cleanGameSuccess', { mb: res.releasedMb }))
      } else {
        notification.success(t('sidebar.desktop.cleanEditorSuccess', { mb: res.releasedMb }))
      }
    } else {
      if (res.errorCode === 'game_not_running') {
        notification.error(t('sidebar.desktop.cleanGameNotRunning'))
      } else if (res.errorCode === 'access_denied') {
        notification.error(t('sidebar.desktop.cleanGameAccessDenied'))
      } else {
        notification.error(t('sidebar.desktop.cleanFailed'))
      }
    }
  } catch {
    notification.error(t('sidebar.desktop.cleanFailed'))
  } finally {
    if (target === 'game') {
      isCleaningGame.value = false
    } else {
      isCleaningEditor.value = false
    }
  }
}

const fpsInputValue = computed({
  get: () => desktopStore.settings.rtssHangLimitFps,
  set: (val: string | number) => {
    const num = Number(val)
    if (!isNaN(num)) {
      // 限制输入范围 1 ~ 240
      desktopStore.settings.rtssHangLimitFps = Math.max(1, Math.min(240, Math.floor(num)))
    }
  },
})

const rtssBadge = computed(() => {
  if (desktopStore.status.rtssAvailable) {
    return {
      text: t('sidebar.desktop.rtssRunning'),
      pillClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      dotClass: 'bg-emerald-500',
    }
  }
  return {
    text: t('sidebar.desktop.rtssNotRunning'),
    pillClass: 'bg-muted text-muted-foreground',
    dotClass: 'bg-muted-foreground/40',
  }
})

const gameBadge = computed(() => {
  if (!desktopStore.status.gameRunning) {
    return {
      text: t('sidebar.desktop.gameNotRunning'),
      pillClass: 'bg-muted text-muted-foreground',
      dotClass: 'bg-muted-foreground/40',
    }
  }
  if (desktopStore.status.gameFocused) {
    return {
      text: t('sidebar.desktop.gameFocused'),
      pillClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      dotClass: 'bg-blue-500',
    }
  }
  if (desktopStore.status.isLimiting) {
    return {
      text: t('sidebar.desktop.gameLimiting'),
      pillClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      dotClass: 'bg-emerald-500',
    }
  }
  return {
    text: t('sidebar.desktop.gameBackground'),
    pillClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  }
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden p-4 pr-0">
    <ScrollArea class="h-full">
      <div class="flex flex-col gap-4 pr-4">
        <!-- 系统权限 -->
        <div class="flex flex-col gap-4">
          <h3 class="w-fit cursor-default text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.desktop.systemPermission') }}
          </h3>

          <!-- 开关：以管理员身份运行 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="cursor-pointer text-xs" for="run-as-admin">
                {{ t('sidebar.desktop.runAsAdmin') }}
              </Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('sidebar.desktop.runAsAdminHint') }}
              </p>
            </div>
            <Switch
              id="run-as-admin"
              :model-value="desktopStore.status.runAsAdminEnabled"
              @update:model-value="handleToggleRunAsAdmin"
            />
          </div>
        </div>

        <Separator />

        <!-- 性能调度 -->
        <div class="flex flex-col gap-4">
          <h3 class="w-fit cursor-default text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.desktop.performance') }}
          </h3>

          <!-- GPU 实时优先级：标准左右对齐布局 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="cursor-pointer text-xs" for="gpu-priority">
                {{ t('sidebar.desktop.gpuPriority') }}
              </Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('sidebar.desktop.gpuPriorityHint') }}
              </p>
            </div>
            <Switch id="gpu-priority" v-model="desktopStore.settings.gpuRealtimePriority" />
          </div>
        </div>

        <Separator />

        <!-- 游戏后台限帧 -->
        <div class="flex flex-col gap-4">
          <h3 class="w-fit cursor-default text-xs font-semibold text-sidebar-foreground">
            {{ t('sidebar.desktop.rtssLimiter') }}
          </h3>

          <!-- 开关：标准左右对齐布局 -->
          <div class="flex items-center justify-between">
            <div class="mr-2 space-y-0.5">
              <Label class="cursor-pointer text-xs" for="rtss-enable">
                {{ t('sidebar.desktop.rtssEnable') }}
              </Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('sidebar.desktop.rtssLimiterHint') }}
              </p>
            </div>
            <Switch id="rtss-enable" v-model="desktopStore.settings.rtssHangLimitEnabled" />
          </div>

          <!-- 后台目标帧率：标准 Input 布局 -->
          <div class="flex items-center justify-between gap-2">
            <Label class="text-xs text-muted-foreground" for="rtss-fps">
              {{ t('sidebar.desktop.rtssFps') }}
            </Label>
            <div class="flex items-center gap-1">
              <Input
                id="rtss-fps"
                v-model.number="fpsInputValue"
                type="number"
                min="1"
                max="240"
                size="xs"
                class="w-12 text-right [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&:focus-visible]:shadow-none [&:focus-visible]:ring-0"
              />
              <span class="text-xs text-muted-foreground">FPS</span>
            </div>
          </div>

          <!-- 状态监控指示器：现代微胶囊 (Badge Pill) -->
          <div class="flex flex-col gap-2.5 pt-1 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{{
                t('sidebar.desktop.rtssStatus')
              }}</span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="rtssBadge.pillClass"
              >
                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="rtssBadge.dotClass" />
                {{ rtssBadge.text }}
              </span>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{{
                t('sidebar.desktop.gameStatus')
              }}</span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="gameBadge.pillClass"
              >
                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="gameBadge.dotClass" />
                {{ gameBadge.text }}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        <!-- 内存整理 -->
        <div class="flex flex-col gap-2.5">
          <div class="space-y-0.5">
            <h3 class="w-fit cursor-default text-xs font-semibold text-sidebar-foreground">
              {{ t('sidebar.desktop.memoryTitle') }}
            </h3>
            <p class="text-[11px] text-muted-foreground">
              {{ t('sidebar.desktop.memoryHint') }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              class="h-8 text-xs font-normal"
              :disabled="isCleaningGame || isCleaningEditor"
              @click="handleCleanMemory('game')"
            >
              {{ isCleaningGame ? t('sidebar.desktop.cleaning') : t('sidebar.desktop.cleanGame') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 text-xs font-normal"
              :disabled="isCleaningGame || isCleaningEditor"
              @click="handleCleanMemory('editor')"
            >
              {{
                isCleaningEditor ? t('sidebar.desktop.cleaning') : t('sidebar.desktop.cleanEditor')
              }}
            </Button>
          </div>
        </div>
      </div>

      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>

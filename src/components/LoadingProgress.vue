<script setup lang="ts">
import { computed } from 'vue'
import { useLoadingStore } from '@/stores/loadingStore'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()
const loadingStore = useLoadingStore()

// 是否显示（加载中或刚完成且在淡出阶段）
const shouldShow = computed(() => {
  return loadingStore.isLoading || loadingStore.total > 0
})

// 加载类型标题
const loadingTitle = computed(() => {
  if (!loadingStore.loadingType) return ''
  return loadingStore.loadingType === 'icon' ? t('loading.icon') : t('loading.model')
})

// 阶段描述文本
const phaseText = computed(() => {
  if (!loadingStore.phase) return ''
  return loadingStore.phase === 'network'
    ? t('loading.phase.network')
    : t('loading.phase.processing')
})

// 进度条样式
const progressBarStyle = computed(() => ({
  width: `${loadingStore.progress}%`,
}))

// 是否显示完成状态
const showComplete = computed(() => {
  return loadingStore.isComplete && !loadingStore.isLoading
})
</script>

<template>
  <Transition name="fade">
    <div
      v-if="shouldShow"
      class="flex min-w-64 flex-col gap-2 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-xs backdrop-blur-sm"
    >
      <!-- 标题行 -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <!-- 加载图标 -->
          <svg
            v-if="loadingStore.isLoading"
            class="h-3.5 w-3.5 animate-spin text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <!-- 完成图标 -->
          <svg
            v-else-if="showComplete"
            class="h-3.5 w-3.5 text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>

          <!-- 标题 + 阶段描述 -->
          <div class="flex flex-col">
            <span class="font-medium">
              {{ showComplete ? t('loading.complete') : loadingTitle }}
            </span>
            <!-- 阶段描述（仅在staged模式下显示） -->
            <span
              v-if="!showComplete && loadingStore.mode === 'staged'"
              class="text-[10px] text-muted-foreground"
            >
              {{ phaseText }}
            </span>
          </div>
        </div>

        <!-- 进度数字 -->
        <span class="text-muted-foreground tabular-nums">
          {{ loadingStore.current }}/{{ loadingStore.total }}
        </span>
      </div>

      <!-- 进度条 -->
      <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          :style="progressBarStyle"
        ></div>
      </div>

      <!-- 失败提示 -->
      <div
        v-if="loadingStore.hasFailures"
        class="flex items-center gap-1.5 text-[10px] text-orange-500"
      >
        <svg
          class="h-3 w-3"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
        <span>{{ loadingStore.failedCount }} {{ t('loading.failed') }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

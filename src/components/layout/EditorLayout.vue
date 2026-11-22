<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { Split } from '@/components/ui/split'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

const props = defineProps<{ editing: boolean }>()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()
const container = ref<HTMLElement | null>(null)
const { width } = useElementSize(container)
const rightVisible = computed(
  () =>
    (props.editing || (uiStore.sidebarView === 'ai' && settingsStore.canUseExperimentalFeatures)) &&
    !uiStore.sidebarCollapsed
)
function pixels(value: string, fallback: number) {
  const parsed = value.endsWith('px') ? parseFloat(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}
// 右栏宽度不仅受自身上限约束，还要给主编辑区保留基本可用空间。
const rightMax = computed(() => Math.min(width.value, Math.max(480, width.value * 0.5)))
// 持久化宽度需要在每次容器尺寸变化时重新校正，
// 避免用户上次保存的宽度在当前窗口下把编辑区挤得过小。
const rightWidth = computed(() =>
  Math.max(240, Math.min(rightMax.value, pixels(settingsStore.settings.sidebarWidth, 256)))
)
const rightSize = computed({
  get: () => (rightVisible.value ? `${rightWidth.value}px` : '0px'),
  set: (size: string | number) => {
    if (rightVisible.value) settingsStore.settings.sidebarWidth = String(size)
  },
})
</script>

<template>
  <div
    ref="container"
    class="h-full min-h-0 min-w-0 overflow-hidden rounded-md border border-border bg-background shadow"
  >
    <!-- 方案编辑或全局 AI 对话展开时启用可调宽侧栏 -->
    <Split
      v-model:size="rightSize"
      reverse
      :disabled="!rightVisible"
      min="240px"
      :max="`${rightMax}px`"
    >
      <!-- 画布区域 -->
      <template #1
        ><div class="relative flex h-full min-h-0 min-w-0 flex-col"><slot /></div
      ></template>
      <!-- 右侧边栏 -->
      <template #2><slot v-if="rightVisible" name="sidebar" /></template>
    </Split>
  </div>
</template>

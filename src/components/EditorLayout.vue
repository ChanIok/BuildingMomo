<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { Split } from '@/components/ui/split'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import {
  createAnalysisCaptureBridge,
  analysisCaptureBridgeKey,
} from '@/lib/sceneAnalysis/captureBridge'
import { useAiChat } from '@/composables/ai/useAiChat'
import { aiChatKey } from '@/composables/ai/chatContext'

const props = defineProps<{ editing: boolean }>()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()
const captureBridge = createAnalysisCaptureBridge()
provide(analysisCaptureBridgeKey, captureBridge)
provide(
  aiChatKey,
  useAiChat({
    enabled: computed(() => props.editing && settingsStore.canUseExperimentalFeatures),
    getCaptureProvider: () => captureBridge.provider.value,
  })
)
const container = ref<HTMLElement | null>(null)
const { width } = useElementSize(container)
const rightVisible = computed(() => props.editing && !uiStore.sidebarCollapsed)
function pixels(value: string, fallback: number) {
  const parsed = value.endsWith('px') ? parseFloat(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}
// 右栏宽度不仅受自身上限约束，还要给主编辑区保留基本可用空间。
const rightMax = computed(() => Math.min(480, Math.max(240, width.value - 420)))
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
    <!-- 可调宽布局：仅方案页且侧边栏展开时启用 -->
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

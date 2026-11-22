import { computed, watch } from 'vue'
import { useUIStore } from '@/stores/uiStore'

interface CanvasPanels {
  showFurnitureLibrary: boolean
  showDyePanel: boolean
}

/** 协调面板重叠，不改变画布大小。 */
export function useCanvasPanels(panels: CanvasPanels) {
  const uiStore = useUIStore()
  const canShowAlongside = computed(() => uiStore.editorContainerRect.width >= 640)

  watch(
    () => uiStore.groupPanelOpen,
    (open) => {
      if (!open) return
      panels.showFurnitureLibrary = false
      if (!canShowAlongside.value) panels.showDyePanel = false
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    () => panels.showFurnitureLibrary,
    (open) => {
      if (open) uiStore.groupPanelOpen = false
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    [() => panels.showDyePanel, canShowAlongside],
    ([dye, alongside]) => {
      if (dye && !alongside) uiStore.groupPanelOpen = false
    },
    { immediate: true, flush: 'sync' }
  )

  // 为组面板预留 16 px 边距、280 px 宽度和 12 px 间隔，染色面板限于剩余空间，
  // 超出内容由其自身的滚动区域承载。
  const dyePanelStyle = computed(() =>
    uiStore.groupPanelOpen && canShowAlongside.value
      ? { left: '308px', maxWidth: 'calc(100% - 324px)' }
      : undefined
  )

  return { dyePanelStyle }
}

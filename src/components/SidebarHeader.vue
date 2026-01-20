<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCommandStore } from '@/stores/commandStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/composables/useI18n'
import {
  Box,
  Image as ImageIcon,
  Cuboid,
  Boxes,
  Camera,
  ChevronsUp,
  ChevronsDown,
  ChevronsRight,
  ChevronsLeft,
  ChevronRight,
  ChevronLeft,
} from 'lucide-vue-next'
import SidebarToggleItem from './SidebarToggleItem.vue'

const settingsStore = useSettingsStore()
const commandStore = useCommandStore()
const uiStore = useUIStore()
const { t } = useI18n()

// 工具和选择模式已迁移到 CanvasToolbar

// 显示模式切换
const displayMode = computed({
  get: () => {
    const currentMode = settingsStore.settings.threeDisplayMode
    // 如果当前是 model 模式但未验证，自动降级到 simple-box
    if (
      currentMode === 'model' &&
      import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' &&
      !settingsStore.isAuthenticated
    ) {
      return 'simple-box'
    }
    return currentMode
  },
  set: (val) => {
    if (val) {
      // 如果尝试切换到 model 但未验证，自动降级
      if (
        val === 'model' &&
        import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' &&
        !settingsStore.isAuthenticated
      ) {
        settingsStore.settings.threeDisplayMode = 'simple-box'
      } else {
        settingsStore.settings.threeDisplayMode = val as 'box' | 'icon' | 'simple-box' | 'model'
      }
    }
  },
})
// 视图预设切换
const viewPreset = computed({
  get: () => uiStore.currentViewPreset,
  set: (val) => {
    if (!val) return

    const idMap: Record<string, string> = {
      perspective: 'view.setViewPerspective',
      top: 'view.setViewTop',
      bottom: 'view.setViewBottom',
      front: 'view.setViewFront',
      back: 'view.setViewBack',
      left: 'view.setViewLeft',
      right: 'view.setViewRight',
    }

    const cmdId = idMap[val]
    if (cmdId) {
      commandStore.executeCommand(cmdId)
    }
  },
})

// 配置数据
const displayModes = computed(() => {
  const modes = [
    { id: 'box', label: t('sidebar.displayMode.box'), icon: Cuboid },
    { id: 'simple-box', label: t('sidebar.displayMode.simpleBox'), icon: Box },
    { id: 'icon', label: t('sidebar.displayMode.icon'), icon: ImageIcon },
  ]
  if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' && settingsStore.isAuthenticated) {
    modes.push({ id: 'model', label: t('sidebar.displayMode.model'), icon: Boxes })
  }

  return modes
})

const viewPresets = computed(() => [
  { id: 'top', label: t('command.view.setViewTop'), icon: ChevronsUp },
  { id: 'front', label: t('command.view.setViewFront'), icon: ChevronsRight },
  { id: 'left', label: t('command.view.setViewLeft'), icon: ChevronLeft },
  { id: 'right', label: t('command.view.setViewRight'), icon: ChevronRight },
  { id: 'back', label: t('command.view.setViewBack'), icon: ChevronsLeft },
  { id: 'bottom', label: t('command.view.setViewBottom'), icon: ChevronsDown },
])
</script>

<template>
  <div
    class="flex flex-col gap-3 border-b border-sidebar-border bg-sidebar p-4 pr-2 text-sidebar-foreground"
  >
    <!-- 工具栏第一行：显示模式 -->
    <div class="flex flex-col items-start gap-1">
      <span class="text-[10px] font-medium text-muted-foreground select-none">{{
        t('sidebar.displayMode.label')
      }}</span>
      <div class="flex items-center gap-0.25">
        <SidebarToggleItem
          v-for="mode in displayModes"
          :key="mode.id"
          :model-value="displayMode === mode.id"
          @update:model-value="
            (v) => {
              if (v) displayMode = mode.id as any
            }
          "
          :tooltip="mode.label"
        >
          <component :is="mode.icon" class="h-4 w-4" />
        </SidebarToggleItem>
      </div>
    </div>

    <!-- 工具栏第二行：视图控制 -->
    <div class="flex flex-col items-start gap-1">
      <span class="text-[10px] font-medium text-muted-foreground select-none">{{
        t('menu.view')
      }}</span>
      <div class="flex w-full items-center justify-between">
        <SidebarToggleItem
          :model-value="viewPreset === 'perspective'"
          @update:model-value="
            (v) => {
              if (v) viewPreset = 'perspective'
            }
          "
          :tooltip="t('command.view.setViewPerspective')"
        >
          <Camera class="h-4 w-4" />
        </SidebarToggleItem>

        <div class="mx-0.5 h-4 w-px bg-sidebar-border"></div>

        <SidebarToggleItem
          v-for="view in viewPresets"
          :key="view.id"
          :model-value="viewPreset === view.id"
          @update:model-value="
            (v) => {
              if (v) viewPreset = view.id as any
            }
          "
          :tooltip="view.label"
        >
          <component :is="view.icon" class="h-4 w-4" />
        </SidebarToggleItem>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useEditorStore } from '../stores/editorStore'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import SidebarHeader from './SidebarHeader.vue'
import SidebarSelection from './SidebarSelection.vue'
import SidebarSelectionSettings from './SidebarSelectionSettings.vue'
import SidebarTransform from './SidebarTransform.vue'
import SidebarEditorSettings from './SidebarEditorSettings.vue'
import SidebarDisplaySettings from './SidebarDisplaySettings.vue'
import SidebarDesktopSettings from './SidebarDesktopSettings.vue'
import AiWorkspace from './ai/AiWorkspace.vue'
import SidebarToggleItem from './SidebarToggleItem.vue'
import IconMomo from './icons/IconMomo.vue'
import { useDesktopStore } from '../stores/desktopStore'
import {
  ChevronDown,
  ChevronUp,
  Laptop,
  Layers,
  PictureInPicture2,
  Settings2,
  SlidersHorizontal,
} from 'lucide-vue-next'

const editorStore = useEditorStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const desktopStore = useDesktopStore()
const { t } = useI18n()

const isCompactSidebar = useMediaQuery('(max-height: 700px)')
const isHeaderCollapsed = ref(false)
const hasSelection = computed(() => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0)

watch(
  isCompactSidebar,
  (compact, prevCompact) => {
    // 进入紧凑模式默认折叠，退出后自动展开
    if (compact && !prevCompact) {
      isHeaderCollapsed.value = true
      return
    }
    if (!compact) {
      isHeaderCollapsed.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="flex h-full w-full flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
  >
    <!-- 顶部工具栏 -->
    <SidebarHeader v-if="!isHeaderCollapsed" />

    <!-- 内容区域 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex h-full w-full flex-col">
        <div class="shrink-0 border-b p-2 pl-4">
          <div class="flex w-full max-w-[240px] items-center justify-between">
            <SidebarToggleItem
              :model-value="uiStore.sidebarView === 'structure'"
              @update:model-value="
                (v: boolean) => {
                  if (v) uiStore.setSidebarView('structure')
                }
              "
              :tooltip="t('sidebar.structure')"
              shortcut="1"
            >
              <Layers class="h-4 w-4" />
            </SidebarToggleItem>

            <SidebarToggleItem
              :model-value="uiStore.sidebarView === 'transform'"
              @update:model-value="
                (v: boolean) => {
                  if (v) uiStore.setSidebarView('transform')
                }
              "
              :tooltip="t('sidebar.transform')"
              shortcut="2"
            >
              <Settings2 class="h-4 w-4" />
            </SidebarToggleItem>

            <SidebarToggleItem
              :model-value="uiStore.sidebarView === 'editorSettings'"
              @update:model-value="
                (v: boolean) => {
                  if (v) uiStore.setSidebarView('editorSettings')
                }
              "
              :tooltip="t('sidebar.editorSettings')"
              shortcut="3"
            >
              <SlidersHorizontal class="h-4 w-4" />
            </SidebarToggleItem>
            <SidebarToggleItem
              :model-value="uiStore.sidebarView === 'displaySettings'"
              @update:model-value="
                (v: boolean) => {
                  if (v) uiStore.setSidebarView('displaySettings')
                }
              "
              :tooltip="t('sidebar.display.label')"
              shortcut="4"
            >
              <PictureInPicture2 class="h-4 w-4" />
            </SidebarToggleItem>

            <SidebarToggleItem
              v-if="desktopStore.isDesktop"
              :model-value="uiStore.sidebarView === 'desktopSettings'"
              @update:model-value="
                (v: boolean) => {
                  if (v) uiStore.setSidebarView('desktopSettings')
                }
              "
              :tooltip="t('sidebar.desktop.label')"
              shortcut="5"
            >
              <Laptop class="h-4 w-4" />
            </SidebarToggleItem>
            <SidebarToggleItem
              v-if="settingsStore.canUseExperimentalFeatures"
              :model-value="uiStore.sidebarView === 'ai'"
              @update:model-value="
                (v: boolean) => {
                  if (v) uiStore.setSidebarView('ai')
                }
              "
              :tooltip="t('ai.title')"
              shortcut="6"
            >
              <IconMomo class="h-4 w-4" />
            </SidebarToggleItem>

            <template v-if="isCompactSidebar">
              <div class="mx-0.5 h-4 w-px bg-sidebar-border" />
              <SidebarToggleItem
                :model-value="!isHeaderCollapsed"
                @update:model-value="
                  (v: boolean) => {
                    isHeaderCollapsed = !v
                  }
                "
                :tooltip="
                  isHeaderCollapsed ? t('sidebar.header.expand') : t('sidebar.header.collapse')
                "
              >
                <ChevronDown v-if="isHeaderCollapsed" class="h-4 w-4" />
                <ChevronUp v-else class="h-4 w-4" />
              </SidebarToggleItem>
            </template>
          </div>
        </div>

        <SidebarSelectionSettings v-show="uiStore.sidebarView === 'structure'" />

        <div
          v-if="uiStore.sidebarView === 'structure'"
          v-show="hasSelection"
          class="mt-0 flex min-h-0 flex-1 flex-col gap-3"
        >
          <!-- 选中物品组件 -->
          <SidebarSelection class="min-h-0 flex-1" />
        </div>

        <div v-else-if="uiStore.sidebarView === 'transform'" class="mt-0 min-h-0 flex-1">
          <!-- 变换面板 -->
          <ScrollArea class="h-full">
            <div v-if="!hasSelection" class="pt-10 text-center text-xs text-muted-foreground">
              {{ t('sidebar.noSelection') }}
            </div>
            <SidebarTransform />

            <ScrollBar orientation="vertical" class="!w-1.5" />
          </ScrollArea>
        </div>

        <div v-else-if="uiStore.sidebarView === 'editorSettings'" class="mt-0 min-h-0 flex-1">
          <!-- 编辑器设置面板 -->
          <SidebarEditorSettings class="h-full" />
        </div>
        <div v-else-if="uiStore.sidebarView === 'displaySettings'" class="mt-0 min-h-0 flex-1">
          <SidebarDisplaySettings class="h-full" />
        </div>
        <div v-else-if="uiStore.sidebarView === 'desktopSettings'" class="mt-0 min-h-0 flex-1">
          <SidebarDesktopSettings class="h-full" />
        </div>
        <AiWorkspace
          v-else-if="settingsStore.canUseExperimentalFeatures && uiStore.sidebarView === 'ai'"
          class="min-h-0 flex-1"
        />
      </div>
    </div>
  </div>
</template>

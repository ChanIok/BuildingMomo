<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useEditorStore } from '../stores/editorStore'
import { useUIStore } from '../stores/uiStore'
import { useI18n } from '../composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import SidebarHeader from './SidebarHeader.vue'
import SidebarSelection from './SidebarSelection.vue'
import SidebarTransform from './SidebarTransform.vue'
import SidebarEditorSettings from './SidebarEditorSettings.vue'
import SidebarToggleItem from './SidebarToggleItem.vue'
import { ChevronDown, ChevronUp, Layers, Settings2, SlidersHorizontal } from 'lucide-vue-next'

const editorStore = useEditorStore()
const uiStore = useUIStore()
const { t } = useI18n()

const isCompactSidebar = useMediaQuery('(max-height: 700px)')
const isHeaderCollapsed = ref(false)

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
    class="flex h-full w-64 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
  >
    <!-- 顶部工具栏 -->
    <SidebarHeader v-if="!isHeaderCollapsed" />

    <!-- 内容区域 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex h-full w-full flex-col">
        <div class="shrink-0 border-b p-2 pl-4">
          <div class="flex items-center justify-between gap-2 bg-transparent p-0">
            <div class="flex gap-1">
              <SidebarToggleItem
                :model-value="uiStore.sidebarView === 'structure'"
                @update:model-value="
                  (v: boolean) => {
                    if (v) uiStore.setSidebarView('structure')
                  }
                "
                :tooltip="`${t('sidebar.structure')} (1)`"
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
                :tooltip="`${t('sidebar.transform')} (2)`"
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
                :tooltip="`${t('sidebar.editorSettings')} (3)`"
              >
                <SlidersHorizontal class="h-4 w-4" />
              </SidebarToggleItem>
            </div>

            <SidebarToggleItem
              v-if="isCompactSidebar"
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
          </div>
        </div>

        <!-- 全局提示信息 -->
        <div
          v-if="
            uiStore.sidebarView !== 'editorSettings' &&
            (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) === 0
          "
          class="pt-10 text-center text-xs text-muted-foreground"
        >
          {{ t('sidebar.noSelection') }}
        </div>

        <div
          v-if="uiStore.sidebarView === 'structure'"
          class="mt-0 flex min-h-0 flex-1 flex-col gap-3"
        >
          <!-- 选中物品组件 -->
          <SidebarSelection class="min-h-0 flex-1" />
        </div>

        <div v-else-if="uiStore.sidebarView === 'transform'" class="mt-0 min-h-0 flex-1">
          <!-- 变换面板 -->
          <ScrollArea class="h-full">
            <SidebarTransform />

            <ScrollBar orientation="vertical" class="!w-1.5" />
          </ScrollArea>
        </div>

        <div v-else-if="uiStore.sidebarView === 'editorSettings'" class="mt-0 min-h-0 flex-1">
          <!-- 编辑器设置面板 -->
          <SidebarEditorSettings class="h-full" />
        </div>
      </div>
    </div>
  </div>
</template>

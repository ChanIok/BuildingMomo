<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useI18n } from '../composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import SidebarHeader from './SidebarHeader.vue'
import SidebarSelection from './SidebarSelection.vue'
import SidebarTransform from './SidebarTransform.vue'
import SidebarToggleItem from './SidebarToggleItem.vue'
import { Layers, Settings2 } from 'lucide-vue-next'

const editorStore = useEditorStore()
const { t } = useI18n()
const currentView = ref<'structure' | 'transform'>('structure')
</script>

<template>
  <div class="flex h-full w-64 flex-col border-x">
    <!-- 顶部工具栏 -->
    <SidebarHeader />

    <!-- 内容区域 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex h-full w-full flex-col">
        <div class="shrink-0 border-b p-2 pl-4">
          <div class="flex gap-1 bg-transparent p-0">
            <SidebarToggleItem
              :model-value="currentView === 'structure'"
              @update:model-value="
                (v: boolean) => {
                  if (v) currentView = 'structure'
                }
              "
              :tooltip="t('sidebar.structure')"
            >
              <Layers class="h-4 w-4" />
            </SidebarToggleItem>

            <SidebarToggleItem
              :model-value="currentView === 'transform'"
              @update:model-value="
                (v: boolean) => {
                  if (v) currentView = 'transform'
                }
              "
              :tooltip="t('sidebar.transform')"
            >
              <Settings2 class="h-4 w-4" />
            </SidebarToggleItem>
          </div>
        </div>

        <!-- 全局提示信息 -->
        <div
          v-if="(editorStore.activeScheme?.selectedItemIds.value.size ?? 0) === 0"
          class="pt-10 text-center text-xs text-gray-500"
        >
          {{ t('sidebar.noSelection') }}
        </div>

        <div v-if="currentView === 'structure'" class="mt-0 flex min-h-0 flex-1 flex-col gap-3">
          <!-- 选中物品组件 -->
          <SidebarSelection class="min-h-0 flex-1" />
        </div>

        <div v-else-if="currentView === 'transform'" class="mt-0 min-h-0 flex-1">
          <!-- 变换面板 -->
          <ScrollArea class="h-full">
            <SidebarTransform />

            <ScrollBar orientation="vertical" class="!w-1.5" />
          </ScrollArea>
        </div>
      </div>
    </div>
  </div>
</template>

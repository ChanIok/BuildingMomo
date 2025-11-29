<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import SidebarHeader from './SidebarHeader.vue'
import SidebarSelection from './SidebarSelection.vue'
import SidebarTransform from './SidebarTransform.vue'
import { Layers, Settings2 } from 'lucide-vue-next'

const editorStore = useEditorStore()
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
            <TooltipProvider>
              <Tooltip :delay-duration="300">
                <TooltipTrigger as-child>
                  <div class="inline-flex">
                    <Toggle
                      size="sm"
                      :model-value="currentView === 'structure'"
                      @update:model-value="
                        (v: boolean) => {
                          if (v) currentView = 'structure'
                        }
                      "
                    >
                      <Layers class="h-4 w-4" />
                    </Toggle>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="text-xs"> 结构 </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip :delay-duration="300">
                <TooltipTrigger as-child>
                  <div class="inline-flex">
                    <Toggle
                      size="sm"
                      :model-value="currentView === 'transform'"
                      @update:model-value="
                        (v: boolean) => {
                          if (v) currentView = 'transform'
                        }
                      "
                      class="h-9 w-9 p-0 data-[state=on]:bg-gray-100 data-[state=on]:shadow-none"
                    >
                      <Settings2 class="h-4 w-4" />
                    </Toggle>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="text-xs"> 变换 </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <!-- 全局提示信息 -->
        <div
          v-if="editorStore.selectedItems.length === 0"
          class="pt-10 text-center text-xs text-gray-500"
        >
          请选择物品查看详情或进行操作
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

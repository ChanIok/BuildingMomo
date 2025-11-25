<script setup lang="ts">
import { useEditorStore } from '../stores/editorStore'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import SidebarHeader from './SidebarHeader.vue'
import SidebarSelection from './SidebarSelection.vue'
import SidebarTransform from './SidebarTransform.vue'

const editorStore = useEditorStore()
</script>

<template>
  <div class="flex h-full w-64 flex-col">
    <!-- 顶部工具栏 -->
    <SidebarHeader />

    <!-- 内容区域 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs default-value="structure" class="flex h-full w-full flex-col">
        <div class="shrink-0 px-3 pt-3">
          <TabsList class="grid w-full grid-cols-2 bg-background p-0">
            <TabsTrigger
              value="structure"
              class="data-[state=active]:bg-gray-100 data-[state=active]:shadow-none"
            >
              结构
            </TabsTrigger>
            <TabsTrigger
              value="transform"
              class="data-[state=active]:bg-gray-100 data-[state=active]:shadow-none"
            >
              变换
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="structure"
          :force-mount="true"
          class="mt-0 flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 data-[state=inactive]:hidden"
        >
          <!-- 选中物品组件 -->
          <SidebarSelection class="min-h-0 flex-1" />
        </TabsContent>

        <TabsContent
          value="transform"
          :force-mount="true"
          class="mt-0 min-h-0 flex-1 px-3 pb-3 data-[state=inactive]:hidden"
        >
          <!-- 变换面板 -->
          <ScrollArea class="h-full">
            <SidebarTransform />

            <ScrollBar orientation="vertical" class="!w-1.5" />
          </ScrollArea>
        </TabsContent>

        <!-- 全局提示信息 -->
        <div
          v-if="editorStore.selectedItems.length === 0"
          class="px-3 pb-3 text-center text-xs text-gray-500"
        >
          请选择物品查看详情或进行操作
        </div>
      </Tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTabStore } from '../stores/tabStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import QuickStart from './docs/QuickStart.vue'
import UserGuide from './docs/UserGuide.vue'
import FAQ from './docs/FAQ.vue'

const tabStore = useTabStore()

// 菜单项配置
const menuItems = [
  { id: 'quickstart', label: '快速上手', component: QuickStart },
  { id: 'guide', label: '使用指南', component: UserGuide },
  { id: 'faq', label: '常见问题', component: FAQ },
]

// 当前文档页面：直接从标签读取，默认为快速上手
const currentDoc = computed(() => tabStore.activeTab?.docPage || 'quickstart')

// 当前文档组件
const currentComponent = computed(() => {
  return menuItems.find((item) => item.id === currentDoc.value)?.component || QuickStart
})

// 切换文档页面：更新标签的 docPage 属性
function switchDoc(value: string | number) {
  const docPage = String(value)
  tabStore.updateDocPage(docPage)
}
</script>

<template>
  <!-- 桌面端：VitePress 风格居中布局 -->
  <div class="hidden h-full md:flex">
    <!-- 左侧弹性空白区 -->
    <div class="min-w-0 flex-1 bg-muted/40"></div>

    <!-- 中间固定宽度主体 -->
    <div class="flex w-full max-w-[1440px]">
      <!-- 左侧导航栏 -->
      <nav class="flex w-64 shrink-0 flex-col border-r bg-muted/40">
        <!-- 标题区 -->
        <div class="border-b p-6">
          <h2 class="text-lg font-semibold text-foreground">搬砖吧大喵 文档</h2>
          <p class="mt-1 text-xs text-muted-foreground">使用指南与帮助</p>
        </div>

        <!-- 菜单列表 -->
        <ScrollArea class="flex-1 py-4">
          <ul class="space-y-1 px-3">
            <li v-for="item in menuItems" :key="item.id">
              <button
                @click="switchDoc(item.id)"
                :class="[
                  'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                  currentDoc === item.id
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-foreground hover:bg-accent/50',
                ]"
              >
                {{ item.label }}
              </button>
            </li>
          </ul>
        </ScrollArea>

        <!-- 底部信息 -->
        <div class="space-y-2 border-t p-6 text-xs text-muted-foreground">
          <a
            href="https://github.com/ChanIok/BuildingMomo"
            target="_blank"
            rel="noopener noreferrer"
            class="text-blue-600 hover:underline dark:text-blue-400"
          >
            GitHub 仓库
          </a>
        </div>
      </nav>

      <!-- 右侧内容区 -->
      <ScrollArea class="min-w-0 flex-1 bg-background">
        <component :is="currentComponent" />
      </ScrollArea>
    </div>

    <!-- 右侧弹性空白区 -->
    <div class="min-w-0 flex-1 bg-background"></div>
  </div>

  <!-- 移动端：Tabs 布局 -->
  <div class="flex h-full flex-col bg-background md:hidden">
    <Tabs :model-value="currentDoc" @update:model-value="switchDoc" class="flex h-full flex-col">
      <!-- 标签头 -->
      <div class="p-4">
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="quickstart">快速上手</TabsTrigger>
          <TabsTrigger value="guide">使用指南</TabsTrigger>
          <TabsTrigger value="faq">常见问题</TabsTrigger>
        </TabsList>
      </div>

      <!-- 内容区 -->
      <ScrollArea class="min-h-0 flex-1">
        <TabsContent value="quickstart">
          <QuickStart />
        </TabsContent>
        <TabsContent value="guide">
          <UserGuide />
        </TabsContent>
        <TabsContent value="faq">
          <FAQ />
        </TabsContent>
      </ScrollArea>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onActivated, nextTick } from 'vue'
import { useTabStore } from '../stores/tabStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import QuickStart from './docs/QuickStart.vue'
import UserGuide from './docs/UserGuide.vue'
import FAQ from './docs/FAQ.vue'
import { useEventListener, useDebounceFn } from '@vueuse/core'

const tabStore = useTabStore()

// 菜单项配置
const menuItems = [
  { id: 'quickstart', label: '快速上手', component: QuickStart },
  { id: 'guide', label: '使用指南', component: UserGuide },
  { id: 'faq', label: '常见问题', component: FAQ },
]

// 当前文档页面：查找 doc 类型的标签，保持状态稳定
const docTab = computed(() => tabStore.tabs.find((t) => t.type === 'doc'))
const currentDoc = computed(() => docTab.value?.docPage || 'quickstart')

// 当前文档组件
const currentComponent = computed(() => {
  return menuItems.find((item) => item.id === currentDoc.value)?.component || QuickStart
})

// 滚动区域引用
const desktopScrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const mobileScrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const savedScrollTop = ref(0)

// 获取滚动视口元素
function getViewport(instance: InstanceType<typeof ScrollArea> | null) {
  return instance?.$el?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null
}

// 监听滚动并记录（防抖处理）
const handleScroll = useDebounceFn((e: Event) => {
  const target = e.target as HTMLElement
  if (target) {
    savedScrollTop.value = target.scrollTop
  }
}, 100)

// 绑定滚动监听
function attachScrollListener(viewport: HTMLElement | null) {
  if (!viewport) return
  useEventListener(viewport, 'scroll', handleScroll)
}

// 切换文档页面时：重置滚动位置
watch(currentDoc, async () => {
  savedScrollTop.value = 0
  await nextTick()

  const desktopViewport = getViewport(desktopScrollRef.value)
  if (desktopViewport) desktopViewport.scrollTop = 0

  const mobileViewport = getViewport(mobileScrollRef.value)
  if (mobileViewport) mobileViewport.scrollTop = 0
})

// 进入标签时：恢复滚动位置并绑定监听
onActivated(async () => {
  await nextTick()

  // 桌面端处理
  const desktopViewport = getViewport(desktopScrollRef.value)
  if (desktopViewport) {
    desktopViewport.scrollTop = savedScrollTop.value
    attachScrollListener(desktopViewport)
  }

  // 移动端处理
  const mobileViewport = getViewport(mobileScrollRef.value)
  if (mobileViewport) {
    mobileViewport.scrollTop = savedScrollTop.value
    attachScrollListener(mobileViewport)
  }
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
      <ScrollArea ref="desktopScrollRef" class="min-w-0 flex-1 bg-background">
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
      <ScrollArea ref="mobileScrollRef" class="min-h-0 flex-1">
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

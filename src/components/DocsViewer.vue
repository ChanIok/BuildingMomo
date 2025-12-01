<script setup lang="ts">
import { computed, ref, watch, onActivated, nextTick, defineAsyncComponent } from 'vue'
import type { AsyncComponentLoader } from 'vue'
import { useTabStore } from '../stores/tabStore'
import { useI18n } from '../composables/useI18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEventListener, useDebounceFn } from '@vueuse/core'

// 动态导入文档组件，支持语言切换
const docsComponents = {
  zh: {
    QuickStart: () => import('./docs/QuickStart.vue'),
    UserGuide: () => import('./docs/UserGuide.vue'),
    FAQ: () => import('./docs/FAQ.vue'),
  },
  en: {
    QuickStart: () => import('./docs/QuickStart.en.vue'),
    UserGuide: () => import('./docs/UserGuide.en.vue'),
    FAQ: () => import('./docs/FAQ.en.vue'),
  },
}

const tabStore = useTabStore()
const { t, locale } = useI18n()

// 菜单项配置 - 根据语言加载对应文档
const menuItems = computed(() => [
  { id: 'quickstart', label: t('doc.quickstart') },
  { id: 'guide', label: t('doc.guide') },
  { id: 'faq', label: t('doc.faq') },
])

// 当前文档页面：查找 doc 类型的标签，保持状态稳定
const docTab = computed(() => tabStore.tabs.find((t) => t.type === 'doc'))
const currentDoc = computed(() => docTab.value?.docPage || 'quickstart')

// 当前文档组件 - 根据语言动态加载
const currentComponent = computed(() => {
  // 映射 ID 到组件属性名
  const componentMap: Record<string, 'QuickStart' | 'UserGuide' | 'FAQ'> = {
    quickstart: 'QuickStart',
    guide: 'UserGuide',
    faq: 'FAQ',
  }
  const componentName = componentMap[currentDoc.value] || 'QuickStart'
  const loader = docsComponents[locale.value][componentName] as AsyncComponentLoader<any>
  return defineAsyncComponent(loader)
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
          <h2 class="text-lg font-semibold text-foreground">{{ t('doc.title') }}</h2>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('doc.subtitle') }}</p>
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
            {{ t('doc.github') }}
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
          <TabsTrigger value="quickstart">{{ t('doc.quickstart') }}</TabsTrigger>
          <TabsTrigger value="guide">{{ t('doc.guide') }}</TabsTrigger>
          <TabsTrigger value="faq">{{ t('doc.faq') }}</TabsTrigger>
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

<script setup lang="ts">
import { computed, ref, nextTick, onMounted } from 'vue'
import { useEventListener } from '@vueuse/core'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from '@/components/ui/menubar'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useCommandStore } from '../stores/commandStore'
import { useEditorStore } from '../stores/editorStore'
import { useTabStore } from '../stores/tabStore'
import { useI18n } from '../composables/useI18n'
import { X, Settings, BookOpen } from 'lucide-vue-next'
import SettingsDialog from './SettingsDialog.vue'

// 使用命令系統 Store
const commandStore = useCommandStore()
const editorStore = useEditorStore()
const tabStore = useTabStore()
const { t } = useI18n()

// 按分类获取命令
const fileCommands = computed(() => commandStore.getCommandsByCategory('file'))
const editCommands = computed(() => commandStore.getCommandsByCategory('edit'))
const viewCommands = computed(() => commandStore.getCommandsByCategory('view'))

// 视图预设命令（透视 + 正交六视图）
const VIEW_PRESET_IDS = [
  'view.setViewPerspective',
  'view.setViewTop',
  'view.setViewBottom',
  'view.setViewFront',
  'view.setViewBack',
  'view.setViewRight',
  'view.setViewLeft',
]

// 主视图命令（不包括视图预设）
const mainViewCommands = computed(() =>
  viewCommands.value.filter((cmd) => !VIEW_PRESET_IDS.includes(cmd.id))
)

// 视图预设命令，保持在 commandStore 中定义的顺序
const viewPresetCommands = computed(() =>
  viewCommands.value.filter((cmd) => VIEW_PRESET_IDS.includes(cmd.id))
)

// 监控状态
const watchState = computed(() => commandStore.fileOps.watchState)

// 标签容器引用
const tabsContainer = ref<HTMLElement | null>(null)
const scrollAreaRef = ref<HTMLElement | null>(null)

// 设置对话框状态
const settingsDialogOpen = ref(false)

// 执行命令
function handleCommand(commandId: string) {
  commandStore.executeCommand(commandId)
}

// 检查命令是否可用
function isEnabled(commandId: string): boolean {
  return commandStore.isCommandEnabled(commandId)
}

// 切换标签
function switchTab(tabId: string) {
  tabStore.setActiveTab(tabId)

  // 如果是方案标签，同步更新 editorStore
  const tab = tabStore.tabs.find((t) => t.id === tabId)
  if (tab?.type === 'scheme' && tab.schemeId) {
    editorStore.setActiveScheme(tab.schemeId)
  }

  // 滚动到激活的标签
  nextTick(() => {
    const activeTab = tabsContainer.value?.querySelector('[data-tab-active="true"]')
    activeTab?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  })
}

// 关闭标签
function closeTab(tabId: string, event: Event) {
  event.stopPropagation()
  const tab = tabStore.tabs.find((t) => t.id === tabId)

  // 如果是方案标签，关闭方案（会触发 tabStore.closeTab）
  if (tab?.type === 'scheme' && tab.schemeId) {
    editorStore.closeScheme(tab.schemeId)
  } else {
    // 文档标签直接关闭
    tabStore.closeTab(tabId)
  }
}

// 自定义滚轮事件：将垂直滚动转换为横向滚动
function handleWheel(event: WheelEvent) {
  if (!scrollAreaRef.value) return

  // 获取 ScrollArea 组件的根 DOM 元素
  const scrollAreaElement = (scrollAreaRef.value as any).$el as HTMLElement
  if (!scrollAreaElement) return

  // 查找 ScrollArea 的 viewport 元素
  const viewport = scrollAreaElement.querySelector(
    '[data-slot="scroll-area-viewport"]'
  ) as HTMLElement
  if (!viewport) return

  // 阻止默认的垂直滚动
  event.preventDefault()

  // 将垂直滚动量转换为横向滚动
  viewport.scrollLeft += event.deltaY
}

// 使用 VueUse 的 useEventListener 监听滚轮事件
onMounted(() => {
  nextTick(() => {
    if (scrollAreaRef.value) {
      const scrollAreaElement = (scrollAreaRef.value as any).$el as HTMLElement
      if (scrollAreaElement) {
        useEventListener(scrollAreaElement, 'wheel', handleWheel, { passive: false })
      }
    }
  })
})
</script>

<template>
  <div class="flex h-10 items-center gap-2 px-2 pt-2">
    <!-- 左侧：Menubar 菜单栏 -->
    <Menubar class="flex-none border-none bg-transparent shadow-none">
      <!-- 文件菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">{{ t('menu.file') }}</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <template v-for="cmd in fileCommands" :key="cmd.id">
            <!-- 在"保存到游戏"、"选择游戏目录"、"导入"之前添加分隔线 -->
            <MenubarSeparator
              v-if="
                cmd.id === 'file.import' ||
                cmd.id === 'file.saveToGame' ||
                cmd.id === 'file.startWatchMode'
              "
            />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarMenu>

      <!-- 编辑菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">{{ t('menu.edit') }}</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <template v-for="cmd in editCommands" :key="cmd.id">
            <!-- 在"剪切 "、"移动"、"删除"、"全选"、"成组"之前添加分隔线 -->
            <MenubarSeparator
              v-if="
                cmd.id === 'edit.cut' ||
                cmd.id === 'edit.move' ||
                cmd.id === 'edit.delete' ||
                cmd.id === 'edit.selectAll' ||
                cmd.id === 'edit.group'
              "
            />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarMenu>

      <!-- 视图菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">{{ t('menu.view') }}</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <!-- 主视图命令（缩放、重置视图、聚焦、2D/3D、工作坐标系等） -->
          <template v-for="cmd in mainViewCommands" :key="cmd.id">
            <!-- 在“重置视图”、“工作坐标系”之前添加分隔线 -->
            <MenubarSeparator
              v-if="cmd.id === 'view.fitToView' || cmd.id === 'view.coordinateSystem'"
            />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>

          <!-- 主视图命令与视图预设之间的分隔线 -->
          <MenubarSeparator />

          <!-- 视图预设子菜单：透视视图 + 正交六视图 -->
          <MenubarSub>
            <MenubarSubTrigger>{{ t('command.view.viewPreset') }}</MenubarSubTrigger>
            <MenubarSubContent>
              <template v-for="cmd in viewPresetCommands" :key="cmd.id">
                <!-- 在“顶视图”之前添加分隔线，将透视视图与正交视图分组 -->
                <MenubarSeparator v-if="cmd.id === 'view.setViewTop'" />
                <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
                  {{ cmd.label }}
                  <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
                </MenubarItem>
              </template>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <!-- 帮助菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">{{ t('menu.help') }}</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <MenubarItem @click="tabStore.openDocTab()">
            {{ t('command.help.openDocs') }}
            <MenubarShortcut>F1</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>

    <!-- 中间：标签栏（可滚动） -->
    <ScrollArea v-if="tabStore.tabs.length > 0" ref="scrollAreaRef" class="min-w-0 flex-1">
      <div ref="tabsContainer" class="flex w-max gap-1">
        <button
          v-for="tab in tabStore.tabs"
          :key="tab.id"
          :data-tab-active="tabStore.activeTabId === tab.id"
          @click="switchTab(tab.id)"
          class="group relative my-2 flex flex-none items-center gap-2 rounded-sm border px-3 py-1 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          :class="
            tabStore.activeTabId === tab.id
              ? 'border-border bg-background text-foreground'
              : 'border-border/60 bg-secondary text-muted-foreground hover:border-border hover:bg-secondary/80'
          "
        >
          <!-- 文档标签图标 -->
          <BookOpen v-if="tab.type === 'doc'" class="h-3 w-3" />

          <span class="max-w-[150px] truncate">
            {{ tab.title }}
          </span>
          <Button
            @click="closeTab(tab.id, $event)"
            variant="ghost"
            size="icon"
            :class="[
              'h-4 w-4 flex-shrink-0 transition-opacity',
              tabStore.activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            ]"
            :title="`关闭 ${tab.title}`"
          >
            <X class="h-3 w-3" />
          </Button>
        </button>
      </div>
      <ScrollBar orientation="horizontal" class="h-1.5" />
    </ScrollArea>

    <!-- 右侧：监控状态 + 设置按钮（始终固定在最右边） -->
    <div class="ml-auto flex flex-none items-center gap-2">
      <!-- 监控状态指示器 -->
      <div v-if="watchState.isActive" class="flex flex-none items-center gap-2">
        <div class="flex items-center gap-2 rounded-md bg-green-50 px-3 py-1.5">
          <div class="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
          <span class="text-xs font-medium text-green-700">监控中</span>
          <span class="text-xs text-green-600">{{ watchState.dirPath }}</span>
        </div>
      </div>

      <!-- 设置按钮 -->
      <Button variant="ghost" size="sm" @click="settingsDialogOpen = true" class="flex-none">
        <Settings class="h-4 w-4" />
      </Button>
    </div>

    <!-- 设置对话框 -->
    <SettingsDialog v-model:open="settingsDialogOpen" />
  </div>
</template>

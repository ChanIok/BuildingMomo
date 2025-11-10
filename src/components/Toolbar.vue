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
} from '@/components/ui/menubar'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useCommandStore } from '../stores/commandStore'
import { useEditorStore } from '../stores/editorStore'
import { X, Settings } from 'lucide-vue-next'
import SettingsDialog from './SettingsDialog.vue'

// 使用命令系统 Store
const commandStore = useCommandStore()
const editorStore = useEditorStore()

// 按分类获取命令
const fileCommands = computed(() => commandStore.getCommandsByCategory('file'))
const editCommands = computed(() => commandStore.getCommandsByCategory('edit'))
const viewCommands = computed(() => commandStore.getCommandsByCategory('view'))

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

// 切换方案
function switchScheme(schemeId: string) {
  editorStore.setActiveScheme(schemeId)

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

// 关闭方案
function closeScheme(schemeId: string, event: Event) {
  event.stopPropagation()
  editorStore.closeScheme(schemeId)
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
        <MenubarTrigger class="text-sm font-medium">文件</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <template v-for="cmd in fileCommands" :key="cmd.id">
            <!-- 在"导出"、"保存到游戏"、"选择游戏目录"之前添加分隔线 -->
            <MenubarSeparator
              v-if="
                cmd.id === 'file.import' || cmd.id === 'file.export' || cmd.id === 'file.saveToGame'
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
        <MenubarTrigger class="text-sm font-medium">编辑</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <template v-for="cmd in editCommands" :key="cmd.id">
            <!-- 在"剪切 "、"移动"、"删除"、"全选"之前添加分隔线 -->
            <MenubarSeparator
              v-if="
                cmd.id === 'edit.cut' ||
                cmd.id === 'edit.move' ||
                cmd.id === 'edit.delete' ||
                cmd.id === 'edit.selectAll'
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
        <MenubarTrigger class="text-sm font-medium">视图</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <template v-for="cmd in viewCommands" :key="cmd.id">
            <!-- 在"重置视图"之前添加分隔线 -->
            <MenubarSeparator
              v-if="cmd.id === 'view.fitToView' || cmd.id === 'view.coordinateSystem'"
            />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>

    <!-- 中间：方案标签栏（可滚动） -->
    <ScrollArea v-if="editorStore.schemes.length > 0" ref="scrollAreaRef" class="min-w-0 flex-1">
      <div ref="tabsContainer" class="flex w-max gap-1">
        <button
          v-for="scheme in editorStore.schemes"
          :key="scheme.id"
          :data-tab-active="editorStore.activeSchemeId === scheme.id"
          @click="switchScheme(scheme.id)"
          class="group relative my-2 flex flex-none items-center gap-2 rounded-sm border px-3 py-1 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          :class="
            editorStore.activeSchemeId === scheme.id
              ? 'border-border bg-background text-foreground'
              : 'border-border/60 bg-secondary text-muted-foreground hover:border-border hover:bg-secondary/80'
          "
        >
          <span class="max-w-[150px] truncate">
            {{ scheme.name }}
          </span>
          <button
            @click="closeScheme(scheme.id, $event)"
            class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-300 dark:hover:bg-gray-600"
            :title="`关闭 ${scheme.name}`"
          >
            <X class="h-3 w-3" />
          </button>
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

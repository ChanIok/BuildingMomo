<script setup lang="ts">
import { computed, ref, nextTick, onMounted, watch, onUnmounted } from 'vue'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCommandStore } from '../stores/commandStore'
import { useEditorStore } from '../stores/editorStore'
import { useTabStore } from '../stores/tabStore'
import { useI18n } from '../composables/useI18n'
import { Item, ItemContent } from '@/components/ui/item'
import { X, Settings, BookOpen, FolderSearch, Download, Trash2 } from 'lucide-vue-next'
import SettingsDialog from './SettingsDialog.vue'
import SchemeSettingsDialog from './SchemeSettingsDialog.vue'
import ImportCodeDialog from './ImportCodeDialog.vue'
import { useSettingsStore } from '../stores/settingsStore'

// 使用命令系統 Store
const commandStore = useCommandStore()
const editorStore = useEditorStore()
const tabStore = useTabStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// 按分类获取命令（添加过滤）
const fileCommands = computed(() => {
  const cmds = commandStore.getCommandsByCategory('file')

  return cmds.filter((cmd) => {
    if (cmd.id === 'file.importFromCode') {
      // 只在 secure 模式且已认证时显示
      return import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' && settingsStore.isAuthenticated
    }
    return true
  })
})
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

// 分组命令 ID
const NAVIGATION_CMD_IDS = ['view.focusSelection', 'view.fitToView']
const CAMERA_MODE_CMD_ID = 'view.toggleCameraMode'
const FULLSCREEN_CMD_ID = 'view.toggleFullscreen'
const COORDINATE_CMD_ID = 'view.coordinateSystem'
const TOGGLE_GIZMO_SPACE_CMD_ID = 'view.toggleGizmoSpace'
const WORKING_COORD_CMD_IDS = [
  'view.setWorkingCoordinateFromSelection',
  'view.resetWorkingCoordinate',
]

// 导航组命令（聚焦、重置视图）
const navigationCommands = computed(() =>
  viewCommands.value.filter((cmd) => NAVIGATION_CMD_IDS.includes(cmd.id))
)

// 相机模式命令
const cameraModeCommand = computed(() =>
  viewCommands.value.find((cmd) => cmd.id === CAMERA_MODE_CMD_ID)
)

// 全屏命令
const fullscreenCommand = computed(() =>
  viewCommands.value.find((cmd) => cmd.id === FULLSCREEN_CMD_ID)
)

// 坐标系命令
const coordinateCommand = computed(() =>
  viewCommands.value.find((cmd) => cmd.id === COORDINATE_CMD_ID)
)

// 切换坐标系命令
const toggleGizmoSpaceCommand = computed(() =>
  viewCommands.value.find((cmd) => cmd.id === TOGGLE_GIZMO_SPACE_CMD_ID)
)

// 工作坐标系操作命令（Z、Shift+Z）
const workingCoordCommands = computed(() =>
  viewCommands.value.filter((cmd) => WORKING_COORD_CMD_IDS.includes(cmd.id))
)

// 视图预设命令，保持在 commandStore 中定义的顺序
const viewPresetCommands = computed(() =>
  viewCommands.value.filter((cmd) => VIEW_PRESET_IDS.includes(cmd.id))
)

// 监控状态
const watchState = computed(() => commandStore.fileOps.watchState)
const watchHistory = computed(() => commandStore.fileOps.getWatchHistory())
const showWatchButton = computed(() => !!editorStore.activeScheme || watchState.value.isActive)
const hasWatchedFiles = computed(() => watchState.value.fileIndex.size > 0)

// 监控中按钮的简单悬浮提示（自定义实现，避免影响 Popover）
const isWatchTooltipVisible = ref(false)

// 标签容器引用
const tabsContainer = ref<HTMLElement | null>(null)
const scrollAreaRef = ref<HTMLElement | null>(null)

// 设置对话框状态
const globalSettingsOpen = ref(false)
const schemeSettingsOpen = ref(false)
const schemeSettingsTargetId = ref('')
const importCodeDialogOpen = ref(false)
const importCodeDialogRef = ref<InstanceType<typeof ImportCodeDialog> | null>(null)
const watchHistoryOpen = ref(false)

// 设置按钮 Tooltip 控制（避免与对话框冲突）
const isSettingsTooltipAllowed = ref(true)

// 当设置对话框打开/关闭时，控制 Tooltip 是否渲染
watch(globalSettingsOpen, (open) => {
  // 对话框打开时禁用 Tooltip 内容
  if (open) {
    isSettingsTooltipAllowed.value = false
  }
})

// 执行命令
function handleCommand(commandId: string) {
  // 特殊处理：从方案码导入命令打开对话框
  if (commandId === 'file.importFromCode') {
    importCodeDialogOpen.value = true
    return
  }

  commandStore.executeCommand(commandId)
}

// 检查命令是否可用
function isEnabled(commandId: string): boolean {
  return commandStore.isCommandEnabled(commandId)
}

// 处理从方案码导入
async function handleImportFromCode(code: string) {
  // 设置加载状态
  importCodeDialogRef.value?.setLoading(true)

  try {
    // 调用 fileOps 的导入方法
    await commandStore.fileOps.importFromCode(code)
    // 成功后关闭对话框
    importCodeDialogOpen.value = false
  } finally {
    // 无论成功失败，都重置加载状态
    importCodeDialogRef.value?.setLoading(false)
  }
}

// 读取最新方案
async function handleImportLatest() {
  watchHistoryOpen.value = false
  await commandStore.fileOps.importFromWatchedFile()
}

// 从历史记录导入
async function handleImportFromHistory(historyId: string) {
  watchHistoryOpen.value = false
  await commandStore.fileOps.importFromHistory(historyId)
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  if (diffMs < 0) {
    return t('watchMode.history.justNow')
  }

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return t('watchMode.history.justNow')
  if (minutes < 60) return t('watchMode.history.minutesAgo', { n: minutes })

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('watchMode.history.hoursAgo', { n: hours })

  const days = Math.floor(hours / 24)
  return t('watchMode.history.daysAgo', { n: days })
}

function handleStartWatchMode() {
  handleCommand('file.startWatchMode')
}

function handleClearHistory() {
  commandStore.fileOps.clearWatchHistory()
}

// 删除单条历史记录
async function handleDeleteHistoryRecord(historyId: string, event: Event) {
  event.stopPropagation() // 阻止触发导入操作
  try {
    await commandStore.fileOps.deleteHistoryRecord(historyId)
  } catch (error) {
    console.error('[Toolbar] Failed to delete history record:', error)
  }
}

// --- 拖拽逻辑 (Pointer Events) ---

const draggingTabId = ref<string | null>(null)
const pressedTabId = ref<string | null>(null)
const pressedTabEl = ref<HTMLElement | null>(null)
const dragOffset = ref(0)
const dragStartX = ref(0)
const initialTabX = ref(0)

// 启动拖拽
function handlePointerDown(tabId: string, event: PointerEvent) {
  // 忽略非左键点击
  if (event.button !== 0) return

  // 忽略点击关闭按钮的情况
  const target = event.target as HTMLElement
  if (target.closest('button')?.getAttribute('title')?.startsWith('关闭')) {
    return
  }

  const tabEl = event.currentTarget as HTMLElement
  if (!tabEl) return

  // 记录初始状态，但不立即捕获或设置拖拽状态
  pressedTabId.value = tabId
  pressedTabEl.value = tabEl
  dragStartX.value = event.clientX
  // 记录初始位置相对视口的 x 坐标，用于后续计算回弹
  initialTabX.value = tabEl.getBoundingClientRect().x
  dragOffset.value = 0

  // 添加全局移动和释放监听
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

function handlePointerMove(event: PointerEvent) {
  // 如果正在拖拽
  if (draggingTabId.value) {
    // 计算偏移量
    const currentX = event.clientX
    const deltaX = currentX - dragStartX.value
    dragOffset.value = deltaX

    // --- 核心交换逻辑 ---
    // 只有移动距离超过一定阈值（防止抖动）才开始检测
    if (Math.abs(deltaX) > 10) {
      checkSwap(currentX)
    }
    return
  }

  // 如果处于待机状态（按下但未开始拖拽）
  if (pressedTabId.value) {
    const currentX = event.clientX
    const moveDist = Math.abs(currentX - dragStartX.value)

    // 移动超过阈值，开始拖拽
    if (moveDist > 5) {
      draggingTabId.value = pressedTabId.value

      // 捕获指针
      if (pressedTabEl.value) {
        try {
          pressedTabEl.value.setPointerCapture(event.pointerId)
        } catch (e) {
          // 忽略捕获失败
        }
      }

      // 更新初始偏移
      dragOffset.value = currentX - dragStartX.value
    }
  }
}

function checkSwap(cursorX: number) {
  if (!draggingTabId.value) return

  const currentIndex = tabStore.tabs.findIndex((t) => t.id === draggingTabId.value)
  if (currentIndex === -1) return

  // 获取所有标签元素
  const container = (tabsContainer.value as any)?.$el || tabsContainer.value
  if (!container) return

  const tabElements = Array.from(container.children) as HTMLElement[]

  // 检查前一个
  if (currentIndex > 0) {
    const prevEl = tabElements[currentIndex - 1]
    if (!prevEl) return

    const prevRect = prevEl.getBoundingClientRect()
    const prevCenter = prevRect.x + prevRect.width / 2

    // 如果鼠标（或者当前拖拽元素的左边缘）跨过了前一个元素的中心
    if (cursorX < prevCenter) {
      // 交换数据
      tabStore.moveTab(currentIndex, currentIndex - 1)

      // 修正 dragStartX：因为 DOM 元素位置变了，如果不修正，deltaX 会突变
      dragStartX.value -= prevRect.width // 向左换了，DOM位置变小，为了保持视觉位置，Offset需要变大，所以Start要变小
      dragOffset.value = cursorX - dragStartX.value
      return
    }
  }

  // 检查后一个
  if (currentIndex < tabStore.tabs.length - 1) {
    const nextEl = tabElements[currentIndex + 1]
    if (!nextEl) return

    const nextRect = nextEl.getBoundingClientRect()
    const nextCenter = nextRect.x + nextRect.width / 2

    if (cursorX > nextCenter) {
      tabStore.moveTab(currentIndex, currentIndex + 1)
      dragStartX.value += nextRect.width // 向右换了，DOM位置变大，为了保持视觉位置，Offset需要变小，所以Start要变大
      dragOffset.value = cursorX - dragStartX.value
    }
  }
}

function handlePointerUp() {
  // 清理状态
  draggingTabId.value = null
  pressedTabId.value = null
  pressedTabEl.value = null
  dragOffset.value = 0

  // 移除监听
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
}

onUnmounted(() => {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
})

// 滚动到激活的标签
function scrollToActiveTab() {
  nextTick(() => {
    // 兼容 TransitionGroup 组件引用
    const containerEl = (tabsContainer.value as any)?.$el || tabsContainer.value
    const activeTab = containerEl?.querySelector('[data-tab-active="true"]')
    activeTab?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  })
}

// 切换标签
function switchTab(tabId: string) {
  // 如果正在拖拽中且位移较大，不要触发切换（避免误触）
  if (draggingTabId.value && Math.abs(dragOffset.value) > 5) return

  tabStore.setActiveTab(tabId)

  // 如果是方案标签，同步更新 editorStore
  const tab = tabStore.tabs.find((t) => t.id === tabId)
  if (tab?.type === 'scheme' && tab.schemeId) {
    editorStore.setActiveScheme(tab.schemeId)
  }

  // 复用滚动逻辑
  scrollToActiveTab()
}

// 核心关闭逻辑
function performCloseTab(tabId: string) {
  const tab = tabStore.tabs.find((t) => t.id === tabId)
  if (!tab) return

  // 如果是方案标签，关闭方案（会触发 tabStore.closeTab）
  if (tab.type === 'scheme' && tab.schemeId) {
    editorStore.closeScheme(tab.schemeId)
  } else {
    // 文档标签直接关闭
    tabStore.closeTab(tabId)
  }
}

// 关闭标签（点击 X 按钮）
function handleCloseTabClick(tabId: string, event: Event) {
  event.stopPropagation()
  performCloseTab(tabId)
}

// 关闭其他标签
function closeOtherTabs(keepTabId: string) {
  // 创建副本以避免在遍历时修改数组导致的问题
  const tabsToClose = tabStore.tabs.filter((t) => t.id !== keepTabId)
  tabsToClose.forEach((t) => performCloseTab(t.id))
}

// 关闭所有标签
function closeAllTabs() {
  const tabsToClose = [...tabStore.tabs]
  tabsToClose.forEach((t) => performCloseTab(t.id))
}

// 重命名标签
function handleRenameTab(tab: any) {
  if (tab.type === 'scheme' && tab.schemeId) {
    schemeSettingsTargetId.value = tab.schemeId
    schemeSettingsOpen.value = true
  }
}

// 打开全局设置（顶部按钮）
function openGlobalSettings() {
  globalSettingsOpen.value = true
}

// 自定义滚轮事件：将垂直滚动转换为横向滚动
function handleWheel(event: WheelEvent) {
  // 如果按下 Shift 键，使用浏览器默认的横向滚动行为
  if (event.shiftKey) return

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
        // 使用 capture: true 捕获阶段监听，确保在子元素消费事件前处理
        useEventListener(scrollAreaElement, 'wheel', handleWheel, { passive: false, capture: true })
      }
    }
  })
})

// 监听激活标签变化，自动滚动到新激活的标签
watch(
  () => tabStore.activeTabId,
  (newTabId, oldTabId) => {
    // 只在标签真正改变时滚动（覆盖导入、新建等所有场景）
    if (newTabId && newTabId !== oldTabId) {
      scrollToActiveTab()
    }
  }
)
</script>

<template>
  <div
    class="flex h-10 items-center gap-2 bg-header px-2 pt-2 text-header-foreground"
    style="--accent: var(--header-accent); --accent-foreground: var(--header-accent-foreground)"
  >
    <!-- 左侧：Menubar 菜单栏 -->
    <Menubar class="flex-none border-none bg-transparent pr-0 shadow-none">
      <!-- 文件菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">{{ t('menu.file') }}</MenubarTrigger>
        <MenubarContent :sideOffset="10">
          <template v-for="cmd in fileCommands" :key="cmd.id">
            <!-- 在"保存到游戏"、"选择游戏目录"、"从方案码导入"之前添加分隔线 -->
            <MenubarSeparator
              v-if="
                cmd.id === 'file.importFromCode' ||
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
          <!-- 组 1: 导航组命令（聚焦、重置视图） -->
          <template v-for="cmd in navigationCommands" :key="cmd.id">
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>

          <!-- 组 1 与组 2 的分隔线 -->
          <MenubarSeparator />

          <!-- 组 2: 相机控制组令（切换相机模式） -->
          <MenubarItem
            v-if="cameraModeCommand"
            :disabled="!isEnabled(cameraModeCommand.id)"
            @click="handleCommand(cameraModeCommand.id)"
          >
            {{ cameraModeCommand.label }}
            <MenubarShortcut v-if="cameraModeCommand.shortcut">{{
              cameraModeCommand.shortcut
            }}</MenubarShortcut>
          </MenubarItem>

          <!-- 组 2 与组 3 的分隔线 -->
          <MenubarSeparator />

          <!-- 组 3: 全屏命令（独立分组） -->
          <MenubarItem
            v-if="fullscreenCommand"
            :disabled="!isEnabled(fullscreenCommand.id)"
            @click="handleCommand(fullscreenCommand.id)"
          >
            {{ fullscreenCommand.label }}
            <MenubarShortcut v-if="fullscreenCommand.shortcut">{{
              fullscreenCommand.shortcut
            }}</MenubarShortcut>
          </MenubarItem>

          <!-- 组 3 与组 4 的分隔线 -->
          <MenubarSeparator />

          <!-- 组 4: 系统设置组令（坐标系） -->
          <MenubarItem
            v-if="coordinateCommand"
            :disabled="!isEnabled(coordinateCommand.id)"
            @click="handleCommand(coordinateCommand.id)"
          >
            {{ coordinateCommand.label }}
            <MenubarShortcut v-if="coordinateCommand.shortcut">{{
              coordinateCommand.shortcut
            }}</MenubarShortcut>
          </MenubarItem>

          <!-- 组 5: 切换坐标系命令 -->
          <MenubarItem
            v-if="toggleGizmoSpaceCommand"
            :disabled="!isEnabled(toggleGizmoSpaceCommand.id)"
            @click="handleCommand(toggleGizmoSpaceCommand.id)"
          >
            {{ toggleGizmoSpaceCommand.label }}
            <MenubarShortcut v-if="toggleGizmoSpaceCommand.shortcut">{{
              toggleGizmoSpaceCommand.shortcut
            }}</MenubarShortcut>
          </MenubarItem>

          <!-- 组 6: 工作坐标系操作命令（Z、Shift+Z） -->
          <template v-for="cmd in workingCoordCommands" :key="cmd.id">
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>

          <!-- 组 6 与视图预设之间的分隔线 -->
          <MenubarSeparator />

          <!-- 视图预设子菜单：透视视图 + 正交六视图 -->
          <MenubarSub>
            <MenubarSubTrigger>{{ t('command.view.viewPreset') }}</MenubarSubTrigger>
            <MenubarSubContent>
              <template v-for="cmd in viewPresetCommands" :key="cmd.id">
                <!-- 在"顶视图"之前添加分隔线，将透视视图与正交视图分组 -->
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
    <ScrollArea v-show="tabStore.tabs.length > 0" ref="scrollAreaRef" class="min-w-0 flex-1">
      <TransitionGroup ref="tabsContainer" tag="div" name="tab-list" class="flex w-max gap-1 pl-1">
        <div
          v-for="tab in tabStore.tabs"
          :key="tab.id"
          @pointerdown="handlePointerDown(tab.id, $event)"
          class="flex-none touch-none"
          :style="{
            transform: draggingTabId === tab.id ? `translateX(${dragOffset}px)` : '',
            zIndex: draggingTabId === tab.id ? 50 : 'auto',
            position: 'relative',
          }"
          :class="{
            'cursor-grabbing': draggingTabId === tab.id,
            'cursor-pointer': !draggingTabId,
          }"
        >
          <ContextMenu>
            <ContextMenuTrigger as-child>
              <button
                :data-tab-active="tabStore.activeTabId === tab.id"
                @click="switchTab(tab.id)"
                class="group relative my-2 flex flex-none items-center gap-3 rounded-sm border py-1 pr-2 pl-3 text-sm font-medium shadow-xs transition-all"
                :class="
                  tabStore.activeTabId === tab.id
                    ? 'border-border bg-background text-foreground'
                    : 'border-border/60 bg-secondary/40 text-muted-foreground hover:border-border hover:bg-secondary/80'
                "
              >
                <!-- 文档标签图标 -->
                <BookOpen v-if="tab.type === 'doc'" class="h-3 w-3" />

                <span class="max-w-[150px] truncate">
                  {{ tab.title }}
                </span>
                <Button
                  @click="handleCloseTabClick(tab.id, $event)"
                  variant="ghost"
                  size="icon"
                  :class="[
                    'h-4 w-4 flex-shrink-0 transition-opacity',
                    tabStore.activeTabId === tab.id
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100',
                  ]"
                  :title="`关闭 ${tab.title}`"
                >
                  <X class="h-3 w-3" />
                </Button>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <template v-if="tab.type === 'scheme'">
                <ContextMenuItem @click="handleRenameTab(tab)">
                  {{ t('common.rename') }}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </template>
              <ContextMenuItem @click="performCloseTab(tab.id)">
                {{ t('common.close') }}
              </ContextMenuItem>
              <ContextMenuItem @click="closeOtherTabs(tab.id)">
                {{ t('common.closeOthers') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @click="closeAllTabs()">
                {{ t('common.closeAll') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </TransitionGroup>
      <ScrollBar orientation="horizontal" class="h-1.5" />
    </ScrollArea>

    <!-- 右侧：监控状态 + 设置按钮（始终固定在最右边） -->
    <div class="ml-auto flex flex-none items-center gap-2">
      <!-- 监控状态指示器 -->
      <template v-if="showWatchButton">
        <!-- 未监控状态：提示选择游戏目录 -->
        <Tooltip v-if="!watchState.isActive">
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="flex items-center gap-2"
              @click="handleStartWatchMode"
            >
              <FolderSearch class="h-3.5 w-3.5" />
              <span class="text-xs">{{ t('watchMode.clickToStart') }}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent :side-offset="-6">{{ t('watchMode.clickToStartTip') }}</TooltipContent>
        </Tooltip>

        <!-- 已监控状态：显示历史 Popover -->
        <Popover v-else v-model:open="watchHistoryOpen">
          <PopoverTrigger as-child>
            <button
              class="relative flex items-center gap-2 rounded-md bg-green-50 px-3 py-1.5 transition-colors hover:bg-green-100 dark:bg-green-950/60 dark:hover:bg-green-950/80"
              @mouseenter="isWatchTooltipVisible = true"
              @mouseleave="isWatchTooltipVisible = false"
            >
              <div class="h-2 w-2 animate-pulse rounded-full bg-green-500 dark:bg-green-300"></div>
              <span class="text-xs text-green-600 dark:text-green-300">
                {{ t('watchMode.monitoring') }}
              </span>
              <span class="text-xs text-green-600 dark:text-green-300">{{
                watchState.dirPath
              }}</span>

              <!-- 自定义简单 Tooltip：仅在 hover 时显示，不依赖 Reka Tooltip/Popover -->
              <Transition name="watch-tooltip">
                <div
                  v-if="isWatchTooltipVisible && !watchHistoryOpen"
                  class="watch-tooltip pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs whitespace-nowrap text-primary-foreground"
                >
                  导入和历史
                </div>
              </Transition>
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-0" align="end" :side-offset="10">
            <div class="flex flex-col">
              <!-- 顶部操作栏 -->
              <div class="flex items-center justify-between gap-2 p-3 pb-0">
                <Button
                  size="sm"
                  class="h-8 text-xs"
                  :disabled="!hasWatchedFiles"
                  @click="handleImportLatest"
                >
                  <Download class="mr-1.5 h-3.5 w-3.5" />
                  {{ t('watchMode.history.loadLatest') }}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  class="h-8 w-8 flex-none text-muted-foreground hover:text-foreground"
                  :disabled="watchHistory.length === 0"
                  @click="handleClearHistory"
                  :title="t('watchMode.history.clear')"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>

              <!-- 历史记录列表 -->
              <ScrollArea class="max-h-64">
                <div class="p-2">
                  <div
                    v-if="watchHistory.length === 0"
                    class="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    {{ t('watchMode.history.noHistory') }}
                  </div>
                  <Item
                    v-for="record in watchHistory"
                    :key="record.id"
                    size="sm"
                    as="button"
                    class="group w-full cursor-pointer p-2 hover:bg-accent"
                    @click="handleImportFromHistory(record.id)"
                  >
                    <ItemContent class="flex w-full flex-row items-center justify-between text-sm">
                      <span class="text-xs">{{
                        t('watchMode.history.itemCount', { n: record.itemCount })
                      }}</span>
                      <div class="relative ml-auto flex items-center justify-end">
                        <span class="text-xs transition-opacity group-hover:opacity-0">{{
                          formatRelativeTime(record.detectedAt)
                        }}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="absolute right-0 h-5 w-5 cursor-pointer rounded-sm opacity-0 transition-all group-hover:opacity-100 hover:bg-accent"
                          @click="handleDeleteHistoryRecord(record.id, $event)"
                          :title="t('common.delete')"
                        >
                          <X class="h-3 w-3" />
                        </Button>
                      </div>
                    </ItemContent>
                  </Item>
                </div>
                <ScrollBar orientation="vertical" />
              </ScrollArea>
            </div>
          </PopoverContent>
        </Popover>
      </template>

      <!-- 设置按钮 -->
      <Tooltip>
        <TooltipTrigger as-child @mouseenter="isSettingsTooltipAllowed = true">
          <Button
            variant="ghost"
            size="sm"
            @click="openGlobalSettings"
            class="flex-none"
            :aria-label="t('settings.title')"
          >
            <Settings class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent v-if="isSettingsTooltipAllowed" :side-offset="-6">
          {{ t('settings.title') }}
        </TooltipContent>
      </Tooltip>
    </div>

    <!-- 设置对话框 -->
    <SettingsDialog v-model:open="globalSettingsOpen" />
    <SchemeSettingsDialog
      v-if="schemeSettingsOpen"
      v-model:open="schemeSettingsOpen"
      :scheme-id="schemeSettingsTargetId"
    />
    <ImportCodeDialog
      ref="importCodeDialogRef"
      v-model:open="importCodeDialogOpen"
      @confirm="handleImportFromCode"
    />
  </div>
</template>

<style scoped>
/* 组件样式已在各自组件中定义 */
.tab-list-move {
  transition: transform 0.2s ease;
}
/* 正在被拖拽的元素不应该有过渡动画，否则会感觉迟滞 */
.tab-list-move.cursor-grabbing {
  transition: none;
}

/* 自定义监控按钮 Tooltip 过渡动画（模仿 TooltipContent 的淡入缩放） */
.watch-tooltip-enter-active,
.watch-tooltip-leave-active {
  transition: opacity 150ms ease-out;
}

.watch-tooltip-enter-from,
.watch-tooltip-leave-to {
  opacity: 0;
}

.watch-tooltip-enter-to,
.watch-tooltip-leave-from {
  opacity: 1;
}
</style>

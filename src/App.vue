<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { useEditorStore } from './stores/editorStore'
import { useGameDataStore } from './stores/gameDataStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTabStore } from './stores/tabStore'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import ThreeEditor from './components/ThreeEditor.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import RotateHintDialog from './components/RotateHintDialog.vue'
import CoordinateDialog from './components/CoordinateDialog.vue'
import AdvancedPasteDialog from './components/AdvancedPasteDialog.vue'
import DocsViewer from './components/DocsViewer.vue'
import GlobalAlertDialog from './components/GlobalAlertDialog.vue'
import { Toaster } from '@/components/ui/sonner'
import { Split } from '@/components/ui/split'
import 'vue-sonner/style.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useWorkspaceWorker } from './composables/useWorkspaceWorker'
import { useCloudSchemeSync } from './composables/useCloudSchemeSync'
import { useUIStore } from './stores/uiStore'
import { useCommandStore } from './stores/commandStore'

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const settingsStore = useSettingsStore()
const tabStore = useTabStore()
const uiStore = useUIStore()
const { restore: restoreWorkspace, isWorkerActive, startMonitoring } = useWorkspaceWorker()
// 注册云协同单连接与「激活 tab ↔ 房间」同步（内有单例 watch）
useCloudSchemeSync()

const commandStore = useCommandStore()
const isNarrowViewport = useMediaQuery('(max-width: 767px)')
const isPortraitViewport = useMediaQuery('(orientation: portrait)')
const isCompactViewport = useMediaQuery('(max-height: 600px)')
const isNarrowWidth = useMediaQuery('(max-width: 640px)')
const isRotateHintDismissed = ref(false)
const hasEnteredFullscreen = ref(false)
const sidebarLayoutRef = ref<HTMLElement | null>(null)
const { width: sidebarLayoutWidth } = useElementSize(sidebarLayoutRef)

const SIDEBAR_MIN_WIDTH_PX = 240
const SIDEBAR_MAX_WIDTH_PX = 480
const SIDEBAR_DEFAULT_WIDTH_PX = 256
const SIDEBAR_DIVIDER_SIZE_PX = 4
const MAIN_CONTENT_MIN_WIDTH_PX = 420

const isResizableSidebarVisible = computed(
  () => tabStore.activeTab?.type === 'scheme' && !uiStore.sidebarCollapsed
)

function parsePixelSize(size: string): number | null {
  if (!size.trim().endsWith('px')) {
    return null
  }

  const parsed = parseFloat(size)
  return Number.isFinite(parsed) ? parsed : null
}

function getSidebarMaxWidthPx(containerWidth: number): number {
  if (containerWidth <= 0) {
    return SIDEBAR_MAX_WIDTH_PX
  }

  // 右栏宽度不仅受自身上限约束，还要给主编辑区保留基本可用空间。
  const maxByLayout = Math.floor(
    containerWidth - MAIN_CONTENT_MIN_WIDTH_PX - SIDEBAR_DIVIDER_SIZE_PX
  )

  return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, maxByLayout))
}

function normalizeSidebarWidth(size: string, containerWidth: number): string {
  const maxWidthPx = getSidebarMaxWidthPx(containerWidth)
  const parsedWidth = parsePixelSize(size) ?? SIDEBAR_DEFAULT_WIDTH_PX
  const clampedWidth = Math.max(SIDEBAR_MIN_WIDTH_PX, Math.min(Math.round(parsedWidth), maxWidthPx))

  return `${clampedWidth}px`
}

const sidebarMinWidth = `${SIDEBAR_MIN_WIDTH_PX}px`
const sidebarMaxWidth = computed(() => `${getSidebarMaxWidthPx(sidebarLayoutWidth.value)}px`)

const applyTheme = () => {
  const theme = settingsStore.settings.theme
  const root = document.documentElement
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', isDark)
}

// 监听设置变化
watch(() => settingsStore.settings.theme, applyTheme, { immediate: true })

watch(
  sidebarLayoutWidth,
  (width) => {
    if (width <= 0) return

    // 持久化宽度需要在每次容器尺寸变化时重新校正，
    // 避免用户上次保存的宽度在当前窗口下把编辑区挤得过小。
    const normalizedWidth = normalizeSidebarWidth(settingsStore.settings.sidebarWidth, width)
    if (settingsStore.settings.sidebarWidth !== normalizedWidth) {
      settingsStore.settings.sidebarWidth = normalizedWidth
    }
  },
  { immediate: true }
)

// 监听系统主题变化
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
mediaQuery.addEventListener('change', applyTheme)

// 视口高度过小时自动折叠状态栏，恢复高度时展开
watch(
  isCompactViewport,
  (compact, prevCompact) => {
    if (compact && !prevCompact) {
      uiStore.setStatusBarCollapsed(true)
      return
    }
    if (!compact) {
      uiStore.setStatusBarCollapsed(false)
    }
  },
  { immediate: true }
)

// 视口宽度≤640px时自动折叠侧边栏，恢复宽度时展开
watch(
  isNarrowWidth,
  (narrow, prevNarrow) => {
    if (narrow && !prevNarrow) {
      uiStore.setSidebarCollapsed(true)
      return
    }
    if (!narrow) {
      uiStore.setSidebarCollapsed(false)
    }
  },
  { immediate: true }
)

// 全局快捷键系统（单例）
useKeyboardShortcuts({
  commands: commandStore.commands,
  executeCommand: commandStore.executeCommand,
})

const isAppReady = ref(false)
const shouldShowRotateMask = computed(
  () =>
    isAppReady.value &&
    !isRotateHintDismissed.value &&
    !hasEnteredFullscreen.value &&
    isNarrowViewport.value &&
    isPortraitViewport.value &&
    tabStore.activeTab?.type === 'scheme' &&
    !!editorStore.activeScheme
)

function dismissRotateMaskForSession() {
  isRotateHintDismissed.value = true
}

function handleRotateHintOpenChange(open: boolean) {
  if (!open) {
    dismissRotateMaskForSession()
  }
}

function handleRotateHintToggleFullscreen() {
  commandStore.executeCommand('view.toggleFullscreen')
}

function handleFullscreenChange() {
  if (typeof document === 'undefined') return
  if (document.fullscreenElement) {
    hasEnteredFullscreen.value = true
    dismissRotateMaskForSession()
  }
}

function consumeStartupSchemeCode(): string | null {
  const url = new URL(window.location.href)
  const schemeCode = url.searchParams.get('schemeCode')?.trim()

  if (!schemeCode) {
    return null
  }

  url.searchParams.delete('schemeCode')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)

  return schemeCode
}

async function importStartupSchemeCode(schemeCode: string | null) {
  if (!schemeCode) return

  await commandStore.fileOps.importFromPublicSchemeCode(schemeCode)
}

// 初始化
onMounted(async () => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  handleFullscreenChange()
  const startupSchemeCode = consumeStartupSchemeCode()

  if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true') {
    settingsStore.initializeAuth()
  }

  // 初始化游戏数据（异步加载）
  void gameDataStore.initialize()

  const startBackgroundServices = () => {
    // 启动监控
    if (isWorkerActive.value) {
      startMonitoring()
    }

    // 启动时静默恢复文件监控（仅在已授权时生效，不会触发授权弹窗）
    commandStore.fileOps.restoreWatchModeSilently().catch((error: unknown) => {
      console.warn('[App] Silent watch mode restore failed:', error)
    })
  }

  const restorePromise = restoreWorkspace()
  const shouldWaitForRestore =
    settingsStore.settings.enableAutoSave && localStorage.getItem('has_unsaved_session') === 'true'

  if (shouldWaitForRestore) {
    try {
      await restorePromise
    } catch (e) {
      console.error('[App] Restore failed:', e)
    } finally {
      await importStartupSchemeCode(startupSchemeCode)
      isAppReady.value = true
      startBackgroundServices()
    }
  } else {
    // marker 缺失只代表“不阻塞首屏”；后台仍会读取 IDB 作为工作台真相。
    // 恢复检查完成前不会启动 worker，避免空内存覆盖旧快照。
    isAppReady.value = true
    restorePromise
      .catch((e) => {
        console.error('[App] Restore failed:', e)
      })
      .then(() => importStartupSchemeCode(startupSchemeCode))
      .finally(() => {
        startBackgroundServices()
      })
  }
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
})
</script>

<template>
  <TooltipProvider>
    <div class="flex h-screen flex-col overflow-hidden bg-panel">
      <!-- 顶部工具栏 -->
      <Toolbar />

      <!-- 主体内容区 -->
      <div class="min-h-0 flex-1 p-2">
        <div
          ref="sidebarLayoutRef"
          class="flex h-full flex-1 overflow-hidden rounded-md border border-border bg-background shadow"
        >
          <!-- 可调宽布局：仅方案页且侧边栏展开时启用 -->
          <Split
            v-if="isResizableSidebarVisible"
            v-model:size="settingsStore.settings.sidebarWidth"
            direction="horizontal"
            reverse
            :min="sidebarMinWidth"
            :max="sidebarMaxWidth"
            :divider-size="SIDEBAR_DIVIDER_SIZE_PX"
          >
            <template #1>
              <!-- 画布区域 -->
              <div class="relative flex h-full min-h-0 min-w-0 flex-col">
                <!-- 0. 初始化加载中 (空白占位) -->
                <div v-if="!isAppReady" class="flex-1 bg-background"></div>

                <!-- 1. 欢迎界面：没有标签时 -->
                <WelcomeScreen v-else-if="tabStore.tabs.length === 0" />

                <!-- 2. 有标签时：根据类型渲染 -->
                <template v-else>
                  <!-- 方案编辑器 -->
                  <KeepAlive>
                    <ThreeEditor
                      v-if="tabStore.activeTab?.type === 'scheme' && editorStore.activeScheme"
                    />
                  </KeepAlive>

                  <!-- 文档查看器 -->
                  <KeepAlive>
                    <DocsViewer
                      v-if="tabStore.activeTab?.type === 'doc' && isAppReady"
                      key="docs-viewer"
                    />
                  </KeepAlive>
                </template>
              </div>
            </template>

            <template #2>
              <!-- 右侧边栏 -->
              <Sidebar />
            </template>
          </Split>

          <!-- 单栏布局：欢迎页、文档页或侧边栏折叠时使用 -->
          <div v-else class="relative flex min-w-0 flex-1 flex-col">
            <!-- 0. 初始化加载中 (空白占位) -->
            <div v-if="!isAppReady" class="flex-1 bg-background"></div>

            <!-- 1. 欢迎界面：没有标签时 -->
            <WelcomeScreen v-else-if="tabStore.tabs.length === 0" />

            <!-- 2. 有标签时：根据类型渲染 -->
            <template v-else>
              <!-- 方案编辑器 -->
              <KeepAlive>
                <ThreeEditor
                  v-if="tabStore.activeTab?.type === 'scheme' && editorStore.activeScheme"
                />
              </KeepAlive>

              <!-- 文档查看器 -->
              <KeepAlive>
                <DocsViewer
                  v-if="tabStore.activeTab?.type === 'doc' && isAppReady"
                  key="docs-viewer"
                />
              </KeepAlive>
            </template>
          </div>
        </div>
      </div>

      <!-- 底部状态栏 -->
      <StatusBar v-if="!uiStore.statusBarCollapsed" />
    </div>

    <RotateHintDialog
      :open="shouldShowRotateMask"
      @update:open="handleRotateHintOpenChange"
      @toggle-fullscreen="handleRotateHintToggleFullscreen"
      @dismiss="dismissRotateMaskForSession"
    />
  </TooltipProvider>

  <!-- 全局 Toast 通知 -->
  <Toaster position="top-center" offset="60px" :duration="3000" richColors />

  <!-- 工作坐标系设置对话框 -->
  <CoordinateDialog v-model:open="commandStore.showCoordinateDialog" />

  <!-- 高级粘贴对话框 -->
  <AdvancedPasteDialog v-model:open="commandStore.showAdvancedPasteDialog" />

  <!-- 全局 AlertDialog -->
  <GlobalAlertDialog />
</template>

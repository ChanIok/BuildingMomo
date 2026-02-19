<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useEditorStore } from './stores/editorStore'
import { useGameDataStore } from './stores/gameDataStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTabStore } from './stores/tabStore'
import { useI18n } from './composables/useI18n'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import ThreeEditor from './components/ThreeEditor.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import RotateHintDialog from './components/RotateHintDialog.vue'
import CoordinateDialog from './components/CoordinateDialog.vue'
import DocsViewer from './components/DocsViewer.vue'
import GlobalAlertDialog from './components/GlobalAlertDialog.vue'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useWorkspaceWorker } from './composables/useWorkspaceWorker'
import { useUIStore } from './stores/uiStore'

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const settingsStore = useSettingsStore()
const tabStore = useTabStore()
const uiStore = useUIStore()
const { t } = useI18n()
const { restore: restoreWorkspace, isWorkerActive, startMonitoring } = useWorkspaceWorker()

// 导入 commandStore 用于全局命令状态
import { useCommandStore } from './stores/commandStore'
const commandStore = useCommandStore()
const isNarrowViewport = useMediaQuery('(max-width: 767px)')
const isPortraitViewport = useMediaQuery('(orientation: portrait)')
const isCompactViewport = useMediaQuery('(max-height: 600px)')
const isNarrowWidth = useMediaQuery('(max-width: 640px)')
const isRotateHintDismissed = ref(false)
const hasEnteredFullscreen = ref(false)

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

// 初始化
onMounted(async () => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  handleFullscreenChange()

  if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true') {
    settingsStore.initializeAuth()
  }

  // 快速检查：是否存在未保存的会话标记 (Local Storage 同步读取)
  const hasUnsavedSession = localStorage.getItem('has_unsaved_session') === 'true'
  const shouldRestore = settingsStore.settings.enableAutoSave && hasUnsavedSession

  if (!shouldRestore) {
    isAppReady.value = true
  } else {
    try {
      // 初始化游戏数据（异步加载）
      gameDataStore.initialize()
      await restoreWorkspace()
    } catch (e) {
      console.error('[App] Restore failed:', e)
    } finally {
      isAppReady.value = true
    }
  }

  // 启动监控
  if (isWorkerActive.value) {
    startMonitoring()
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
          class="flex h-full flex-1 overflow-hidden rounded-md border border-border bg-background shadow"
        >
          <!-- 画布区域 -->
          <div class="relative flex min-w-0 flex-1 flex-col">
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

          <!-- 右侧边栏：仅方案类型显示，且未折叠时显示 -->
          <div
            v-if="tabStore.activeTab?.type === 'scheme' && !uiStore.sidebarCollapsed"
            class="h-full"
          >
            <Sidebar />
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

  <!-- 全局 AlertDialog -->
  <GlobalAlertDialog />
</template>

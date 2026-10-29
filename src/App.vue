<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick, provide } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useEditorStore } from './stores/editorStore'
import { useGameDataStore } from './stores/gameDataStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTabStore } from './stores/tabStore'
import Toolbar from './components/Toolbar.vue'
import StatusBar from './components/StatusBar.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import RotateHintDialog from './components/RotateHintDialog.vue'
import CoordinateDialog from './components/CoordinateDialog.vue'
import AdvancedPasteDialog from './components/AdvancedPasteDialog.vue'
import GroupMergeDialog from './components/GroupMergeDialog.vue'
import { defineAsyncView } from './lib/asyncView'
import GlobalAlertDialog from './components/GlobalAlertDialog.vue'
import { Toaster } from '@/components/ui/sonner'
import EditorLayout from './components/EditorLayout.vue'
import 'vue-sonner/style.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useWorkspaceWorker } from './composables/useWorkspaceWorker'
import { useCloudSchemeSync } from './composables/useCloudSchemeSync'
import { useUIStore } from './stores/uiStore'
import { useDesktopStore } from './stores/desktopStore'
import { useCommandStore } from './stores/commandStore'
import { removeLegacyDatabases } from './lib/legacyIdbCleanup'
import { useNotification } from './composables/useNotification'
import { useI18n } from './composables/useI18n'

import {
  createAnalysisCaptureBridge,
  analysisCaptureBridgeKey,
} from './lib/sceneAnalysis/captureBridge'
import { useAiChat } from './composables/ai/useAiChat'
import { aiChatKey } from './composables/ai/chatContext'
import { externalAiKey, useExternalAi } from './composables/ai/useExternalAi'

const notification = useNotification()
const { t } = useI18n()
function notifyViewLoadFailure(retry: () => void) {
  // Keep the retry action available while Vue's shared load request is pending.
  notification.error(t('asyncView.failed'), {
    duration: Infinity,
    dismissible: false,
    action: { label: t('asyncView.retry'), onClick: retry },
  })
}
const ThreeEditor = defineAsyncView(
  () => import('./components/ThreeEditor.vue'),
  notifyViewLoadFailure
)
const Sidebar = defineAsyncView(() => import('./components/Sidebar.vue'), notifyViewLoadFailure)
const DocsViewer = defineAsyncView(
  () => import('./components/DocsViewer.vue'),
  notifyViewLoadFailure
)

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const settingsStore = useSettingsStore()
const captureBridge = createAnalysisCaptureBridge()
provide(analysisCaptureBridgeKey, captureBridge)
provide(
  externalAiKey,
  useExternalAi({
    enabled: computed(() => settingsStore.canUseExperimentalFeatures),
    getCaptureProvider: () => captureBridge.provider.value,
  })
)
provide(
  aiChatKey,
  useAiChat({
    enabled: computed(() => settingsStore.canUseExperimentalFeatures),
    getCaptureProvider: () => captureBridge.provider.value,
  })
)
const renderQualityReady = ref(true)
let renderQualityChange = 0
watch(
  () => settingsStore.settings.renderQuality,
  async () => {
    const change = ++renderQualityChange
    renderQualityReady.value = false
    // Finish all old editor cleanup before the next editor acquires the shared
    // furniture context. KeepAlive key replacement alone overlaps these phases.
    await nextTick()
    if (change === renderQualityChange) renderQualityReady.value = true
  }
)
const tabStore = useTabStore()
const uiStore = useUIStore()
const desktopStore = useDesktopStore()
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
const applyTheme = () => {
  const theme = settingsStore.settings.theme
  const root = document.documentElement
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', isDark)
  // 桌面端标题栏跟随页面主题，浏览器内无宿主时为空操作
  desktopStore.syncWindowAppearance()
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

// 首屏就绪：有会话标记时需等 restore 完成；无标记时立即 true，避免 WelcomeScreen 闪烁
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
  desktopStore.init()
  // 清理废弃的监控导入历史库和 AI 开发期数据库。
  void removeLegacyDatabases()

  document.addEventListener('fullscreenchange', handleFullscreenChange)
  handleFullscreenChange()
  const startupSchemeCode = consumeStartupSchemeCode()

  if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true') {
    settingsStore.initializeAuth()
  }

  // 初始化游戏数据（异步加载）
  void gameDataStore.initialize()

  // 工作台恢复快路径：localStorage 标记为同步读取，用于决定是否等待 IndexedDB。
  // - 有标记：上次关闭时内存中仍有 tab，await restore 后再亮屏。
  // - 无标记：视为空会话，不读 IndexedDB，立即 isAppReady 以加快首屏。
  // 数据可靠性由 workspaceSnapshotStore（主库 + fallback 库各一份）负责，与 marker 决策分离。
  const shouldRestore =
    settingsStore.settings.enableAutoSave && localStorage.getItem('has_unsaved_session') === 'true'

  if (shouldRestore) {
    try {
      await restoreWorkspace()
    } catch (e) {
      console.error('[App] Restore failed:', e)
    }
  } else {
    isAppReady.value = true
  }

  await importStartupSchemeCode(startupSchemeCode)

  if (shouldRestore) {
    isAppReady.value = true
  }

  // restore 已完成（或已跳过）后再 init worker，避免空内存快照写回 IndexedDB
  if (isWorkerActive.value) {
    startMonitoring()
  }

  // 启动时静默恢复文件监控（仅在已授权时生效，不会触发授权弹窗）
  commandStore.fileOps.restoreWatchModeSilently().catch((error: unknown) => {
    console.warn('[App] Silent watch mode restore failed:', error)
  })
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
        <EditorLayout
          :editing="tabStore.activeTab?.type === 'scheme' && !!editorStore.activeScheme"
        >
          <!-- 0. 初始化加载中 (空白占位) -->
          <div v-if="!isAppReady" class="flex-1 bg-background"></div>

          <!-- 1. 欢迎界面：没有标签时 -->
          <WelcomeScreen v-else-if="tabStore.tabs.length === 0" />

          <!-- 2. 有标签时：根据类型渲染 -->
          <template v-else>
            <!-- 方案编辑器 -->
            <KeepAlive v-if="renderQualityReady">
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

          <!-- 右侧边栏 -->
          <template #sidebar>
            <Sidebar />
          </template>
        </EditorLayout>
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

  <!-- 成组合并目标选择 -->
  <GroupMergeDialog v-model:open="uiStore.groupMergeOpen" />

  <!-- 全局 AlertDialog -->
  <GlobalAlertDialog />
</template>

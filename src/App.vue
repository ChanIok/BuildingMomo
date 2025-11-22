<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useEditorStore } from './stores/editorStore'
import { useNotificationStore } from './stores/notificationStore'
import { useFurnitureStore } from './stores/furnitureStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTabStore } from './stores/tabStore'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import ThreeEditor from './components/ThreeEditor.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import MoveDialog from './components/MoveDialog.vue'
import CoordinateDialog from './components/CoordinateDialog.vue'
import DocsViewer from './components/DocsViewer.vue'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'vue-sonner'
import 'vue-sonner/style.css'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'

const editorStore = useEditorStore()
const notificationStore = useNotificationStore()
const furnitureStore = useFurnitureStore()
const settingsStore = useSettingsStore()
const tabStore = useTabStore()

// 导入 commandStore 用于对话框控制
import { useCommandStore } from './stores/commandStore'
const commandStore = useCommandStore()

// 全局快捷键系统（单例）
useKeyboardShortcuts({
  commands: commandStore.commands,
  executeCommand: commandStore.executeCommand,
})

// AlertDialog 控制
const dialogOpen = computed({
  get: () => notificationStore.currentAlert !== null,
  set: (value: boolean) => {
    if (!value) {
      notificationStore.cancelCurrentAlert()
    }
  },
})

// 初始化
onMounted(async () => {
  // 初始化设置
  settingsStore.initialize()

  // 初始化家具数据
  try {
    await furnitureStore.initialize()
    console.log('[App] Furniture data initialized')
  } catch (error) {
    console.error('[App] Failed to initialize furniture data:', error)
    toast.error('家具数据加载失败，部分功能可能不可用')
  }
})
</script>

<template>
  <TooltipProvider>
    <div class="flex h-screen flex-col overflow-hidden bg-gray-50">
      <!-- 顶部工具栏 -->
      <Toolbar />

      <!-- 主体内容区 -->
      <div class="min-h-0 flex-1 p-2">
        <div
          class="flex h-full flex-1 overflow-hidden rounded-md border border-gray-200 bg-background shadow"
        >
          <!-- 画布区域 -->
          <div class="relative flex min-w-0 flex-1 flex-col">
            <!-- 欢迎界面：没有标签时 -->
            <WelcomeScreen v-if="tabStore.tabs.length === 0" />

            <!-- 有标签时：根据类型渲染 -->
            <template v-else>
              <!-- 方案编辑器 -->
              <template v-if="tabStore.activeTab?.type === 'scheme' && editorStore.activeScheme">
                <!-- 默认使用3D视图 -->
                <KeepAlive>
                  <ThreeEditor />
                </KeepAlive>
              </template>

              <!-- 文档查看器 -->
              <KeepAlive>
                <DocsViewer v-if="tabStore.activeTab?.type === 'doc'" key="docs-viewer" />
              </KeepAlive>
            </template>
          </div>

          <!-- 右侧边栏：仅方案类型显示 -->
          <div v-if="tabStore.activeTab?.type === 'scheme'" class="h-full p-2"><Sidebar /></div>
        </div>
      </div>

      <!-- 底部状态栏 -->
      <StatusBar />
    </div>
  </TooltipProvider>

  <!-- 全局 Toast 通知 -->
  <Toaster position="top-center" :duration="3000" richColors />

  <!-- 移动对话框 -->
  <MoveDialog v-model:open="commandStore.showMoveDialog" />

  <!-- 工作坐标系设置对话框 -->
  <CoordinateDialog v-model:open="commandStore.showCoordinateDialog" />

  <!-- 全局 AlertDialog -->
  <AlertDialog :open="dialogOpen">
    <AlertDialogContent v-if="notificationStore.currentAlert">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ notificationStore.currentAlert.title }}</AlertDialogTitle>
        <AlertDialogDescription class="whitespace-pre-line">
          {{ notificationStore.currentAlert.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel
          v-if="notificationStore.currentAlert.cancelText"
          @click="notificationStore.cancelCurrentAlert"
        >
          {{ notificationStore.currentAlert.cancelText }}
        </AlertDialogCancel>
        <AlertDialogAction @click="notificationStore.confirmCurrentAlert">
          {{ notificationStore.currentAlert.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<style scoped>
/* 组件样式已在各自组件中定义 */
</style>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useEditorStore } from './stores/editorStore'
import { useNotificationStore } from './stores/notificationStore'
import { useFurnitureStore } from './stores/furnitureStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTabStore } from './stores/tabStore'
import { useI18n } from './composables/useI18n'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import ThreeEditor from './components/ThreeEditor.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import CoordinateDialog from './components/CoordinateDialog.vue'
import SchemeSettingsDialog from './components/SchemeSettingsDialog.vue'
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
import { TriangleAlert, Wrench, CircleX, CheckCircle2 } from 'lucide-vue-next'

const editorStore = useEditorStore()
const notificationStore = useNotificationStore()
const furnitureStore = useFurnitureStore()
const settingsStore = useSettingsStore()
const tabStore = useTabStore()
const { t } = useI18n()

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
    toast.error(t('notification.furnitureDataLoadFailed'))
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
              <KeepAlive>
                <ThreeEditor
                  v-if="tabStore.activeTab?.type === 'scheme' && editorStore.activeScheme"
                />
              </KeepAlive>

              <!-- 文档查看器 -->
              <KeepAlive>
                <DocsViewer v-if="tabStore.activeTab?.type === 'doc'" key="docs-viewer" />
              </KeepAlive>
            </template>
          </div>

          <!-- 右侧边栏：仅方案类型显示 -->
          <div v-if="tabStore.activeTab?.type === 'scheme'" class="h-full"><Sidebar /></div>
        </div>
      </div>

      <!-- 底部状态栏 -->
      <StatusBar />
    </div>
  </TooltipProvider>

  <!-- 全局 Toast 通知 -->
  <Toaster position="top-center" :duration="3000" richColors />

  <!-- 工作坐标系设置对话框 -->
  <CoordinateDialog v-model:open="commandStore.showCoordinateDialog" />
  <!-- 方案设置对话框 -->
  <SchemeSettingsDialog v-model:open="commandStore.showSchemeSettingsDialog" />

  <!-- 全局 AlertDialog -->
  <AlertDialog :open="dialogOpen">
    <AlertDialogContent v-if="notificationStore.currentAlert">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ notificationStore.currentAlert.title }}</AlertDialogTitle>

        <div class="flex flex-col gap-4 py-2">
          <!-- 普通描述文本 -->
          <AlertDialogDescription
            v-if="notificationStore.currentAlert.description"
            class="text-sm whitespace-pre-line text-gray-500"
          >
            {{ notificationStore.currentAlert.description }}
          </AlertDialogDescription>

          <!-- 详情列表 -->
          <div
            v-if="
              notificationStore.currentAlert.details &&
              notificationStore.currentAlert.details.length > 0
            "
            class="flex flex-col gap-3"
          >
            <div
              v-for="(detail, index) in notificationStore.currentAlert.details"
              :key="index"
              class="rounded-md border p-3 text-sm"
              :class="{
                'border-amber-200 bg-amber-50': detail.type === 'warning',
                'border-blue-200 bg-blue-50': detail.type === 'info',
                'border-red-200 bg-red-50': detail.type === 'error',
                'border-green-200 bg-green-50': detail.type === 'success',
              }"
            >
              <!-- 标题行 -->
              <div
                class="mb-1 flex items-center gap-2 font-medium"
                :class="{
                  'text-amber-700': detail.type === 'warning',
                  'text-blue-700': detail.type === 'info',
                  'text-red-700': detail.type === 'error',
                  'text-green-700': detail.type === 'success',
                }"
              >
                <TriangleAlert v-if="detail.type === 'warning'" class="h-4 w-4" />
                <Wrench v-else-if="detail.type === 'info'" class="h-4 w-4" />
                <CircleX v-else-if="detail.type === 'error'" class="h-4 w-4" />
                <CheckCircle2 v-else-if="detail.type === 'success'" class="h-4 w-4" />
                <span>{{ detail.title }}</span>
              </div>

              <!-- 内容 -->
              <div class="space-y-1 pl-6 text-gray-600">
                <p v-if="detail.text">{{ detail.text }}</p>
                <ul v-if="detail.list && detail.list.length > 0" class="list-disc space-y-0.5 pl-4">
                  <li v-for="(item, i) in detail.list" :key="i">{{ item }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
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

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useEditorStore } from './stores/editorStore'
import { useNotificationStore } from './stores/notificationStore'
import { useFurnitureStore } from './stores/furnitureStore'
import { useSettingsStore } from './stores/settingsStore'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import CanvasEditor from './components/CanvasEditor.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
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

const editorStore = useEditorStore()
const notificationStore = useNotificationStore()
const furnitureStore = useFurnitureStore()
const settingsStore = useSettingsStore()

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
  <div>
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
            <!-- 欢迎界面：没有方案时 -->
            <WelcomeScreen v-if="editorStore.schemes.length === 0" />

            <!-- 画布编辑器：使用 KeepAlive 缓存状态 -->
            <KeepAlive v-else :max="5">
              <CanvasEditor
                v-if="editorStore.activeScheme"
                :key="editorStore.activeSchemeId || ''"
              />
            </KeepAlive>
          </div>

          <!-- 右侧边栏 -->
          <div v-if="editorStore.schemes.length !== 0" class="h-full p-2"><Sidebar /></div>
        </div>
      </div>
      <div class="min-h-6"></div>
    </div>

    <!-- 全局 Toast 通知 -->
    <Toaster position="top-center" :duration="3000" richColors />

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
  </div>
</template>

<style scoped>
/* 组件样式已在各自组件中定义 */
</style>

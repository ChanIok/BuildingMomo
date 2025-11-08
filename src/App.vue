<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from './stores/editorStore'
import { useNotificationStore } from './stores/notificationStore'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import CanvasEditor from './components/CanvasEditor.vue'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { X } from 'lucide-vue-next'
import { Toaster } from '@/components/ui/sonner'
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

// 双向绑定激活方案ID
const activeSchemeId = computed({
  get: () => editorStore.activeSchemeId ?? '',
  set: (value: string) => editorStore.setActiveScheme(value),
})

// 关闭方案
function closeScheme(schemeId: string, event: Event) {
  event.stopPropagation() // 阻止触发Tab切换
  editorStore.closeScheme(schemeId)
}

// AlertDialog 控制
const dialogOpen = computed({
  get: () => notificationStore.currentAlert !== null,
  set: (value: boolean) => {
    if (!value) {
      notificationStore.cancelCurrentAlert()
    }
  },
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <!-- 顶部工具栏 -->
    <Toolbar />

    <!-- 主体内容区 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧边栏 -->
      <Sidebar />

      <!-- 画布区域：多方案Tabs或空状态 -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <!-- 空状态：没有方案时 -->
        <div
          v-if="editorStore.schemes.length === 0"
          class="flex flex-1 items-center justify-center bg-gray-100"
        >
          <div class="text-center text-gray-400">
            <svg
              class="mx-auto mb-4 h-24 w-24 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              ></path>
            </svg>
            <p class="text-lg">请导入 JSON 文件开始</p>
          </div>
        </div>

        <!-- 多方案Tabs -->
        <Tabs
          v-else
          v-model="activeSchemeId"
          class="flex h-full flex-1 flex-col gap-0 overflow-hidden"
        >
          <!-- Tabs标签栏 -->
          <TabsList
            class="h-10 w-full justify-start rounded-none border-b border-gray-200 bg-gray-50 p-0"
          >
            <TabsTrigger
              v-for="scheme in editorStore.schemes"
              :key="scheme.id"
              :value="scheme.id"
              class="group relative h-full max-w-[200px] min-w-[120px] flex-none rounded-none rounded-t-md border-0 border-r border-gray-200 bg-gray-100 px-3 text-gray-600 shadow-none transition-all hover:bg-gray-50 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
            >
              <span class="flex-1 truncate text-left">{{ scheme.name }}</span>
              <button
                @click="closeScheme(scheme.id, $event)"
                class="ml-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=active]:opacity-70 hover:bg-gray-200 group-data-[state=active]:hover:bg-gray-100 group-data-[state=active]:hover:opacity-100"
                :title="`关闭 ${scheme.name}`"
              >
                <X class="h-3 w-3" />
              </button>
            </TabsTrigger>
          </TabsList>

          <!-- Tabs内容区：使用v-show保持DOM -->
          <TabsContent
            v-for="scheme in editorStore.schemes"
            :key="scheme.id"
            :value="scheme.id"
            class="flex-1 overflow-hidden"
            :class="{ hidden: activeSchemeId !== scheme.id }"
          >
            <CanvasEditor />
          </TabsContent>
        </Tabs>
      </div>
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

<script setup lang="ts">
import { computed } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
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
import { TriangleAlert, Wrench, CircleX, CheckCircle2 } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'

const notificationStore = useNotificationStore()

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
  <!-- 全局 AlertDialog -->
  <AlertDialog :open="dialogOpen">
    <AlertDialogContent v-if="notificationStore.currentAlert">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ notificationStore.currentAlert.title }}</AlertDialogTitle>

        <div class="flex flex-col gap-4 py-2">
          <!-- 普通描述文本 -->
          <AlertDialogDescription
            v-if="notificationStore.currentAlert.description"
            class="text-sm whitespace-pre-line text-muted-foreground"
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
                'border-amber-500/20 bg-amber-500/10': detail.type === 'warning',
                'border-blue-500/20 bg-blue-500/10': detail.type === 'info',
                'border-red-500/20 bg-red-500/10': detail.type === 'error',
                'border-green-500/20 bg-green-500/10': detail.type === 'success',
              }"
            >
              <!-- 标题行 -->
              <div
                class="mb-1 flex items-center gap-2 font-medium"
                :class="{
                  'text-amber-700 dark:text-amber-400': detail.type === 'warning',
                  'text-blue-700 dark:text-blue-400': detail.type === 'info',
                  'text-red-700 dark:text-red-400': detail.type === 'error',
                  'text-green-700 dark:text-green-400': detail.type === 'success',
                }"
              >
                <TriangleAlert v-if="detail.type === 'warning'" class="h-4 w-4" />
                <Wrench v-else-if="detail.type === 'info'" class="h-4 w-4" />
                <CircleX v-else-if="detail.type === 'error'" class="h-4 w-4" />
                <CheckCircle2 v-else-if="detail.type === 'success'" class="h-4 w-4" />
                <span>{{ detail.title }}</span>
              </div>

              <!-- 内容 -->
              <div class="space-y-1 pl-6 text-muted-foreground">
                <p v-if="detail.text" class="whitespace-pre-line">{{ detail.text }}</p>
                <ul v-if="detail.list && detail.list.length > 0" class="list-disc space-y-0.5 pl-4">
                  <li v-for="(item, i) in detail.list" :key="i">{{ item }}</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- 勾选框 -->
          <div
            v-if="notificationStore.currentAlert.checkboxLabel"
            class="flex items-center space-x-2 pt-2"
          >
            <Checkbox
              id="alert-checkbox"
              v-model="notificationStore.currentAlert.checkboxChecked"
            />
            <label
              for="alert-checkbox"
              class="cursor-pointer text-sm leading-none text-muted-foreground select-none"
            >
              {{ notificationStore.currentAlert.checkboxLabel }}
            </label>
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

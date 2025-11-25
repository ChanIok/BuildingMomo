<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

const settingsStore = useSettingsStore()
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-h-[80vh] max-w-2xl">
      <DialogHeader>
        <DialogTitle>设置</DialogTitle>
        <DialogDescription> 配置应用的显示选项和编辑设置 </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- 家具Tooltip开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>显示家具名称提示</Label>
            <p class="text-xs text-muted-foreground">鼠标悬停在物品上时显示名称和图标</p>
          </div>
          <Switch v-model="settingsStore.settings.showFurnitureTooltip" />
        </div>

        <!-- 背景图开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>显示家园背景图</Label>
            <p class="text-xs text-muted-foreground">在画布上显示参考背景图</p>
          </div>
          <Switch v-model="settingsStore.settings.showBackground" />
        </div>

        <!-- 分割线 -->
        <div class="border-t pt-4">
          <h3 class="mb-3 text-sm font-medium">编辑辅助</h3>
        </div>

        <!-- 重复物品检测开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>启用重复物品检测</Label>
            <p class="text-xs text-muted-foreground">
              自动检测位置、旋转、缩放完全相同的物品，在状态栏显示提示
            </p>
          </div>
          <Switch v-model="settingsStore.settings.enableDuplicateDetection" />
        </div>

        <!-- 限制检测开关 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>启用方案合规性检测</Label>
            <p class="text-xs text-muted-foreground">
              自动检测越界物品和过大的组合。关闭则代表您已知悉风险，允许强制保存。
            </p>
          </div>
          <Switch v-model="settingsStore.settings.enableLimitDetection" />
        </div>

        <!-- 3D 视图设置分组 -->
        <!-- 3D 视图显示模式选择已移至侧边栏顶部工具栏 -->
      </div>
    </DialogContent>
  </Dialog>
</template>

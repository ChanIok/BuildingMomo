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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
        <DialogDescription> 配置应用的显示选项和数据管理设置 </DialogDescription>
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

        <!-- 3D 视图设置分组 -->
        <div class="border-t pt-4">
          <h3 class="mb-3 text-sm font-medium">3D 视图</h3>
        </div>

        <!-- 3D 显示模式选择 -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>3D 视图显示模式</Label>
            <p class="text-xs text-muted-foreground">选择在 3D 场景中如何呈现物品</p>
          </div>
          <Select v-model="settingsStore.settings.threeDisplayMode">
            <SelectTrigger class="w-[140px]">
              <SelectValue placeholder="选择模式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="box">完整体积</SelectItem>
              <SelectItem value="icon">图标模式</SelectItem>
              <SelectItem value="simple-box">简化方块</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

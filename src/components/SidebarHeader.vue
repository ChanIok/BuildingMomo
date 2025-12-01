<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCommandStore } from '@/stores/commandStore'
import { useUIStore } from '@/stores/uiStore'
import {
  Hand,
  Move,
  Box,
  Image as ImageIcon,
  Cuboid,
  Camera,
  ChevronsUp,
  ChevronsDown,
  ChevronsRight,
  ChevronsLeft,
  ChevronRight,
  ChevronLeft,
  SquareMousePointer,
  Lasso,
} from 'lucide-vue-next'
import { useEditorSelectionAction } from '@/composables/useEditorSelectionAction'
import IconSelectionNew from '@/components/icons/IconSelectionNew.vue'
import IconSelectionAdd from '@/components/icons/IconSelectionAdd.vue'
import IconSelectionSubtract from '@/components/icons/IconSelectionSubtract.vue'
import IconSelectionIntersect from '@/components/icons/IconSelectionIntersect.vue'
import SidebarToggleItem from './SidebarToggleItem.vue'

const editorStore = useEditorStore()
const settingsStore = useSettingsStore()
const commandStore = useCommandStore()
const uiStore = useUIStore()

const { activeAction } = useEditorSelectionAction()

// 工具切换
const currentTool = computed({
  get: () => editorStore.currentTool,
  set: (val) => {
    if (val) editorStore.currentTool = val as 'select' | 'hand'
  },
})

// 选择行为切换
const selectionAction = computed({
  get: () => editorStore.selectionAction,
  set: (val) => {
    if (val) editorStore.selectionAction = val
  },
})

// 选择模式切换
const selectionMode = computed({
  get: () => editorStore.selectionMode,
  set: (val) => {
    if (val) editorStore.selectionMode = val as 'box' | 'lasso'
  },
})

// 显示模式切换
const displayMode = computed({
  get: () => settingsStore.settings.threeDisplayMode,
  set: (val) => {
    if (val) settingsStore.settings.threeDisplayMode = val as 'box' | 'icon' | 'simple-box'
  },
})
// 视图预设切换
const viewPreset = computed({
  get: () => uiStore.currentViewPreset,
  set: (val) => {
    if (!val) return

    const idMap: Record<string, string> = {
      perspective: 'view.setViewPerspective',
      top: 'view.setViewTop',
      bottom: 'view.setViewBottom',
      front: 'view.setViewFront',
      back: 'view.setViewBack',
      left: 'view.setViewLeft',
      right: 'view.setViewRight',
    }

    const cmdId = idMap[val]
    if (cmdId) {
      commandStore.executeCommand(cmdId)
    }
  },
})

// 配置数据
const selectionActions = [
  { id: 'new', label: '新选区 (默认)', icon: IconSelectionNew },
  { id: 'add', label: '加选 (Shift)', icon: IconSelectionAdd },
  { id: 'subtract', label: '减选 (Alt)', icon: IconSelectionSubtract },
  {
    id: 'intersect',
    label: '交叉选区 (Shift+Alt)',
    icon: IconSelectionIntersect,
  },
] as const

const displayModes = [
  { id: 'box', label: '完整体积', icon: Cuboid },
  { id: 'simple-box', label: '简化方块', icon: Box },
  { id: 'icon', label: '图标模式', icon: ImageIcon },
] as const

const viewPresets = [
  { id: 'top', label: '顶视图', icon: ChevronsUp },
  { id: 'front', label: '前视图', icon: ChevronsRight },
  { id: 'left', label: '左视图', icon: ChevronLeft },
  { id: 'right', label: '右视图', icon: ChevronRight },
  { id: 'back', label: '后视图', icon: ChevronsLeft },
  { id: 'bottom', label: '底视图', icon: ChevronsDown },
] as const
</script>

<template>
  <div class="flex flex-col gap-3 border-b border-gray-200 bg-white p-4 pr-2">
    <!-- 工具栏第一行：主要工具 -->
    <div class="flex items-start justify-between">
      <!-- 左侧：选择/拖拽工具 -->
      <div class="flex flex-col items-start gap-1">
        <span class="text-[10px] font-medium text-gray-400 select-none">工具</span>
        <div class="flex items-center gap-0.5">
          <SidebarToggleItem
            :model-value="currentTool === 'select' && selectionMode === 'box'"
            @update:model-value="
              (v) => {
                if (v) {
                  currentTool = 'select'
                  selectionMode = 'box'
                }
              }
            "
            tooltip="方形选框 (V)"
          >
            <SquareMousePointer class="h-4 w-4" />
          </SidebarToggleItem>
          <SidebarToggleItem
            :model-value="currentTool === 'select' && selectionMode === 'lasso'"
            @update:model-value="
              (v) => {
                if (v) {
                  currentTool = 'select'
                  selectionMode = 'lasso'
                }
              }
            "
            tooltip="套索工具"
          >
            <Lasso class="h-4 w-4" />
          </SidebarToggleItem>
          <SidebarToggleItem
            :model-value="currentTool === 'hand'"
            @update:model-value="
              (v) => {
                if (v) currentTool = 'hand'
              }
            "
            tooltip="拖拽工具 (H)"
          >
            <Hand class="h-4 w-4" />
          </SidebarToggleItem>

          <!-- Gizmo 开关 -->
          <SidebarToggleItem
            :model-value="settingsStore.settings.showGizmo"
            @update:model-value="
              (v) => {
                settingsStore.settings.showGizmo = v
              }
            "
            tooltip="显示变换轴 (G)"
          >
            <Move class="h-4 w-4" />
          </SidebarToggleItem>
        </div>
      </div>
    </div>

    <!-- 工具栏第二行：选择行为模式 -->
    <div class="flex flex-col items-start gap-1">
      <span class="text-[10px] font-medium text-gray-400 select-none">选择模式</span>
      <div class="flex items-center gap-0.5">
        <SidebarToggleItem
          v-for="action in selectionActions"
          :key="action.id"
          :model-value="activeAction === action.id"
          @update:model-value="
            (v) => {
              if (v) selectionAction = action.id
            }
          "
          :tooltip="action.label"
        >
          <component :is="action.icon" class="h-4 w-4" />
        </SidebarToggleItem>
      </div>
    </div>

    <!-- 工具栏第三行：显示模式 -->
    <div class="flex flex-col items-start gap-1">
      <span class="text-[10px] font-medium text-gray-400 select-none">显示</span>
      <div class="flex items-center gap-0.25">
        <SidebarToggleItem
          v-for="mode in displayModes"
          :key="mode.id"
          :model-value="displayMode === mode.id"
          @update:model-value="
            (v) => {
              if (v) displayMode = mode.id
            }
          "
          :tooltip="mode.label"
        >
          <component :is="mode.icon" class="h-4 w-4" />
        </SidebarToggleItem>
      </div>
    </div>

    <!-- 工具栏第四行：视图控制 -->
    <div class="flex flex-col items-start gap-1">
      <span class="text-[10px] font-medium text-gray-400 select-none">视图</span>
      <div class="flex w-full items-center justify-between">
        <SidebarToggleItem
          :model-value="viewPreset === 'perspective'"
          @update:model-value="
            (v) => {
              if (v) viewPreset = 'perspective'
            }
          "
          tooltip="透视视图"
        >
          <Camera class="h-4 w-4" />
        </SidebarToggleItem>

        <div class="mx-0.5 h-4 w-px bg-gray-200"></div>

        <SidebarToggleItem
          v-for="view in viewPresets"
          :key="view.id"
          :model-value="viewPreset === view.id"
          @update:model-value="
            (v) => {
              if (v) viewPreset = view.id
            }
          "
          :tooltip="view.label"
        >
          <component :is="view.icon" class="h-4 w-4" />
        </SidebarToggleItem>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useCommandStore } from '../stores/commandStore'
import { useCanvasZoom } from '../composables/useCanvasZoom'
import { useCanvasSelection } from '../composables/useCanvasSelection'
import { useCanvasDrag } from '../composables/useCanvasDrag'
import { useCanvasRendering } from '../composables/useCanvasRendering'
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts'

const editorStore = useEditorStore()
const commandStore = useCommandStore()

// Stage 引用
const stageRef = ref<any>(null)

// 组合各个功能模块
const zoom = useCanvasZoom(editorStore, stageRef)
const { scale, stageConfig, handleWheel, resetView, fitToView, zoomIn, zoomOut } = zoom

const { unselectedLayerRef, selectedLayerRef, interactionLayerRef } = useCanvasRendering(
  editorStore,
  scale
)

// 快捷键系统
const { isSpacePressed } = useKeyboardShortcuts({
  commands: commandStore.commands,
  executeCommand: commandStore.executeCommand,
  stageRef,
  stageConfig,
})

// 选择和拖拽
const { selectionRect, handleMouseDown, handleMouseMove, handleMouseUp } = useCanvasSelection(
  editorStore,
  stageRef,
  scale,
  isSpacePressed
)
const { selectedItems, handleDragStart, handleDragMove, handleDragEnd } = useCanvasDrag(
  editorStore,
  selectedLayerRef
)

// 将缩放函数注册到命令系统
onMounted(() => {
  commandStore.setZoomFunctions(zoomIn, zoomOut, resetView, fitToView)

  // 如果已有数据，初始化视图
  if (editorStore.items.length > 0) {
    fitToView()
  }
})
</script>

<template>
  <div class="relative flex-1 overflow-hidden bg-gray-100">
    <!-- 空状态提示 -->
    <div
      v-if="editorStore.items.length === 0"
      class="absolute inset-0 flex items-center justify-center text-lg text-gray-400"
    >
      <div class="text-center">
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
        <p>请导入 JSON 文件以查看物品</p>
        <p class="mt-2 text-sm text-gray-300">使用鼠标滚轮缩放</p>
        <p class="text-sm text-gray-300">按住空格键拖拽画布平移</p>
      </div>
    </div>

    <!-- Konva Stage -->
    <v-stage
      v-if="editorStore.items.length > 0"
      ref="stageRef"
      :config="stageConfig"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
    >
      <!-- Layer 1: 批量绘制未选中圆点 -->
      <v-layer ref="unselectedLayerRef">
        <!-- 通过 updateUnselectedItemsShape() 动态添加 -->
      </v-layer>

      <!-- Layer 2: 单独渲染选中圆点（可拖拽） -->
      <v-layer ref="selectedLayerRef">
        <v-circle
          v-for="item in selectedItems"
          :key="item.internalId"
          :config="{
            x: item.x,
            y: item.y,
            radius: Math.max(4, 6 / scale),
            fill: '#3b82f6',
            stroke: '#2563eb',
            strokeWidth: Math.max(0.5, 1 / scale),
            draggable: true,
            itemId: item.internalId,
            name: 'selectedCircle',
          }"
          @dragstart="(e: any) => handleDragStart(item, e)"
          @dragmove="(e: any) => handleDragMove(item, e)"
          @dragend="(e: any) => handleDragEnd(item, e)"
        />
      </v-layer>

      <!-- Layer 3: 交互层（框选矩形、原点标记） -->
      <v-layer ref="interactionLayerRef">
        <!-- 原点标记 -->
        <v-circle
          :config="{
            x: 0,
            y: 0,
            radius: Math.max(4, 8 / scale),
            fill: '#ef4444',
            stroke: '#dc2626',
            strokeWidth: Math.max(0.5, 2 / scale),
          }"
        />
        <v-text
          :config="{
            x: Math.max(5, 10 / scale),
            y: Math.max(-3, -5 / scale),
            text: 'Origin (0, 0)',
            fontSize: Math.max(8, 12 / scale),
            fill: '#ef4444',
          }"
        />

        <!-- 框选矩形 -->
        <v-rect
          v-if="selectionRect"
          :config="{
            x: selectionRect.x,
            y: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
            stroke: '#3b82f6',
            strokeWidth: Math.max(0.5, 1 / scale),
            dash: [Math.max(2, 4 / scale), Math.max(2, 4 / scale)],
            fill: 'rgba(59, 130, 246, 0.1)',
            listening: false,
          }"
        />
      </v-layer>
    </v-stage>

    <!-- 缩放信息和控制按钮 -->
    <div
      v-if="editorStore.items.length > 0"
      class="absolute right-4 bottom-4 flex items-center gap-2"
    >
      <!-- 空格键拖拽模式提示 -->
      <div
        v-if="isSpacePressed"
        class="flex items-center gap-1 rounded-md bg-green-600 px-3 py-2 text-xs font-medium text-white shadow-sm"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"
          ></path>
        </svg>
        画布拖拽模式
      </div>

      <!-- 选中数量提示 -->
      <div
        v-if="editorStore.selectedItemIds.size > 0"
        class="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white shadow-sm"
      >
        已选中 {{ editorStore.selectedItemIds.size }} 个物品
      </div>

      <div class="rounded-md bg-white/90 px-3 py-2 text-xs text-gray-600 shadow-sm">
        缩放: {{ (scale * 100).toFixed(0) }}%
      </div>
      <button
        @click="resetView"
        class="flex items-center gap-1 rounded-md bg-white/90 px-3 py-2 text-xs text-gray-700 shadow-sm transition-colors hover:bg-white"
        title="重置视图"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
          ></path>
        </svg>
        重置视图
      </button>
    </div>
  </div>
</template>

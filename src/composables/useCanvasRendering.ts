import { ref, watch, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import Konva from 'konva'

// 颜色配置常量
const ITEM_COLORS = {
  // 选中状态
  selected: {
    fill: 'rgba(59, 130, 246, 0.8)', // blue-500 with 80% opacity
    stroke: 'rgba(37, 99, 235, 1)', // blue-600 solid
  },
  // 普通标点
  normal: {
    fill: 'rgba(148, 163, 184, 0.8)', // slate-400 with 80% opacity
    stroke: 'rgba(71, 85, 105, 1)', // slate-600 solid
  },
  // 组标点描边
  group: {
    stroke: 'rgba(0, 0, 0, 0.29)', // dark semi-transparent
  },
} as const

export function useCanvasRendering(
  editorStore: ReturnType<typeof useEditorStore>,
  scale: Ref<number>
) {
  // Layer 引用
  const mainLayerRef = ref<any>(null)
  const interactionLayerRef = ref<any>(null)

  // 是否隐藏选中物品（拖拽时使用）
  const hideSelectedItems = ref(false)

  // 批量绘制所有物品
  function updateMainLayer() {
    const layer = mainLayerRef.value?.getNode()
    if (!layer) return

    // 清空现有内容
    layer.destroyChildren()

    const visibleItems = editorStore.visibleItems
    if (visibleItems.length === 0) {
      layer.batchDraw()
      return
    }

    // 创建批量绘制的 Shape
    const shape = new Konva.Shape({
      sceneFunc: (context) => {
        const radius = Math.max(4, 6 / scale.value)
        const strokeWidth = Math.max(0.5, 1 / scale.value)

        visibleItems.forEach((item) => {
          const isSelected = editorStore.selectedItemIds.has(item.internalId)
          const groupId = item.originalData.GroupID

          // 拖拽时跳过选中物品的渲染
          if (hideSelectedItems.value && isSelected) return

          // 绘制物品点
          context.beginPath()
          context.arc(item.x, item.y, radius, 0, Math.PI * 2, false)

          // 根据状态设置颜色（所有颜色已是 RGBA 格式，无需转换）
          if (isSelected) {
            context.fillStyle = ITEM_COLORS.selected.fill
            context.strokeStyle = ITEM_COLORS.selected.stroke
          } else if (groupId > 0) {
            context.fillStyle = editorStore.getGroupColor(groupId) // 已是 rgba 格式
            context.strokeStyle = ITEM_COLORS.group.stroke
          } else {
            context.fillStyle = ITEM_COLORS.normal.fill
            context.strokeStyle = ITEM_COLORS.normal.stroke
          }

          context.fill()
          context.lineWidth = strokeWidth
          context.stroke()
        })
      },
      // 启用碰撞检测
      hitFunc: (context, shape) => {
        const radius = Math.max(4, 6 / scale.value)
        const hitRadius = radius + Math.max(2, 4 / scale.value)

        visibleItems.forEach((item) => {
          // 拖拽时跳过选中物品的碰撞检测
          if (hideSelectedItems.value && editorStore.selectedItemIds.has(item.internalId)) return

          context.beginPath()
          context.arc(item.x, item.y, hitRadius, 0, Math.PI * 2, false)
          context.fillStrokeShape(shape)
        })
      },
    })

    layer.add(shape)
    layer.batchDraw()
  }

  // 设置是否隐藏选中物品
  function setHideSelectedItems(hide: boolean) {
    hideSelectedItems.value = hide
    updateMainLayer()
  }

  // 监听变化，自动更新
  watch(
    () => [
      editorStore.visibleItems.length,
      editorStore.selectedItemIds.size,
      editorStore.heightFilter.currentMin,
      editorStore.heightFilter.currentMax,
      scale.value,
      // 监听物品数据变化（包括 GroupID 变化）
      editorStore.items.map((item) => item.originalData.GroupID).join(','),
    ],
    () => {
      updateMainLayer()
    },
    { immediate: true }
  )

  return {
    mainLayerRef,
    interactionLayerRef,
    updateMainLayer,
    setHideSelectedItems,
  }
}

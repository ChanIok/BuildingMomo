import { ref, watch, type Ref } from 'vue'
import Konva from 'konva'
import type { useEditorStore } from '../stores/editorStore'

export function useCanvasRendering(
  editorStore: ReturnType<typeof useEditorStore>,
  scale: Ref<number>
) {
  // Layer 引用
  const unselectedLayerRef = ref<any>(null)
  const selectedLayerRef = ref<any>(null)
  const interactionLayerRef = ref<any>(null)
  const unselectedShapeRef = ref<any>(null)

  // 创建批量绘制未选中圆点的 Shape
  function createUnselectedItemsShape() {
    return new Konva.Shape({
      sceneFunc: (context, _shape) => {
        const selectedIds = editorStore.selectedItemIds
        const currentScale = scale.value

        // 只绘制未选中的圆点
        const unselectedItems = editorStore.visibleItems.filter(
          (item) => !selectedIds.has(item.internalId)
        )

        const baseRadius = 6
        const compensatedRadius = baseRadius / currentScale
        const radius = Math.max(4, compensatedRadius)

        const baseStrokeWidth = 1
        const compensatedStrokeWidth = baseStrokeWidth / currentScale
        const strokeWidth = Math.max(0.5, compensatedStrokeWidth)

        unselectedItems.forEach((item) => {
          context.beginPath()
          context.arc(item.x, item.y, radius, 0, Math.PI * 2, false)
          context.fillStyle = '#94a3b8'
          context.globalAlpha = 0.8
          context.fill()
          context.strokeStyle = '#475569'
          context.lineWidth = strokeWidth
          context.stroke()
        })

        context.globalAlpha = 1
      },
    })
  }

  // 更新批量绘制的 Shape
  function updateUnselectedItemsShape() {
    const layer = unselectedLayerRef.value?.getNode()
    if (!layer) return

    // 移除旧的 shape
    if (unselectedShapeRef.value) {
      unselectedShapeRef.value.destroy()
    }

    // 创建新的 shape
    if (editorStore.visibleItems.length > 0) {
      unselectedShapeRef.value = createUnselectedItemsShape()
      layer.add(unselectedShapeRef.value)
      layer.batchDraw()
    }
  }

  // 监听可见物品变化，更新批量绘制
  watch(
    () => editorStore.visibleItems,
    () => {
      updateUnselectedItemsShape()
    },
    { deep: true }
  )

  // 监听选中状态变化，更新批量绘制
  watch(
    () => editorStore.selectedItems,
    () => {
      updateUnselectedItemsShape()
    },
    { deep: true }
  )

  // 监听缩放变化，更新批量绘制（因为圆点大小依赖于缩放）
  watch(scale, () => {
    updateUnselectedItemsShape()
  })

  return {
    unselectedLayerRef,
    selectedLayerRef,
    interactionLayerRef,
    unselectedShapeRef,
    updateUnselectedItemsShape,
  }
}

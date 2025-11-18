import { ref, watch, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import Konva from 'konva'
import { getItemRenderer } from './useItemRenderer'
import { useInputState } from './useInputState'

export function useCanvasDrag(
  editorStore: ReturnType<typeof useEditorStore>,
  stageRef: Ref<any>,
  scale: Ref<number>,
  setHideSelectedItems: (hide: boolean) => void
) {
  // 拖拽状态
  const isDragging = ref(false)
  const ghostLayer = ref<Konva.Layer | null>(null)
  const dragStartPos = ref({ x: 0, y: 0 })

  // 物品渲染器
  const renderer = getItemRenderer()

  // 使用统一的输入状态管理
  const { isLeftMousePressed } = useInputState()

  // 创建 Ghost Layer
  function createGhostLayer() {
    const stage = stageRef.value?.getNode()
    if (!stage) return null

    const layer = new Konva.Layer()

    // 获取选中物品
    const selectedItems = editorStore.visibleItems.filter((item) =>
      editorStore.selectedItemIds.has(item.internalId)
    )

    // 预加载图标
    renderer.preloadIcons(selectedItems, scale.value)

    // 批量绘制选中物品（使用统一的渲染器）
    const ghostShape = new Konva.Shape({
      sceneFunc: (context) => {
        // 使用统一的渲染器，强制显示为选中状态
        renderer.drawItems(context, selectedItems, {
          scale: scale.value,
          editorStore,
          forceSelected: true, // 拖拽时强制显示为选中状态
        })
      },
      listening: false, // Ghost Layer 不需要事件监听
    })

    layer.add(ghostShape)
    stage.add(layer)
    layer.moveToTop() // 确保在最上层
    layer.batchDraw()

    return layer
  }

  // 开始拖拽：创建幽灵图层供预览
  function startDrag(worldPos: { x: number; y: number }, isAltPressed: boolean) {
    // 保存历史（在拖拽开始时保存，用于撤销）
    editorStore.saveHistory('edit')

    isDragging.value = true
    dragStartPos.value = { x: worldPos.x, y: worldPos.y }

    // 创建 Ghost Layer（半透明预览层）
    ghostLayer.value = createGhostLayer()

    // 根据操作类型决定是否隐藏原物品：
    // - Alt 复制：保留原物品在原位（不隐藏）
    // - 普通移动：隐藏原物品（幽灵图层就是原物品在移动）
    setHideSelectedItems(!isAltPressed)
  }

  // 拖拽移动
  function moveDrag(worldPos: { x: number; y: number }) {
    if (!isDragging.value || !ghostLayer.value) return

    const dx = worldPos.x - dragStartPos.value.x
    const dy = worldPos.y - dragStartPos.value.y

    // 只移动整个 Ghost Layer
    ghostLayer.value.position({ x: dx, y: dy })
    ghostLayer.value.batchDraw()
  }

  // 结束拖拽：清理幽灵图层
  function endDrag() {
    if (!isDragging.value || !ghostLayer.value) return

    // 注意：不在这里调用 moveSelectedItems 或 duplicateSelected
    // 这些操作已经在 useCanvasSelection 的 MouseUp 中根据 Alt 状态执行

    // 清理 Ghost Layer
    ghostLayer.value.destroy()
    ghostLayer.value = null
    isDragging.value = false

    // 恢复主 Layer 上的选中物品显示
    setHideSelectedItems(false)
  }

  // 取消拖拽
  function cancelDrag() {
    if (!isDragging.value) return

    // 清理 Ghost Layer
    if (ghostLayer.value) {
      ghostLayer.value.destroy()
      ghostLayer.value = null
    }

    isDragging.value = false

    // 恢复主 Layer 上的选中物品显示
    setHideSelectedItems(false)
  }

  // 监听左键释放（在画布外也能捕获）
  watch(isLeftMousePressed, (pressed) => {
    if (!pressed && isDragging.value) {
      // 在画布外松开按键时，取消拖拽（不保存位置）
      // 注意：实际的移动/复制操作由 useCanvasSelection 处理
      cancelDrag()
    }
  })

  return {
    isDragging,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
  }
}

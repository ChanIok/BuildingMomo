import { ref, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import Konva from 'konva'
import { getItemRenderer } from './useItemRenderer'

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

  // 开始拖拽
  function startDrag(worldPos: { x: number; y: number }, isAltPressed: boolean) {
    // 保存历史（在拖拽开始时保存，而不是移动过程中）
    editorStore.saveHistory('edit')

    // Alt 复制：立即复制选中物品
    // duplicateSelected 内部也会保存历史，所以 Alt+拖拽会产生两次历史记录
    // 第一次：拖拽前的状态，第二次：复制后拖拽前的状态
    // 这样用户可以：Ctrl+Z 撤销拖拽 → 再 Ctrl+Z 撤销复制
    if (isAltPressed) {
      editorStore.duplicateSelected(0, 0)
    }

    isDragging.value = true
    dragStartPos.value = { x: worldPos.x, y: worldPos.y }

    // 创建 Ghost Layer
    ghostLayer.value = createGhostLayer()

    // 隐藏主 Layer 上的选中物品
    setHideSelectedItems(true)
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

  // 结束拖拽
  function endDrag(worldPos: { x: number; y: number }) {
    if (!isDragging.value || !ghostLayer.value) return

    const dx = worldPos.x - dragStartPos.value.x
    const dy = worldPos.y - dragStartPos.value.y

    // 更新 store 中所有选中物品的位置
    editorStore.moveSelectedItems(dx, dy)

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

  return {
    isDragging,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
  }
}

import { ref, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { AppItem } from '../types/editor'

export function useCanvasSelection(
  editorStore: ReturnType<typeof useEditorStore>,
  stageRef: Ref<any>,
  scale: Ref<number>,
  isCanvasDragMode: Ref<boolean>,
  stageConfig: Ref<any>
) {
  // 框选状态
  const selectionRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const isSelecting = ref(false)
  const selectionStart = ref<{ x: number; y: number } | null>(null)
  const mouseDownScreenPos = ref<{ x: number; y: number } | null>(null) // 记录屏幕坐标起始位置

  // 鼠标中键状态
  const isMiddleMousePressed = ref(false)
  const lastPointerPos = ref<{ x: number; y: number } | null>(null)

  // 更新画布拖动模式
  function updateDragMode(isDragMode: boolean) {
    stageConfig.value.draggable = isDragMode

    const stage = stageRef.value?.getStage()
    if (stage) {
      const container = stage.container()
      container.style.cursor = isDragMode ? 'grab' : 'default'
    }
  }

  // 点选功能：手动碰撞检测
  function handleStageClick(e: any) {
    const stage = e.target.getStage()
    const pointerPos = stage.getPointerPosition()

    if (!pointerPos) return

    // 转换为世界坐标
    const worldPos = {
      x: (pointerPos.x - stage.x()) / stage.scaleX(),
      y: (pointerPos.y - stage.y()) / stage.scaleY(),
    }

    // 计算点击半径（考虑缩放补偿 + 容差）
    const clickRadius = Math.max(4, 6 / scale.value) + 2

    // 遍历可见物品，找到最近的圆点
    let clickedItem: AppItem | null = null
    let minDistance = clickRadius

    for (const item of editorStore.visibleItems) {
      const distance = Math.sqrt(
        Math.pow(item.x - worldPos.x, 2) + Math.pow(item.y - worldPos.y, 2)
      )
      if (distance < minDistance) {
        minDistance = distance
        clickedItem = item
      }
    }

    if (clickedItem) {
      // 检测 Shift 键
      const shiftPressed = e.evt.shiftKey
      editorStore.toggleSelection(clickedItem.internalId, shiftPressed)
    } else {
      // 点击空白处，清空选中
      if (!e.evt.shiftKey) {
        editorStore.clearSelection()
      }
    }
  }

  // 框选功能
  function handleMouseDown(e: any) {
    const evt = e.evt as MouseEvent

    // 检测鼠标右键（button === 2），不触发框选，留给右键菜单处理
    if (evt.button === 2) {
      return
    }

    // 检测鼠标中键（button === 1）
    if (evt.button === 1) {
      evt.preventDefault() // 阻止浏览器默认行为（如自动滚动）
      isMiddleMousePressed.value = true
      updateDragMode(true)
      const stage = e.target.getStage()
      const pos = stage?.getPointerPosition()
      if (pos) {
        lastPointerPos.value = { x: pos.x, y: pos.y }
      }
      return // 不触发框选
    }

    // 如果处于画布拖动模式（空格键），不触发框选
    if (isCanvasDragMode.value) return

    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()

    if (!pos) return

    // 记录屏幕坐标起始位置（用于判断是点击还是拖拽）
    mouseDownScreenPos.value = { x: pos.x, y: pos.y }

    // 转换为世界坐标
    const worldPos = {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: (pos.y - stage.y()) / stage.scaleY(),
    }

    isSelecting.value = true
    selectionStart.value = worldPos
    selectionRect.value = { x: worldPos.x, y: worldPos.y, width: 0, height: 0 }
  }

  function handleMouseMove(e: any) {
    // 中键拖动画布：手动更新 Stage 位置（Konva 只支持左键拖拽）
    if (isMiddleMousePressed.value) {
      const stage = e.target.getStage()
      const pos = stage.getPointerPosition()
      if (stage && pos && lastPointerPos.value) {
        const dx = pos.x - lastPointerPos.value.x
        const dy = pos.y - lastPointerPos.value.y
        stage.x(stage.x() + dx)
        stage.y(stage.y() + dy)
        lastPointerPos.value = { x: pos.x, y: pos.y }
        stage.batchDraw()
      }
      return
    }

    if (!isSelecting.value || !selectionStart.value) return

    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()

    if (!pos) return

    const worldPos = {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: (pos.y - stage.y()) / stage.scaleY(),
    }

    // 更新框选矩形
    selectionRect.value = {
      x: Math.min(selectionStart.value.x, worldPos.x),
      y: Math.min(selectionStart.value.y, worldPos.y),
      width: Math.abs(worldPos.x - selectionStart.value.x),
      height: Math.abs(worldPos.y - selectionStart.value.y),
    }
  }

  function handleMouseUp(e: any) {
    const evt = e.evt as MouseEvent

    // 检测鼠标右键释放，不处理
    if (evt.button === 2) {
      return
    }

    // 检测鼠标中键释放
    if (evt.button === 1) {
      isMiddleMousePressed.value = false
      updateDragMode(false)
      lastPointerPos.value = null
      return
    }

    // 如果正在框选，检查是点击还是拖拽
    if (isSelecting.value && selectionRect.value && mouseDownScreenPos.value) {
      const stage = e.target.getStage()
      const endPos = stage.getPointerPosition()

      // 计算屏幕坐标移动距离
      let moveDistance = 0
      if (endPos) {
        moveDistance = Math.sqrt(
          Math.pow(endPos.x - mouseDownScreenPos.value.x, 2) +
            Math.pow(endPos.y - mouseDownScreenPos.value.y, 2)
        )
      }

      // 如果移动距离小于 3 像素，当作点击处理
      if (moveDistance < 3) {
        handleStageClick(e)
      } else {
        // 否则当作框选处理
        const rect = selectionRect.value
        const selectedIds = editorStore.visibleItems
          .filter(
            (item) =>
              item.x >= rect.x &&
              item.x <= rect.x + rect.width &&
              item.y >= rect.y &&
              item.y <= rect.y + rect.height
          )
          .map((item) => item.internalId)

        // 更新选中状态
        const shiftPressed = e.evt.shiftKey
        editorStore.updateSelection(selectedIds, shiftPressed)
      }
    }

    // 清除框选状态
    isSelecting.value = false
    selectionRect.value = null
    selectionStart.value = null
    mouseDownScreenPos.value = null
  }

  return {
    selectionRect,
    isSelecting,
    isMiddleMousePressed,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  }
}

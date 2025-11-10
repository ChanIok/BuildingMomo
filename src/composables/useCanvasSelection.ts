import { ref, computed, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { AppItem } from '../types/editor'
import { useInputState } from './useInputState'
import { useCanvasVisualSize } from './useCanvasVisualSize'

export function useCanvasSelection(
  editorStore: ReturnType<typeof useEditorStore>,
  stageRef: Ref<any>,
  scale: Ref<number>,
  isCanvasDragMode: Ref<boolean>,
  stageConfig: Ref<any>,
  onDragStart?: (worldPos: { x: number; y: number }, isAltPressed: boolean) => void,
  onDragMove?: (worldPos: { x: number; y: number }) => void,
  onDragEnd?: (worldPos: { x: number; y: number }) => void
) {
  // 使用统一的输入状态管理
  const { isShiftPressed, isAltPressed, isSpacePressed } = useInputState()

  // 使用统一的视觉尺寸管理
  const visualSize = useCanvasVisualSize()

  // 框选状态
  const selectionRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const isSelecting = ref(false)
  const selectionStart = ref<{ x: number; y: number } | null>(null)
  const mouseDownScreenPos = ref<{ x: number; y: number } | null>(null) // 记录屏幕坐标起始位置
  const selectionMode = ref<'replace' | 'add' | 'subtract'>('replace') // 框选模式

  // 拖拽状态
  const isDraggingItem = ref(false)
  const draggedItem = ref<AppItem | null>(null)

  // 鼠标中键状态
  const isMiddleMousePressed = ref(false)
  const lastPointerPos = ref<{ x: number; y: number } | null>(null)

  // 计算当前选择模式（实时根据键盘状态）
  const currentSelectionMode = computed<'replace' | 'add' | 'subtract'>(() => {
    if (isAltPressed.value) return 'subtract'
    if (isShiftPressed.value) return 'add'
    return 'replace'
  })

  // 是否应该显示模式提示（排除画布拖拽模式）
  const shouldShowModeHint = computed(() => {
    // 如果按了空格键，不显示选择模式提示
    if (isSpacePressed?.value || isCanvasDragMode.value) return false
    return isSelecting.value || isShiftPressed.value || isAltPressed.value
  })

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

    // 使用统一的视觉尺寸计算
    const radius = visualSize.getMarkerRadius(scale.value)
    const strokeWidth = visualSize.getMarkerStrokeWidth(scale.value)
    const clickRadius = radius + strokeWidth

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

  // 检测点击位置是否在选中物品上
  function findItemAtPosition(worldPos: { x: number; y: number }): AppItem | null {
    // 使用统一的视觉尺寸计算
    const radius = visualSize.getMarkerRadius(scale.value)
    const strokeWidth = visualSize.getMarkerStrokeWidth(scale.value)
    const clickRadius = radius + strokeWidth
    let closestItem: AppItem | null = null
    let closestSelectedItem: AppItem | null = null
    let minDistance = clickRadius
    let minSelectedDistance = clickRadius

    for (const item of editorStore.visibleItems) {
      const distance = Math.sqrt(
        Math.pow(item.x - worldPos.x, 2) + Math.pow(item.y - worldPos.y, 2)
      )

      if (distance < minDistance) {
        minDistance = distance
        closestItem = item
      }

      // 如果是选中物品，单独记录
      if (editorStore.selectedItemIds.has(item.internalId) && distance < minSelectedDistance) {
        minSelectedDistance = distance
        closestSelectedItem = item
      }
    }

    // 优先返回选中的物品（解决重叠时的选择问题）
    return closestSelectedItem || closestItem
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

    // 检测是否点击在选中物品上
    const clickedItem = findItemAtPosition(worldPos)

    if (clickedItem && editorStore.selectedItemIds.has(clickedItem.internalId)) {
      // 点击在选中物品上，准备拖拽
      isDraggingItem.value = true
      draggedItem.value = clickedItem

      // 触发拖拽开始
      if (onDragStart) {
        onDragStart(worldPos, evt.altKey)
      }
      return
    }

    // 否则开始框选
    isSelecting.value = true
    selectionStart.value = worldPos
    selectionRect.value = { x: worldPos.x, y: worldPos.y, width: 0, height: 0 }

    // 设置框选模式（使用当前实时模式）
    selectionMode.value = currentSelectionMode.value
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

    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    if (!pos) return

    const worldPos = {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: (pos.y - stage.y()) / stage.scaleY(),
    }

    // 如果正在拖拽物品
    if (isDraggingItem.value) {
      if (onDragMove) {
        onDragMove(worldPos)
      }
      return
    }

    // 如果正在框选
    if (isSelecting.value && selectionStart.value) {
      // 更新框选矩形
      selectionRect.value = {
        x: Math.min(selectionStart.value.x, worldPos.x),
        y: Math.min(selectionStart.value.y, worldPos.y),
        width: Math.abs(worldPos.x - selectionStart.value.x),
        height: Math.abs(worldPos.y - selectionStart.value.y),
      }
    }
  }

  function handleMouseUp(e: any) {
    const evt = e.evt as MouseEvent

    console.log('[MOUSEUP]', {
      button: evt.button,
      shiftKey: evt.shiftKey,
      altKey: evt.altKey,
      ctrlKey: evt.ctrlKey,
      isSelecting: isSelecting.value,
      selectionMode: selectionMode.value,
    })

    // 检测鼠标右键释放，不处理
    if (evt.button === 2) {
      console.log('[MOUSEUP] Right button released, ignoring')
      return
    }

    // 检测鼠标中键释放
    if (evt.button === 1) {
      isMiddleMousePressed.value = false
      updateDragMode(false)
      lastPointerPos.value = null
      console.log('[MOUSEUP] Middle button released, drag mode stopped')
      return
    }

    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()

    if (pos) {
      const worldPos = {
        x: (pos.x - stage.x()) / stage.scaleX(),
        y: (pos.y - stage.y()) / stage.scaleY(),
      }

      // 如果正在拖拽物品
      if (isDraggingItem.value) {
        if (onDragEnd) {
          onDragEnd(worldPos)
        }
        isDraggingItem.value = false
        draggedItem.value = null
        mouseDownScreenPos.value = null
        return
      }
    }

    // 如果正在框选，检查是点击还是拖拽
    if (isSelecting.value && selectionRect.value && mouseDownScreenPos.value) {
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
        const altPressed = e.evt.altKey

        if (altPressed) {
          // Alt+框选: 减选模式
          console.log('[MOUSEUP] Executing subtract selection with', selectedIds.length, 'items')
          editorStore.deselectItems(selectedIds)
        } else {
          // 普通框选/Shift+框选: 替换/增选模式
          console.log(
            '[MOUSEUP] Executing',
            shiftPressed ? 'add' : 'replace',
            'selection with',
            selectedIds.length,
            'items'
          )
          editorStore.updateSelection(selectedIds, shiftPressed)
        }
      }
    }

    // 清除框选状态
    console.log('[MOUSEUP] Clearing selection state', {
      wasSelecting: isSelecting.value,
      hadRect: !!selectionRect.value,
    })
    isSelecting.value = false
    selectionRect.value = null
    selectionStart.value = null
    mouseDownScreenPos.value = null
    selectionMode.value = 'replace'
    console.log('[MOUSEUP] Selection state cleared')
  }

  return {
    selectionRect,
    selectionMode,
    currentSelectionMode,
    shouldShowModeHint,
    isSelecting,
    isMiddleMousePressed,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    findItemAtPosition,
  }
}

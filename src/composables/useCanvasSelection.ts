import { ref, computed, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { AppItem } from '../types/editor'
import { useInputState } from './useInputState'
import { hitTestItem } from './useItemRenderer'
import { useCanvasCoordinates } from './useCanvasCoordinates'

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

  // 使用坐标转换工具
  const { screenToWorld } = useCanvasCoordinates(stageRef)

  // 框选状态
  const selectionRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const isSelecting = ref(false)
  const selectionStart = ref<{ x: number; y: number } | null>(null)
  const mouseDownScreenPos = ref<{ x: number; y: number } | null>(null) // 记录屏幕坐标起始位置
  const selectionMode = ref<'replace' | 'add' | 'subtract'>('replace') // 框选模式

  // 拖拽状态
  const isDraggingItem = ref(false)
  const draggedItem = ref<AppItem | null>(null)
  const dragStartAltPressed = ref(false) // 记录拖拽开始时的 Alt 状态
  const hasActuallyDragged = ref(false) // 标记是否真正发生了拖拽（移动距离 ≥ 3px）

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

  // 点选功能：使用统一的碰撞检测
  function handleStageClick(e: any) {
    const stage = e.target.getStage()
    const pointerPos = stage.getPointerPosition()

    if (!pointerPos) return

    // 转换为世界坐标
    const worldPos = screenToWorld(pointerPos)

    // 遍历可见物品，使用统一的碰撞检测
    let clickedItem: AppItem | null = null

    for (const item of editorStore.visibleItems) {
      if (hitTestItem(item, worldPos, scale.value)) {
        clickedItem = item
        break // 找到第一个命中的物品即可
      }
    }

    if (clickedItem) {
      // 检测修饰键
      const shiftPressed = e.evt.shiftKey
      const altPressed = e.evt.altKey

      if (altPressed) {
        // Alt+点击: 减选模式(从选中集合中移除)
        editorStore.deselectItems([clickedItem.internalId])
        console.log('[STAGE CLICK] Deselecting item', clickedItem.internalId)
      } else {
        // 普通点击/Shift+点击: 替换/增选模式
        editorStore.toggleSelection(clickedItem.internalId, shiftPressed)
        console.log('[STAGE CLICK] Toggling selection for item', clickedItem.internalId)
      }
    } else {
      // 点击空白处，清空选中
      if (!e.evt.shiftKey) {
        editorStore.clearSelection()
      }
    }
  }

  // 检测点击位置是否在物品上（使用统一的碰撞检测）
  function findItemAtPosition(worldPos: { x: number; y: number }): AppItem | null {
    let closestItem: AppItem | null = null
    let closestSelectedItem: AppItem | null = null

    // 遍历可见物品，使用统一的碰撞检测
    for (const item of editorStore.visibleItems) {
      if (hitTestItem(item, worldPos, scale.value)) {
        // 如果是选中物品，优先记录
        if (editorStore.selectedItemIds.has(item.internalId)) {
          if (!closestSelectedItem) {
            closestSelectedItem = item
          }
        } else {
          if (!closestItem) {
            closestItem = item
          }
        }
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
    const worldPos = screenToWorld(pos)

    // 检测是否点击在选中物品上
    const clickedItem = findItemAtPosition(worldPos)

    if (clickedItem && editorStore.selectedItemIds.has(clickedItem.internalId)) {
      // 点击在选中物品上，准备拖拽
      isDraggingItem.value = true
      draggedItem.value = clickedItem
      dragStartAltPressed.value = evt.altKey // 记录 Alt 状态
      hasActuallyDragged.value = false // 重置拖拽标记
      // 注意：这里不调用 onDragStart，等移动距离 ≥ 3px 时再调用
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

    const worldPos = screenToWorld(pos)

    // 如果正在拖拽物品
    if (isDraggingItem.value) {
      // 检查是否真正开始拖拽（移动距离超过阈值）
      if (!hasActuallyDragged.value && mouseDownScreenPos.value) {
        const moveDistance = Math.sqrt(
          Math.pow(pos.x - mouseDownScreenPos.value.x, 2) +
            Math.pow(pos.y - mouseDownScreenPos.value.y, 2)
        )

        // 移动距离超过 3 像素，算作真正的拖拽
        if (moveDistance >= 3) {
          hasActuallyDragged.value = true

          // 现在才真正开始拖拽，创建幽灵图层
          // 传递真实的 Alt 状态，让 startDrag 决定是否隐藏原物品
          if (onDragStart) {
            onDragStart(worldPos, dragStartAltPressed.value)
          }
        }
      }

      // 只有真正开始拖拽后才更新位置
      if (hasActuallyDragged.value && onDragMove) {
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
      const worldPos = screenToWorld(pos)

      // 如果正在拖拽物品
      if (isDraggingItem.value) {
        // 如果没有真正拖拽（移动距离 < 3px），当作点击处理
        if (!hasActuallyDragged.value) {
          // Alt + 点击已选中物品 = 减选
          if (dragStartAltPressed.value && draggedItem.value) {
            editorStore.deselectItems([draggedItem.value.internalId])
          }
          // 注意：普通点击已选中物品不做任何操作
        } else {
          // 真正的拖拽结束
          const stage = e.target.getStage()
          const startWorldPos = {
            x: (mouseDownScreenPos.value!.x - stage.x()) / stage.scaleX(),
            y: (mouseDownScreenPos.value!.y - stage.y()) / stage.scaleY(),
          }
          const dx = worldPos.x - startWorldPos.x
          const dy = worldPos.y - startWorldPos.y

          if (dragStartAltPressed.value) {
            // Alt + 拖拽 = 复制到目标位置（现在才执行复制）
            editorStore.duplicateSelected(dx, dy)
          } else {
            // 普通拖拽 = 移动到目标位置
            editorStore.moveSelectedItems(dx, dy)
          }

          // 结束拖拽（清理幽灵图层）
          if (onDragEnd) {
            onDragEnd(worldPos)
          }
        }

        // 清理拖拽状态
        isDraggingItem.value = false
        draggedItem.value = null
        dragStartAltPressed.value = false
        hasActuallyDragged.value = false
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

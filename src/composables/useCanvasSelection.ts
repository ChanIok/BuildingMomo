import { ref, computed, watch, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { AppItem } from '../types/editor'
import { useInputState } from './useInputState'
import { hitTestItem } from './useItemRenderer'
import { createCanvas2DCoordinates } from '@/lib/coordinates'

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
  // 使用统一的输入状态管理（包含鼠标按钮状态）
  const { isShiftPressed, isAltPressed, isSpacePressed, isMiddleMousePressed, isLeftMousePressed } =
    useInputState()

  // 使用坐标转换工具
  const { screenToWorld } = createCanvas2DCoordinates(stageRef)

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

  // 中键拖拽画布的辅助状态
  const lastPointerPos = ref<{ x: number; y: number } | null>(null)

  // 记录最后已知的世界坐标位置（用于画布外松开按键时）
  const lastKnownWorldPos = ref<{ x: number; y: number } | null>(null)

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

  // ==================== 清理函数 ====================

  // 清理框选状态
  function cleanupSelectionState() {
    isSelecting.value = false
    selectionRect.value = null
    selectionStart.value = null
    mouseDownScreenPos.value = null
    selectionMode.value = 'replace'
  }

  // 清理中键画布拖拽状态
  function cleanupMiddleMouseDrag() {
    updateDragMode(false)
    lastPointerPos.value = null
  }

  // 更新画布拖动模式
  function updateDragMode(isDragMode: boolean) {
    stageConfig.value.draggable = isDragMode

    const stage = stageRef.value?.getStage()
    if (stage) {
      const container = stage.container()
      container.style.cursor = isDragMode ? 'grab' : 'default'
    }
  }

  // ==================== 私有辅助函数：避免重复逻辑 ====================

  // 执行框选逻辑（被 handleMouseUp 和 finishSelection 复用）
  function _executeBoxSelection(rect: { x: number; y: number; width: number; height: number }) {
    const selectedIds = editorStore.visibleItems
      .filter(
        (item) =>
          item.x >= rect.x &&
          item.x <= rect.x + rect.width &&
          item.y >= rect.y &&
          item.y <= rect.y + rect.height
      )
      .map((item) => item.internalId)

    // 使用统一的响应式输入状态
    const shiftPressed = isShiftPressed.value
    const altPressed = isAltPressed.value

    if (altPressed) {
      // Alt+框选: 减选模式
      editorStore.deselectItems(selectedIds)
    } else {
      // 普通框选/Shift+框选: 替换/增选模式
      editorStore.updateSelection(selectedIds, shiftPressed)
    }
  }

  // 执行拖拽完成逻辑（被 handleMouseUp 和 finishDrag 复用）
  function _executeDragCompletion(dx: number, dy: number, worldPos: { x: number; y: number }) {
    if (dragStartAltPressed.value) {
      // Alt + 拖拽 = 复制到目标位置
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
      // 使用统一的响应式输入状态
      const shiftPressed = isShiftPressed.value
      const altPressed = isAltPressed.value

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
      if (!isShiftPressed.value) {
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
      // 注意：isMiddleMousePressed 现在由全局状态管理，这里只需要设置辅助状态
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
      dragStartAltPressed.value = isAltPressed.value // 记录 Alt 状态
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
    if (isMiddleMousePressed.value && lastPointerPos.value) {
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

    // 持续更新最后已知的世界坐标位置
    lastKnownWorldPos.value = { x: worldPos.x, y: worldPos.y }

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

    // 检测鼠标右键释放，不处理
    if (evt.button === 2) {
      return
    }

    // 检测鼠标中键释放
    if (evt.button === 1) {
      // 注意：isMiddleMousePressed 现在由全局状态管理
      // 这里只需要清理辅助状态（全局 watch 会处理状态清理）
      cleanupMiddleMouseDrag()
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

          // 使用提取的辅助函数
          _executeDragCompletion(dx, dy, worldPos)
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
        // 使用提取的辅助函数
        _executeBoxSelection(rect)
      }
    }

    // 清除框选状态
    cleanupSelectionState()
  }

  // ==================== 画布外松开按键的处理 ====================

  // 完成框选操作（用于画布外松开按键）
  function finishSelection() {
    if (!isSelecting.value || !selectionRect.value) {
      cleanupSelectionState()
      return
    }

    const rect = selectionRect.value

    // 使用矩形尺寸判断是否真正拖拽了（避免小抖动被当作框选）
    const moveDistance = Math.hypot(rect.width, rect.height)

    if (moveDistance < 3) {
      // 小于阈值，不执行框选，只清理状态
      cleanupSelectionState()
      return
    }

    // 使用提取的辅助函数
    _executeBoxSelection(rect)

    cleanupSelectionState()
  }

  // 完成拖拽操作（用于画布外松开按键）
  function finishDrag() {
    if (!isDraggingItem.value) return

    // 如果真正拖拽了，执行移动/复制
    if (hasActuallyDragged.value && mouseDownScreenPos.value && lastKnownWorldPos.value) {
      const stage = stageRef.value?.getStage()
      if (stage) {
        const startWorldPos = {
          x: (mouseDownScreenPos.value.x - stage.x()) / stage.scaleX(),
          y: (mouseDownScreenPos.value.y - stage.y()) / stage.scaleY(),
        }
        const dx = lastKnownWorldPos.value.x - startWorldPos.x
        const dy = lastKnownWorldPos.value.y - startWorldPos.y

        // 使用提取的辅助函数
        _executeDragCompletion(dx, dy, lastKnownWorldPos.value)
      }
    }

    // 清理拖拽状态
    isDraggingItem.value = false
    draggedItem.value = null
    dragStartAltPressed.value = false
    hasActuallyDragged.value = false
    mouseDownScreenPos.value = null
    lastKnownWorldPos.value = null
  }

  // 监听左键释放（在画布外也能捕获）
  watch(isLeftMousePressed, (pressed) => {
    if (!pressed) {
      // 优先处理拖拽，因为拖拽优先级高于框选
      if (isDraggingItem.value) {
        finishDrag()
      } else if (isSelecting.value) {
        finishSelection()
      }
    }
  })

  // 监听中键释放（在画布外也能捕获）
  watch(isMiddleMousePressed, (pressed) => {
    if (!pressed) {
      cleanupMiddleMouseDrag()
    }
  })

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

import { computed, onUnmounted, ref, type Ref } from 'vue'

export type PointerRoute = 'none' | 'selection' | 'navigation'

interface PointerRouteState {
  pointerId: number | null
  pointerType: string | null
  route: PointerRoute
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
}

interface UseThreePointerRouterOptions {
  controlMode: Ref<'orbit' | 'flight'>
  isTransformDragging: Ref<boolean>
  isPointerOverGizmo: Ref<boolean>
  isSelectionDisabled: Ref<boolean>
  isPointerOnGizmoAxis: () => boolean
  handleSelectionPointerDown: (evt: PointerEvent) => void
  handleSelectionPointerMove: (evt: PointerEvent) => void
  handleSelectionPointerUp: (evt: PointerEvent) => void
  cancelSelectionSession: () => void
  handleNavPointerDown: (evt: PointerEvent) => void
  handleNavPointerMove: (evt: PointerEvent) => void
  handleNavPointerUp: (evt: PointerEvent) => void
  handleFlightPinch: (deltaDistance: number) => void
  handlePointerMoveWithTooltip: (evt: PointerEvent) => void
  hideTooltip: () => void
}

const TOUCH_LONG_PRESS_MS = 380
const TOUCH_LONG_PRESS_SLOP = 5
const TOUCH_CONTEXTMENU_SUPPRESS_MS = 320
const DRAG_THRESHOLD = 5 // px

export function useThreePointerRouter(options: UseThreePointerRouterOptions) {
  const activePointerRoute = ref<PointerRouteState>({
    pointerId: null,
    pointerType: null,
    route: 'none',
  })

  // 框选会话期间临时禁用 OrbitControls。
  // 触摸设备下保持启用，确保第一指能被 OrbitControls 跟踪，
  // 否则第二指加入时无法正确进入双指缩放（DOLLY_PAN）。
  const orbitControlsEnabled = computed(() => {
    const session = activePointerRoute.value
    if (session.route === 'selection' && session.pointerType !== 'touch') {
      return false
    }
    return true
  })

  const contextMenuState = ref<ContextMenuState>({ open: false, x: 0, y: 0 })

  const activeTouchPointerIds = ref(new Set<number>())
  const activeTouchPointerPositions = ref(new Map<number, { x: number; y: number }>())
  const isMultiTouchActive = computed(() => activeTouchPointerIds.value.size >= 2)

  const ignoreNextNativeContextMenu = ref(false)
  const suppressTouchContextMenuUntil = ref(0)

  const touchLongPressState = ref<{
    pointerId: number | null
    startX: number
    startY: number
    triggered: boolean
    timer: ReturnType<typeof setTimeout> | null
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    triggered: false,
    timer: null,
  })

  const rightClickState = ref<{
    startX: number
    startY: number
    wasDragged: boolean
  } | null>(null)

  function suppressTouchContextMenu(durationMs = TOUCH_CONTEXTMENU_SUPPRESS_MS) {
    suppressTouchContextMenuUntil.value = Math.max(
      suppressTouchContextMenuUntil.value,
      Date.now() + durationMs
    )
  }

  function isTouchContextMenuSuppressed() {
    return Date.now() <= suppressTouchContextMenuUntil.value
  }

  function clearTouchLongPressTimer() {
    const timer = touchLongPressState.value.timer
    if (timer !== null) {
      clearTimeout(timer)
      touchLongPressState.value.timer = null
    }
  }

  function stopTouchLongPressGuard(pointerId?: number) {
    if (pointerId !== undefined && touchLongPressState.value.pointerId !== pointerId) {
      return
    }

    clearTouchLongPressTimer()
    touchLongPressState.value.pointerId = null
    touchLongPressState.value.startX = 0
    touchLongPressState.value.startY = 0
    touchLongPressState.value.triggered = false
  }

  function isTouchLongPressTriggered(pointerId: number) {
    const state = touchLongPressState.value
    return state.pointerId === pointerId && state.triggered
  }

  function startPointerRoute(evt: PointerEvent, route: PointerRoute) {
    activePointerRoute.value = {
      pointerId: evt.pointerId,
      pointerType: evt.pointerType,
      route,
    }
  }

  function clearPointerRoute(pointerId?: number) {
    if (pointerId !== undefined && activePointerRoute.value.pointerId !== pointerId) {
      return
    }

    activePointerRoute.value = {
      pointerId: null,
      pointerType: null,
      route: 'none',
    }
  }

  function beginTouchLongPressGuard(evt: PointerEvent) {
    if (evt.pointerType !== 'touch' || evt.button !== 0) return

    stopTouchLongPressGuard()
    ignoreNextNativeContextMenu.value = false
    touchLongPressState.value.pointerId = evt.pointerId
    touchLongPressState.value.startX = evt.clientX
    touchLongPressState.value.startY = evt.clientY
    touchLongPressState.value.triggered = false
    touchLongPressState.value.timer = setTimeout(() => {
      const state = touchLongPressState.value
      if (state.pointerId !== evt.pointerId) return

      state.timer = null
      state.triggered = true

      const session = activePointerRoute.value
      if (session.route === 'selection' && session.pointerId === evt.pointerId) {
        options.cancelSelectionSession()
        clearPointerRoute(evt.pointerId)
        options.hideTooltip()
        options.isPointerOverGizmo.value = false
      } else if (session.route === 'navigation' && session.pointerId === evt.pointerId) {
        options.handleNavPointerUp(evt)
        clearPointerRoute(evt.pointerId)
        options.hideTooltip()
        options.isPointerOverGizmo.value = false
      }

      if (options.isTransformDragging.value || options.isPointerOverGizmo.value) {
        suppressTouchContextMenu()
        ignoreNextNativeContextMenu.value = true
        return
      }

      // 主动打开触摸长按菜单，避免依赖浏览器较慢的原生 contextmenu 时机
      contextMenuState.value = {
        open: true,
        x: state.startX,
        y: state.startY,
      }
      ignoreNextNativeContextMenu.value = true
    }, TOUCH_LONG_PRESS_MS)
  }

  function updateTouchLongPressGuard(evt: PointerEvent) {
    if (evt.pointerType !== 'touch') return

    const state = touchLongPressState.value
    if (state.pointerId !== evt.pointerId || state.triggered) return

    const dx = evt.clientX - state.startX
    const dy = evt.clientY - state.startY
    if (Math.hypot(dx, dy) > TOUCH_LONG_PRESS_SLOP) {
      clearTouchLongPressTimer()
    }
  }

  function registerTouchPointer(evt: PointerEvent) {
    if (evt.pointerType !== 'touch') return
    activeTouchPointerIds.value.add(evt.pointerId)
    activeTouchPointerPositions.value.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
  }

  function unregisterTouchPointer(evt: PointerEvent) {
    if (evt.pointerType !== 'touch') return
    activeTouchPointerIds.value.delete(evt.pointerId)
    activeTouchPointerPositions.value.delete(evt.pointerId)
  }

  function clearTouchPointers() {
    activeTouchPointerIds.value.clear()
    activeTouchPointerPositions.value.clear()
    stopTouchLongPressGuard()
  }

  function updateTouchPointerPosition(evt: PointerEvent) {
    if (evt.pointerType !== 'touch') return
    activeTouchPointerPositions.value.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
  }

  function getFlightPinchDelta(evt: PointerEvent): number | null {
    if (evt.pointerType !== 'touch') return null
    if (options.controlMode.value !== 'flight') return null
    if (activeTouchPointerIds.value.size < 2) return null

    const prevCurrent = activeTouchPointerPositions.value.get(evt.pointerId)
    if (!prevCurrent) return null

    const activeIds = Array.from(activeTouchPointerIds.value)
    const otherPointerId = activeIds.find((id) => id !== evt.pointerId)
    if (otherPointerId === undefined) return null

    const otherPos = activeTouchPointerPositions.value.get(otherPointerId)
    if (!otherPos) return null

    const prevDistance = Math.hypot(prevCurrent.x - otherPos.x, prevCurrent.y - otherPos.y)
    const nextCurrent = { x: evt.clientX, y: evt.clientY }
    const nextDistance = Math.hypot(nextCurrent.x - otherPos.x, nextCurrent.y - otherPos.y)

    activeTouchPointerPositions.value.set(evt.pointerId, nextCurrent)
    return nextDistance - prevDistance
  }

  function shouldSuppressNativeTouchLongPress() {
    // 触摸下只在 Gizmo 相关场景提前阻断原生长按，减少副作用。
    return (
      options.isTransformDragging.value ||
      options.isPointerOverGizmo.value ||
      options.isPointerOnGizmoAxis()
    )
  }

  function shouldStartSelectionRoute(evt: PointerEvent): boolean {
    if (evt.button !== 0) return false
    if (evt.pointerType === 'touch' && activeTouchPointerIds.value.size > 1) return false
    if (options.isSelectionDisabled.value) return false
    if (options.isTransformDragging.value) return false

    // 避免点击 Gizmo 时误进入框选会话
    if (options.isPointerOverGizmo.value || options.isPointerOnGizmoAxis()) return false

    return true
  }

  function shouldUseManualPointerCapture(evt: PointerEvent): boolean {
    // 触摸设备下让 OrbitControls / TransformControls 自己管理 pointer，
    // 避免与手势识别发生冲突导致状态错乱。
    return evt.pointerType !== 'touch'
  }

  function captureContainerPointer(evt: PointerEvent) {
    if (!shouldUseManualPointerCapture(evt)) return

    const el = evt.currentTarget as HTMLElement | null
    if (!el) return

    try {
      el.setPointerCapture(evt.pointerId)
    } catch {
      // 某些浏览器/时序下可能捕获失败，忽略即可
    }
  }

  function releaseContainerPointer(evt: PointerEvent) {
    if (!shouldUseManualPointerCapture(evt)) return

    const el = evt.currentTarget as HTMLElement | null
    if (!el) return

    try {
      if (el.hasPointerCapture(evt.pointerId)) {
        el.releasePointerCapture(evt.pointerId)
      }
    } catch {
      // 某些浏览器在 pointer cancel 后会抛错，忽略即可
    }
  }

  function handleContainerTouchStartCapture(evt: TouchEvent) {
    if (evt.touches.length !== 1) return
    if (!shouldSuppressNativeTouchLongPress()) return

    // 尽早阻断系统长按手势，避免出现“菜单被抑制但仍震动”。
    evt.preventDefault()
    suppressTouchContextMenu(TOUCH_LONG_PRESS_MS + TOUCH_CONTEXTMENU_SUPPRESS_MS)
  }

  function handleContainerPointerDownCapture(evt: PointerEvent) {
    if (evt.pointerType !== 'touch' || evt.button !== 0) return
    if (!shouldSuppressNativeTouchLongPress()) return

    // 某些浏览器仅在 Pointer 流程中识别长按，这里再做一次兜底阻断。
    evt.preventDefault()
    suppressTouchContextMenu(TOUCH_LONG_PRESS_MS + TOUCH_CONTEXTMENU_SUPPRESS_MS)
  }

  function handleGizmoTouchPreempt(event?: any) {
    const sourceEvent = event?.sourceEvent || event
    if (
      sourceEvent &&
      sourceEvent.pointerType === 'touch' &&
      typeof sourceEvent.preventDefault === 'function' &&
      sourceEvent.cancelable !== false
    ) {
      // 仅在 Gizmo 触控按下时前置阻断原生长按，保留普通长按触觉反馈。
      sourceEvent.preventDefault()
      suppressTouchContextMenu(TOUCH_LONG_PRESS_MS + TOUCH_CONTEXTMENU_SUPPRESS_MS)
      ignoreNextNativeContextMenu.value = true
    }
  }

  // 容器级指针事件：先交给导航，再交给选择/tooltip
  function handleContainerPointerDown(evt: PointerEvent) {
    // 鼠标场景下捕获指针，确保移出画布后仍能响应事件
    captureContainerPointer(evt)
    registerTouchPointer(evt)
    if (evt.pointerType === 'touch') {
      stopTouchLongPressGuard(evt.pointerId)
    }

    // 如果右键菜单已打开，点击画布任意位置先关闭菜单
    if (contextMenuState.value.open) {
      contextMenuState.value.open = false
    }

    // 右键处理：始终初始化拖拽检测，以支持右键菜单
    if (evt.button === 2) {
      rightClickState.value = {
        startX: evt.clientX,
        startY: evt.clientY,
        wasDragged: false,
      }
      // 注意：不在这里 preventDefault，而是在 contextmenu 事件统一阻止浏览器右键菜单
    }

    const session = activePointerRoute.value

    // 触摸交互：双指出现时强制切换到导航，避免框选与相机手势冲突
    if (evt.pointerType === 'touch' && isMultiTouchActive.value) {
      // 双指手势期间禁止触摸右键菜单，并取消任意已启动的长按候选
      suppressTouchContextMenu()
      stopTouchLongPressGuard()

      if (session.route === 'selection') {
        options.cancelSelectionSession()
        clearPointerRoute()
      }

      if (activePointerRoute.value.route !== 'navigation') {
        startPointerRoute(evt, 'navigation')
        options.handleNavPointerDown(evt)
      }

      options.hideTooltip()
      return
    }

    // 会话已存在时，忽略新的 pointerdown（避免双路并发）
    if (session.route !== 'none') {
      return
    }

    if (shouldStartSelectionRoute(evt)) {
      startPointerRoute(evt, 'selection')
      beginTouchLongPressGuard(evt)
      options.handleSelectionPointerDown(evt)
      options.hideTooltip()
      return
    }

    startPointerRoute(evt, 'navigation')
    if (evt.pointerType === 'touch' && !isMultiTouchActive.value) {
      beginTouchLongPressGuard(evt)
    }
    options.handleNavPointerDown(evt)
    options.hideTooltip()
  }

  function handleContainerPointerMove(evt: PointerEvent) {
    updateTouchLongPressGuard(evt)

    // 检测右键拖拽
    if (rightClickState.value && evt.buttons === 2) {
      const dx = evt.clientX - rightClickState.value.startX
      const dy = evt.clientY - rightClickState.value.startY
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        rightClickState.value.wasDragged = true
      }
    }

    const session = activePointerRoute.value
    if (session.route === 'selection') {
      // 仅由发起该会话的 pointer 驱动框选
      if (session.pointerId !== evt.pointerId) return
      updateTouchPointerPosition(evt)
      options.handleSelectionPointerMove(evt)
      options.hideTooltip()
      return
    }

    if (session.route === 'navigation') {
      // 触摸导航允许多个触点参与；鼠标/手写笔仅由发起 pointer 驱动
      if (session.pointerType !== 'touch' && session.pointerId !== evt.pointerId) return

      // Flight + 双指：将 pinch 映射为前进/后退，不触发 look 拖拽
      if (
        session.pointerType === 'touch' &&
        evt.pointerType === 'touch' &&
        options.controlMode.value === 'flight' &&
        activeTouchPointerIds.value.size >= 2
      ) {
        suppressTouchContextMenu()
        const pinchDelta = getFlightPinchDelta(evt)
        if (pinchDelta !== null) {
          options.handleFlightPinch(pinchDelta)
        }
        options.hideTooltip()
        return
      }

      updateTouchPointerPosition(evt)
      options.handleNavPointerMove(evt)
      options.hideTooltip()
      return
    }

    // 无会话时走 hover/预选路径
    updateTouchPointerPosition(evt)
    options.handlePointerMoveWithTooltip(evt)
  }

  function handleContainerPointerUp(evt: PointerEvent) {
    releaseContainerPointer(evt)
    unregisterTouchPointer(evt)
    const longPressTriggered = isTouchLongPressTriggered(evt.pointerId)
    stopTouchLongPressGuard(evt.pointerId)

    const session = activePointerRoute.value
    if (session.route === 'selection' && session.pointerId === evt.pointerId) {
      const isTouchSession = session.pointerType === 'touch' || evt.pointerType === 'touch'
      if (isTouchSession && longPressTriggered) {
        options.cancelSelectionSession()
        clearPointerRoute(evt.pointerId)
        return
      }

      // 无条件提交选择，避免因状态切换导致框选结束不生效
      options.handleSelectionPointerUp(evt)
      clearPointerRoute(evt.pointerId)
      return
    }

    if (session.route === 'navigation') {
      // 触摸导航会话：最后一个触点抬起时才结束
      if (session.pointerType === 'touch') {
        if (activeTouchPointerIds.value.size === 0) {
          options.handleNavPointerUp(evt)
          clearPointerRoute()
        }
        return
      }

      if (session.pointerId === evt.pointerId) {
        options.handleNavPointerUp(evt)
        clearPointerRoute(evt.pointerId)
      }
    }
  }

  function handleContainerPointerCancel(evt: PointerEvent) {
    releaseContainerPointer(evt)
    unregisterTouchPointer(evt)
    stopTouchLongPressGuard(evt.pointerId)
    const session = activePointerRoute.value

    if (session.route === 'selection' && session.pointerId === evt.pointerId) {
      const isTouchSession = session.pointerType === 'touch' || evt.pointerType === 'touch'
      if (isTouchSession) {
        options.cancelSelectionSession()
        clearPointerRoute(evt.pointerId)
        options.hideTooltip()
        options.isPointerOverGizmo.value = false
        return
      }

      options.handleSelectionPointerUp(evt)
      clearPointerRoute(evt.pointerId)
    } else if (session.route === 'navigation') {
      if (session.pointerType === 'touch') {
        if (activeTouchPointerIds.value.size === 0) {
          options.handleNavPointerUp(evt)
          clearPointerRoute()
        }
      } else if (session.pointerId === evt.pointerId) {
        options.handleNavPointerUp(evt)
        clearPointerRoute(evt.pointerId)
      }
    }
    options.hideTooltip()
    options.isPointerOverGizmo.value = false
  }

  function handleContainerPointerLeave() {
    options.hideTooltip()
    options.isPointerOverGizmo.value = false
  }

  // 处理原生 contextmenu 事件（参考 Blender：右键不改变选中状态）
  function handleNativeContextMenu(evt: MouseEvent) {
    evt.preventDefault()
    evt.stopPropagation()

    if (options.isTransformDragging.value || options.isPointerOverGizmo.value) {
      rightClickState.value = null
      return
    }

    // 触摸双指手势期间或刚结束时，抑制右键菜单误触发
    if (activeTouchPointerIds.value.size >= 2 || isTouchContextMenuSuppressed()) {
      rightClickState.value = null
      return
    }

    if (ignoreNextNativeContextMenu.value) {
      ignoreNextNativeContextMenu.value = false
      rightClickState.value = null
      return
    }

    // 如果发生了拖拽，不显示菜单
    if (rightClickState.value?.wasDragged) {
      rightClickState.value = null
      return
    }

    // 显示自定义菜单
    contextMenuState.value = {
      open: true,
      x: evt.clientX,
      y: evt.clientY,
    }

    rightClickState.value = null
  }

  onUnmounted(() => {
    clearTouchPointers()
    clearPointerRoute()
    clearTouchLongPressTimer()
  })

  return {
    orbitControlsEnabled,
    contextMenuState,
    handleContainerTouchStartCapture,
    handleContainerPointerDownCapture,
    handleContainerPointerDown,
    handleContainerPointerMove,
    handleContainerPointerUp,
    handleContainerPointerCancel,
    handleContainerPointerLeave,
    handleNativeContextMenu,
    handleGizmoTouchPreempt,
    clearTouchPointers,
    clearPointerRoute,
  }
}

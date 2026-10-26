import { computed, onScopeDispose, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 240
const MAX_WIDTH = 560
const CANVAS_MARGINS = 32

/** 只调整组浮层，不改变画布布局或其他面板。 */
export function useGroupPanelResize() {
  const settingsStore = useSettingsStore()
  const uiStore = useUIStore()
  const draftWidth = ref<number | null>(null)
  const isResizing = ref(false)
  const maxWidth = computed(() => {
    const containerWidth = uiStore.editorContainerRect.width
    return containerWidth > 0
      ? Math.max(0, Math.min(MAX_WIDTH, containerWidth - CANVAS_MARGINS))
      : MAX_WIDTH
  })
  const minWidth = computed(() => Math.min(MIN_WIDTH, maxWidth.value))
  function clampWidth(value: number) {
    return Math.min(maxWidth.value, Math.max(minWidth.value, value))
  }
  // 容器限宽只影响显示，不覆盖用户保存的偏好。
  const width = computed(() => {
    const preferred = settingsStore.settings.groupPanelWidth
    return clampWidth(draftWidth.value ?? (Number.isFinite(preferred) ? preferred : DEFAULT_WIDTH))
  })
  const panelStyle = computed(() => ({ width: `${width.value}px` }))

  let session: {
    pointerId: number
    startX: number
    startWidth: number
    target: HTMLElement
    cursor: string
    userSelect: string
  } | null = null

  function cancelResize() {
    const current = session
    session = null
    draftWidth.value = null
    isResizing.value = false
    if (!current) return
    const { target, pointerId } = current
    target.ownerDocument.defaultView?.removeEventListener('blur', cancelResize)
    target.ownerDocument.body.style.cursor = current.cursor
    target.ownerDocument.body.style.userSelect = current.userSelect
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0 || session || !uiStore.groupPanelOpen) return
    const target = event.currentTarget as HTMLElement
    event.preventDefault()
    target.setPointerCapture(event.pointerId)
    target.focus({ preventScroll: true })
    const style = target.ownerDocument.body.style
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width.value,
      target,
      cursor: style.cursor,
      userSelect: style.userSelect,
    }
    style.cursor = 'ew-resize'
    style.userSelect = 'none'
    isResizing.value = true
    target.ownerDocument.defaultView?.addEventListener('blur', cancelResize)
  }

  function resize(event: PointerEvent) {
    if (!session || event.pointerId !== session.pointerId) return
    // 单击边缘不应把受窗口限制的显示宽度保存成偏好。
    if (event.clientX === session.startX && draftWidth.value === null) return
    draftWidth.value = clampWidth(session.startWidth + event.clientX - session.startX)
  }

  function finishResize(event: PointerEvent) {
    if (!session || event.pointerId !== session.pointerId) return
    resize(event)
    if (draftWidth.value !== null) settingsStore.settings.groupPanelWidth = width.value
    cancelResize()
  }

  function cancelPointerResize(event: PointerEvent) {
    if (session?.pointerId === event.pointerId) cancelResize()
  }

  function resetWidth() {
    cancelResize()
    settingsStore.settings.groupPanelWidth = DEFAULT_WIDTH
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && session) {
      event.preventDefault()
      event.stopPropagation()
      cancelResize()
      return
    }
    const step = event.shiftKey ? 50 : 10
    const widths: Record<string, number> = {
      ArrowLeft: width.value - step,
      ArrowRight: width.value + step,
      Home: minWidth.value,
      End: maxWidth.value,
      Enter: DEFAULT_WIDTH,
    }
    const nextWidth = widths[event.key]
    if (nextWidth === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') resetWidth()
    else {
      cancelResize()
      settingsStore.settings.groupPanelWidth = clampWidth(nextWidth)
    }
  }

  watch(
    () => uiStore.groupPanelOpen,
    (open) => {
      if (!open) cancelResize()
    },
    { flush: 'sync' }
  )
  onScopeDispose(cancelResize)

  return {
    width,
    minWidth,
    maxWidth,
    panelStyle,
    isResizing,
    startResize,
    resize,
    finishResize,
    cancelPointerResize,
    resetWidth,
    resizeWithKeyboard,
  }
}

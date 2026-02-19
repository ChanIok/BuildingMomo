<script setup lang="ts">
import { ref, computed, markRaw, onActivated, onDeactivated, onMounted, toRef, watch } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls, Grid } from '@tresjs/cientos'
import {
  Object3D,
  MOUSE,
  TOUCH,
  Raycaster,
  Vector2,
  Vector3,
  type WebGLRenderer,
  type Camera,
} from 'three'
import backgroundUrl from '@/assets/home.webp'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandStore } from '@/stores/commandStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useThreeSelection } from '@/composables/useThreeSelection'
import { useThreeTransformGizmo } from '@/composables/useThreeTransformGizmo'
import { useThreeInstancedRenderer } from '@/composables/renderer'
import { useThreeTooltip } from '@/composables/useThreeTooltip'
import { useThreeCamera, type ViewPreset } from '@/composables/useThreeCamera'
import { useThreeGrid } from '@/composables/useThreeGrid'
import { useThreeBackground } from '@/composables/useThreeBackground'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { useCameraInputConfig } from '@/composables/useCameraInputConfig'
import { useThreeEnvironment } from '@/composables/useThreeEnvironment'
import { setSceneInvalidate, invalidateScene } from '@/composables/useSceneInvalidate'
import { useNearbyObjectsCheck } from '@/composables/useNearbyObjectsCheck'
import {
  useMagicKeys,
  useElementSize,
  useResizeObserver,
  useMediaQuery,
  watchOnce,
} from '@vueuse/core'
import ThreeEditorOverlays from './ThreeEditorOverlays.vue'

// 设置 Three.js 全局 Z 轴向上
Object3D.DEFAULT_UP.set(0, 0, 1)

const editorStore = useEditorStore()
const commandStore = useCommandStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()

// 相机输入配置（统一管理）
const cameraInput = useCameraInputConfig()
// IBL 环境光管理
const { setupEnvironment } = useThreeEnvironment()

// 开发环境标志
const isDev = import.meta.env.DEV

// 3D 选择 & gizmo 相关引用
const threeContainerRef = ref<HTMLElement | null>(null)
// 监听容器尺寸变化，用于更新正交相机视锥体
const { width: containerWidth, height: containerHeight } = useElementSize(threeContainerRef)

// 监听容器 Rect 变化并同步到 UI Store，供其他 Composable 使用（性能优化）
useResizeObserver(threeContainerRef, (entries) => {
  const entry = entries[0]
  if (entry && entry.target) {
    const rect = entry.target.getBoundingClientRect()
    uiStore.updateEditorContainerRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }
})

const cameraRef = ref<any | null>(null) // 透视相机
const orthoCameraRef = ref<any | null>(null) // 正交相机
const orbitControlsRef = ref<any | null>(null)
const transformRef = ref()
const axesRef = ref()
const gizmoPivot = ref<Object3D | null>(markRaw(new Object3D()))

// Gizmo 尺寸：粗指针（触屏）时放大，便于移动端操作
const isCoarsePointer = useMediaQuery('(pointer: coarse)')
const gizmoSize = computed(() => (isCoarsePointer.value ? 1.8 : 1))

// 背景图管理（使用新的 composable）
const {
  backgroundTexture,
  backgroundSize,
  backgroundPosition,
  mapCenter,
  shouldShowBackground,
  isMapDepthDisabled,
} = useThreeBackground(backgroundUrl, {
  scale: 11.2,
  offset: [-20000, -28000],
})

// 动态计算地图材质颜色（暗色模式下保留90%亮度）
const mapColor = computed(() => {
  const theme = settingsStore.settings.theme
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return isDark ? 0xd9d9d9 : 0xffffff
})

// 动态计算网格线颜色
const gridColor = computed(() => {
  const theme = settingsStore.settings.theme
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return isDark ? '#a3a3a3' : '#cccccc'
})

// 动态计算背景颜色
const canvasClearColor = computed(() => {
  const theme = settingsStore.settings.theme
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return isDark ? '#1F1F1F' : '#FFFFFF'
})

// 监听按键状态（Ctrl/Cmd 用于临时关闭吸附，与 PS/Figma 一致）
const { Ctrl, Meta } = useMagicKeys()
const isCtrlPressed = computed(() => Ctrl?.value ?? false)
const snapTemporarilyDisabled = computed(() => (Ctrl?.value ?? false) || (Meta?.value ?? false))
const effectiveTranslationSnap = computed(() =>
  snapTemporarilyDisabled.value ? undefined : settingsStore.settings.translationSnap || undefined
)
const effectiveRotationSnap = computed(() =>
  snapTemporarilyDisabled.value ? undefined : settingsStore.settings.rotationSnap || undefined
)

// 创建共享的 isTransformDragging ref
const isTransformDragging = ref(false)

// Gizmo hover 状态（用于在 Gizmo 上时屏蔽物品 hover 拾取）
const isPointerOverGizmo = ref(false)

// 从 UI Store 获取当前视图预设
const currentViewPreset = computed(() => uiStore.currentViewPreset)

// Orbit 模式下的中心点：用于中键绕场景/选中物品旋转
const orbitTarget = ref<[number, number, number]>([0, 0, 0])

// 监听 OrbitControls 挂载，确保初始化时 target 同步
watchOnce(orbitControlsRef, (ref) => {
  if (!ref) return

  // 等待下一帧，确保 OrbitControls 完全初始化
  requestAnimationFrame(() => {
    orbitTarget.value = [...cameraLookAt.value]
    const controls = ref.instance || ref.value
    controls?.target.set(...orbitTarget.value)
    controls?.update()
  })
})

// 相机导航（WASD/Q/Space）
const cameraOptions = computed(() => ({
  baseSpeed: settingsStore.settings.cameraBaseSpeed,
  shiftSpeedMultiplier: settingsStore.settings.cameraShiftMultiplier,
  mouseSensitivity: settingsStore.settings.cameraMouseSensitivity,
  pitchLimits: { min: -89, max: 89 },
  minHeight: -10000,
}))

const {
  cameraPosition,
  cameraLookAt,
  cameraUp,
  cameraZoom,
  controlMode,
  isOrthographic,
  isViewFocused,
  isNavKeyPressed,
  isCameraMoving,
  cameraDistance,
  handleNavPointerDown,
  handleNavPointerMove,
  handleNavPointerUp,
  handleFlightWheel,
  handleFlightPinch,
  setPoseFromLookAt,
  setZoom,
  toggleCameraMode,
  switchToViewPreset,
  fitCameraToScene,
  focusOnSelection,
} = useThreeCamera(cameraOptions, {
  isTransformDragging,
  // 从 flight 切回 orbit 时，更新 OrbitControls 的 target
  onOrbitTargetUpdate: (target) => {
    orbitTarget.value = target
  },
  defaultCenter: mapCenter,
})

// 计算 OrbitControls 的鼠标按钮映射
const orbitMouseButtons = computed(() => {
  // Alt+左键：启用相机控制（需要在设置中启用，且仅 Alt 按下）
  if (cameraInput.isAltCameraActive.value) {
    if (cameraInput.isOrthographic.value) {
      // 正交：Alt+左键平移
      return { LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }
    } else {
      // 透视：Alt+左键旋转
      return { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }
    }
  }

  // 如果在正交视图下按住空格键，左键临时用于平移
  if (cameraInput.isOrthographic.value && cameraInput.isSpacePressed.value) {
    return {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.ROTATE,
    }
  }

  // 如果是手形工具，左键用于平移（正交）或旋转（透视）
  if (cameraInput.currentTool.value === 'hand') {
    if (cameraInput.isOrthographic.value) {
      return {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.ROTATE, // 保持中键习惯
        RIGHT: MOUSE.ROTATE,
      }
    } else {
      return {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.PAN,
      }
    }
  }

  // 默认模式（选择工具）：左键留给框选，根据配置操作相机
  if (cameraInput.isOrthographic.value) {
    // 正交视图：始终使用平移
    return cameraInput.orbitRotateButton.value === 'right'
      ? { RIGHT: MOUSE.PAN }
      : { MIDDLE: MOUSE.PAN }
  } else {
    // 透视视图：根据配置使用旋转
    return cameraInput.orbitRotateButton.value === 'right'
      ? { RIGHT: MOUSE.ROTATE }
      : { MIDDLE: MOUSE.ROTATE }
  }
})

type PointerRoute = 'none' | 'selection' | 'navigation'

const activePointerRoute = ref<{
  pointerId: number | null
  pointerType: string | null
  route: PointerRoute
}>({
  pointerId: null,
  pointerType: null,
  route: 'none',
})

// 当前处于按下状态的触摸 pointer（用于识别单指/双指手势）
const activeTouchPointerIds = ref(new Set<number>())
const activeTouchPointerPositions = ref(new Map<number, { x: number; y: number }>())
const isMultiTouchActive = computed(() => activeTouchPointerIds.value.size >= 2)

const ORBIT_TOUCH_NONE = -1

// 框选会话期间临时禁用 OrbitControls。
// 触摸设备下需要保持启用，确保第一指能被 OrbitControls 跟踪，
// 否则第二指加入时无法正确进入双指缩放（DOLLY_PAN）。
const orbitControlsEnabled = computed(() => {
  const session = activePointerRoute.value
  if (session.route === 'selection' && session.pointerType !== 'touch') {
    return false
  }
  return true
})

// 旋转开关：保持桌面原逻辑，是否可旋转由视图类型决定
const orbitEnableRotate = computed(() => {
  return !isOrthographic.value
})

// 平移开关：仅正交视图允许平移；透视 Orbit 模式完全禁用平移
const orbitEnablePan = computed(() => {
  return isOrthographic.value
})

// 触摸手势：默认单指用于选择；双指用于缩放/平移；手形工具保留单指相机操作
const orbitTouches = computed(() => {
  if (cameraInput.currentTool.value === 'hand') {
    if (cameraInput.isOrthographic.value) {
      return { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }
    }
    return { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }
  }

  // 选择工具：
  // - 正交视图：双指缩放+平移
  // - 透视视图：双指缩放+旋转（禁用平移）
  if (cameraInput.isOrthographic.value) {
    return { ONE: ORBIT_TOUCH_NONE, TWO: TOUCH.DOLLY_PAN }
  }
  return { ONE: ORBIT_TOUCH_NONE, TWO: TOUCH.DOLLY_ROTATE }
})

// 当前活动的相机（根据视图类型动态切换）
const activeCameraRef = computed(() => {
  return isOrthographic.value ? orthoCameraRef.value : cameraRef.value
})

// 监听 FOV 变化并更新相机
watch(
  () => settingsStore.settings.cameraFov,
  (newFov) => {
    if (cameraRef.value && !isOrthographic.value) {
      const camera = cameraRef.value.instance || cameraRef.value.value
      if (camera && 'fov' in camera) {
        camera.fov = newFov
        camera.updateProjectionMatrix()
      }
    }
  }
)

// ============================================================
// 动态 near 平面：根据相机周边物体自动调整
// ============================================================

// 使用时间切片检测相机周围是否有物体（避免阻塞主线程）
const { hasNearbyObjects } = useNearbyObjectsCheck(cameraPosition, {
  threshold: 1000,
  throttleMs: 200,
})

// 动态 near 平面：有近处物体时用 10，无近处物体时用 100
const dynamicNear = computed(() => {
  return hasNearbyObjects.value ? 10 : 100
})

// 先初始化 renderer 获取 updateSelectedInstancesMatrix 和 pickingConfig
const {
  instancedMesh,
  iconInstancedMesh,
  simpleBoxInstancedMesh,
  modelMeshMap,
  modelFallbackMesh,
  updateSelectedInstancesMatrix,
  pickingConfig,
  setHoveredItemId,
  setupIconFacing,
  renderSelectionOutlineMaskPass,
  renderSelectionOutlineOverlay,
  syncOutlineSceneTransform,
} = useThreeInstancedRenderer(isTransformDragging)

// 自动管理 Icon facing（一次性调用）
setupIconFacing(cameraPosition, cameraLookAt, cameraUp, currentViewPreset)

// 当前 3D 显示模式（完全由用户设置决定）
const currentDisplayMode = computed(() => {
  return settingsStore.settings.threeDisplayMode
})

// 是否显示各种 mesh
const shouldShowBoxMesh = computed(() => currentDisplayMode.value === 'box')
const shouldShowIconMesh = computed(() => currentDisplayMode.value === 'icon')
const shouldShowSimpleBoxMesh = computed(() => currentDisplayMode.value === 'simple-box')
const shouldShowModelMesh = computed(() => currentDisplayMode.value === 'model')

// 然后初始化 gizmo，传入 updateSelectedInstancesMatrix
const {
  shouldShowGizmo,
  handleGizmoDragging,
  handleGizmoMouseDown,
  handleGizmoMouseUp,
  handleGizmoChange,
  transformSpace,
  setupGizmoAppearance,
} = useThreeTransformGizmo(
  gizmoPivot,
  updateSelectedInstancesMatrix,
  isTransformDragging,
  orbitControlsRef,
  activeCameraRef,
  transformRef
)

// 自动管理 Gizmo 外观：外观应用完成后精确触发一次重渲染
setupGizmoAppearance(transformRef, axesRef, () => {
  invalidateScene()
})

// 同步 maskScene 的 Y 轴翻转（因为主场景用了 scale=[1,-1,1]）
onMounted(() => {
  syncOutlineSceneTransform(-1)
})

// 从 TresCanvas ready 事件初始化
function handleTresReady(context: any) {
  console.log('[ThreeEditor] TresCanvas ready')

  // 配置渲染器
  const renderer = context.renderer?.instance
  const scene = context.scene?.value || context.scene

  if (renderer && scene) {
    // 1. 初始化 IBL 环境光 (为哑光材质提供关键的漫反射填充)
    // 参数 3：强度。觉得暗就调高 (例如 1.2, 1.5)，觉得亮就调低 (0.8)
    setupEnvironment(renderer, scene, 0.3)

    // 2. 色调映射
    renderer.toneMapping = 3
    renderer.toneMappingExposure = 0.8

    // 确保输出色彩空间正确
    renderer.outputColorSpace = 'srgb'
    renderer.shadowMap.enabled = true
  }

  // 连接按需渲染的 invalidate 函数
  if (context.renderer?.invalidate) {
    setSceneInvalidate(context.renderer.invalidate)
  }
}

// 相机模式切换包装函数（仅在透视模式下生效）
function handleToggleCameraMode() {
  // 只在透视模式下允许切换 orbit/flight
  if (!isOrthographic.value) {
    toggleCameraMode()
  }
}

// 渲染后回调（仅在 TresJS 实际渲染主场景后触发，on-demand 模式下空闲时不运行）
function handlePostRender(context: any) {
  if (currentDisplayMode.value !== 'model') return

  const renderer = context.renderer?.instance as WebGLRenderer | undefined
  const camera = activeCameraRef.value

  if (!renderer || !camera) return

  const size = renderer.getSize(new Vector2())

  // 1. 渲染 mask pass 到离屏 RT（主场景已由 TresJS 渲染完成）
  const hasMask = renderSelectionOutlineMaskPass(renderer, camera as Camera, size.x, size.y)

  // 2. 叠加 outline overlay 到主帧缓冲
  if (hasMask) {
    queueMicrotask(() => {
      renderSelectionOutlineOverlay(renderer)
    })
  }
}

const {
  selectionRect,
  lassoPoints,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  cancelSelectionSession,
} = useThreeSelection(activeCameraRef, { pickingConfig }, threeContainerRef, isTransformDragging)

// 3D Tooltip 系统（与 2D 复用同一开关）
const {
  tooltipVisible,
  tooltipData,
  handlePointerMove: handleTooltipPointerMove,
  hideTooltip,
} = useThreeTooltip(
  activeCameraRef,
  threeContainerRef,
  { pickingConfig },
  toRef(settingsStore.settings, 'showFurnitureTooltip'),
  isTransformDragging,
  setHoveredItemId,
  isCameraMoving
)

function handlePointerMoveWithTooltip(evt: PointerEvent) {
  // 触控下禁用 hover tooltip（触摸交互由 pointer route 管理）
  if (evt.pointerType === 'touch') {
    hideTooltip()
    return
  }

  // 如果应该禁用框选，跳过选择逻辑
  if (cameraInput.shouldDisableSelection.value) {
    hideTooltip()
    return
  }

  handlePointerMove(evt)
  // 3D 中没有拖动选框以外的拖拽逻辑，这里直接用 selectionRect 是否存在来判断是否在框选
  const isSelecting = !!selectionRect.value || lassoPoints.value.length > 0
  // 仅在 Gizmo 显示时，使用 TransformControls 自身的 axis 状态判断是否 hover 在 Gizmo 上
  if (shouldShowGizmo.value) {
    // TresJS 组件通常通过 .instance 或 .value 暴露底层 Three 对象，这里统一做一次兼容处理
    const controls: any =
      (transformRef.value && (transformRef.value.instance || transformRef.value.value)) ||
      transformRef.value

    // TransformControls 在 hover 某个轴/平面时会将 axis 设置为对应字符串；未 hover 时为 null
    isPointerOverGizmo.value = !!controls?.axis
  } else {
    isPointerOverGizmo.value = false
  }

  if (isPointerOverGizmo.value) {
    // 在 Gizmo 上时：隐藏 Tooltip，并保持物品 hover 为空（冻结）
    hideTooltip()
    return
  }

  handleTooltipPointerMove(evt, isSelecting)
}

// 处理容器滚轮事件
function handleContainerWheel(evt: WheelEvent) {
  // 飞行模式下：滚轮前进后退
  if (controlMode.value === 'flight') {
    evt.preventDefault()
    handleFlightWheel(evt.deltaY)
    return
  }

  // 仅在图标或简化方块模式下且按下 Ctrl 键时生效
  if ((shouldShowIconMesh.value || shouldShowSimpleBoxMesh.value) && evt.ctrlKey) {
    evt.preventDefault()
    evt.stopPropagation()

    // 计算新的缩放值
    const delta = evt.deltaY > 0 ? -0.1 : 0.1
    const current = settingsStore.settings.threeSymbolScale
    const next = Math.min(Math.max(current + delta, 0.1), 3.0)

    // 保留一位小数
    settingsStore.settings.threeSymbolScale = Number(next.toFixed(1))
  }
}

// 右键菜单状态
const contextMenuState = ref({ open: false, x: 0, y: 0 })
const TOUCH_LONG_PRESS_MS = 380
const TOUCH_LONG_PRESS_SLOP = 5
const TOUCH_CONTEXTMENU_SUPPRESS_MS = 320
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

// 右键拖拽检测状态
const rightClickState = ref<{
  startX: number
  startY: number
  wasDragged: boolean
} | null>(null)

const DRAG_THRESHOLD = 5 // px

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
      cancelSelectionSession()
      clearPointerRoute(evt.pointerId)
      hideTooltip()
      isPointerOverGizmo.value = false
    } else if (session.route === 'navigation' && session.pointerId === evt.pointerId) {
      handleNavPointerUp(evt)
      clearPointerRoute(evt.pointerId)
      hideTooltip()
      isPointerOverGizmo.value = false
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
  if (controlMode.value !== 'flight') return null
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

function isPointerOnGizmoAxis(): boolean {
  if (!shouldShowGizmo.value) return false

  const controls: any =
    (transformRef.value && (transformRef.value.instance || transformRef.value.value)) ||
    transformRef.value

  return !!controls?.axis
}

function shouldStartSelectionRoute(evt: PointerEvent): boolean {
  if (evt.button !== 0) return false
  if (evt.pointerType === 'touch' && activeTouchPointerIds.value.size > 1) return false
  if (cameraInput.shouldDisableSelection.value) return false
  if (isTransformDragging.value) return false

  // 避免点击 Gizmo 时误进入框选会话
  if (isPointerOverGizmo.value || isPointerOnGizmoAxis()) return false

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

// 容器级指针事件：先交给导航，再交给选择/tooltip
function handleContainerPointerDown(evt: PointerEvent) {
  // 鼠标场景下捕获指针，确保移出画布后仍能响应事件
  captureContainerPointer(evt)
  registerTouchPointer(evt)
  ignoreNextNativeContextMenu.value = false
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
      cancelSelectionSession()
      clearPointerRoute()
    }

    if (activePointerRoute.value.route !== 'navigation') {
      startPointerRoute(evt, 'navigation')
      handleNavPointerDown(evt)
    }

    hideTooltip()
    return
  }

  // 会话已存在时，忽略新的 pointerdown（避免双路并发）
  if (session.route !== 'none') {
    return
  }

  if (shouldStartSelectionRoute(evt)) {
    startPointerRoute(evt, 'selection')
    beginTouchLongPressGuard(evt)
    handlePointerDown(evt)
    hideTooltip()
    return
  }

  startPointerRoute(evt, 'navigation')
  if (evt.pointerType === 'touch' && !isMultiTouchActive.value) {
    beginTouchLongPressGuard(evt)
  }
  handleNavPointerDown(evt)
  hideTooltip()
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
    handlePointerMove(evt)
    hideTooltip()
    return
  }

  if (session.route === 'navigation') {
    // 触摸导航允许多个触点参与；鼠标/手写笔仅由发起 pointer 驱动
    if (session.pointerType !== 'touch' && session.pointerId !== evt.pointerId) return

    // Flight + 双指：将 pinch 映射为前进/后退，不触发 look 拖拽
    if (
      session.pointerType === 'touch' &&
      evt.pointerType === 'touch' &&
      controlMode.value === 'flight' &&
      activeTouchPointerIds.value.size >= 2
    ) {
      suppressTouchContextMenu()
      const pinchDelta = getFlightPinchDelta(evt)
      if (pinchDelta !== null) {
        handleFlightPinch(pinchDelta)
      }
      hideTooltip()
      return
    }

    updateTouchPointerPosition(evt)
    handleNavPointerMove(evt)
    hideTooltip()
    return
  }

  // 无会话时走 hover/预选路径
  updateTouchPointerPosition(evt)
  handlePointerMoveWithTooltip(evt)
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
      cancelSelectionSession()
      clearPointerRoute(evt.pointerId)
      return
    }

    // 无条件提交选择，避免因状态切换导致框选结束不生效
    handlePointerUp(evt)
    clearPointerRoute(evt.pointerId)
    return
  }

  if (session.route === 'navigation') {
    // 触摸导航会话：最后一个触点抬起时才结束
    if (session.pointerType === 'touch') {
      if (activeTouchPointerIds.value.size === 0) {
        handleNavPointerUp(evt)
        clearPointerRoute()
      }
      return
    }

    if (session.pointerId === evt.pointerId) {
      handleNavPointerUp(evt)
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
      cancelSelectionSession()
      clearPointerRoute(evt.pointerId)
      hideTooltip()
      isPointerOverGizmo.value = false
      return
    }

    handlePointerUp(evt)
    clearPointerRoute(evt.pointerId)
  } else if (session.route === 'navigation') {
    if (session.pointerType === 'touch') {
      if (activeTouchPointerIds.value.size === 0) {
        handleNavPointerUp(evt)
        clearPointerRoute()
      }
    } else if (session.pointerId === evt.pointerId) {
      handleNavPointerUp(evt)
      clearPointerRoute(evt.pointerId)
    }
  }
  hideTooltip()
  isPointerOverGizmo.value = false
}

function handleContainerPointerLeave() {
  hideTooltip()
  isPointerOverGizmo.value = false
}

// 处理原生 contextmenu 事件（参考 Blender：右键不改变选中状态）
function handleNativeContextMenu(evt: MouseEvent) {
  evt.preventDefault()
  evt.stopPropagation()

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

// OrbitControls 变更时，同步内部状态（仅在 orbit 模式下）
function handleOrbitChange() {
  if (controlMode.value !== 'orbit') return
  if (!activeCameraRef.value) return

  // 尝试获取 OrbitControls 的内部实例
  const controls = orbitControlsRef.value?.instance || orbitControlsRef.value?.value
  if (!controls) return

  const cam = activeCameraRef.value as any
  const pos = cam.position

  // 从控制器实例直接获取最新的 target
  const currentTarget = controls.target
  if (!currentTarget) return

  const targetArray: [number, number, number] = [currentTarget.x, currentTarget.y, currentTarget.z]

  // 记录当前的 Zoom
  if (cam.zoom !== undefined) {
    setZoom(cam.zoom)
  }

  // 同步相机姿态（位置和目标点）
  setPoseFromLookAt([pos.x, pos.y, pos.z], targetArray)
}

// 计算正交相机的视锥体参数
const orthoFrustum = computed(() => {
  const distance = cameraDistance.value
  // 使用距离作为视锥体大小的基准，留一些余量
  const size = distance * 0.93

  // 获取容器宽高比（默认 16:9，实际会由 TresCanvas 自动适配）
  const w = containerWidth.value
  const h = containerHeight.value
  const aspect = h > 0 ? w / h : 16 / 9

  return {
    left: (-size * aspect) / 2,
    right: (size * aspect) / 2,
    top: size / 2,
    bottom: -size / 2,
  }
})

// 网格控制逻辑
const { containerRotation, innerRotation, gridPosition } = useThreeGrid(backgroundPosition)

// 视图切换函数（供命令系统调用）
function switchToView(preset: ViewPreset) {
  switchToViewPreset(preset)
}

// 添加物品位置获取函数（屏幕中心射线检测）
const { getAddPositionFn } = useEditorItemAdd()

function getAddPosition(): [number, number, number] | null {
  const cameraComponent = activeCameraRef.value
  if (!cameraComponent) {
    // 兜底：使用视野中心，Z=0
    return [cameraLookAt.value[0], cameraLookAt.value[1], 0]
  }

  // 正确获取底层 Three.js 相机实例（TresJS 组件通过 .value 或 .instance 暴露）
  const camera = cameraComponent.value || cameraComponent.instance || cameraComponent
  if (!camera) {
    return [cameraLookAt.value[0], cameraLookAt.value[1], 0]
  }

  const raycaster = markRaw(new Raycaster())
  const ndc = markRaw(new Vector2(0, 0)) // 屏幕中心 NDC 坐标
  raycaster.setFromCamera(ndc, camera)

  // 根据当前显示模式检测不同的 mesh
  const mode = currentDisplayMode.value

  if (mode === 'model') {
    // Model 模式：检测所有 mesh，返回最近的交点
    let closestHit: { point: { x: number; y: number; z: number }; distance: number } | null = null

    for (const [, mesh] of modelMeshMap.value.entries()) {
      if (!mesh || mesh.count === 0) continue
      const intersects = raycaster.intersectObject(mesh, false)
      const hit = intersects[0]
      if (hit && hit.distance <= 3000 && (!closestHit || hit.distance < closestHit.distance)) {
        closestHit = {
          point: hit.point,
          distance: hit.distance,
        }
      }
    }

    if (closestHit) {
      // Three.js 坐标系 → 游戏坐标系（Y 取反）
      return [closestHit.point.x, -closestHit.point.y, closestHit.point.z]
    }
  } else {
    // Box/Icon/SimpleBox 模式：检测单个 mesh
    let targetMesh = null
    if (mode === 'icon') targetMesh = iconInstancedMesh.value
    else if (mode === 'simple-box') targetMesh = simpleBoxInstancedMesh.value
    else targetMesh = instancedMesh.value

    if (targetMesh && targetMesh.count > 0) {
      const intersects = raycaster.intersectObject(targetMesh, false)
      const hit = intersects[0]
      if (hit && hit.distance <= 3000) {
        // Three.js 坐标系 → 游戏坐标系（Y 取反）
        return [hit.point.x, -hit.point.y, hit.point.z]
      }
    }
  }

  // 没有命中任何物体：使用射线方向上固定距离的位置（支持空中摆放）
  const fixedDistance = 1000 // 固定距离
  const fallbackPoint = markRaw(new Vector3())
  fallbackPoint.copy(raycaster.ray.origin)
  fallbackPoint.addScaledVector(raycaster.ray.direction, fixedDistance)

  // Three.js 坐标系 → 游戏坐标系（Y 取反）
  return [fallbackPoint.x, -fallbackPoint.y, fallbackPoint.z]
}

// 当 3D 视图激活时，注册视图函数和位置获取函数
onActivated(() => {
  commandStore.setZoomFunctions(fitCameraToScene, focusOnSelection)
  commandStore.setViewPresetFunction(switchToView)
  commandStore.setToggleCameraModeFunction(handleToggleCameraMode)
  getAddPositionFn.value = getAddPosition
})

// 当 3D 视图停用时，清除函数
onDeactivated(() => {
  commandStore.setZoomFunctions(null, null)
  commandStore.setViewPresetFunction(null)
  commandStore.setToggleCameraModeFunction(null)
  getAddPositionFn.value = null
  clearTouchPointers()
  clearPointerRoute()
  isPointerOverGizmo.value = false
})
</script>

<template>
  <div class="absolute inset-0 bg-background">
    <!-- Three.js 场景 + 选择层 -->
    <div
      ref="threeContainerRef"
      class="absolute inset-0 touch-none overflow-hidden"
      @pointerdown="handleContainerPointerDown"
      @pointermove="handleContainerPointerMove"
      @pointerup="handleContainerPointerUp"
      @pointercancel="handleContainerPointerCancel"
      @pointerleave="handleContainerPointerLeave"
      @contextmenu="handleNativeContextMenu"
      @wheel="handleContainerWheel"
    >
      <TresCanvas
        render-mode="on-demand"
        :clear-color="canvasClearColor"
        @ready="handleTresReady"
        @render="handlePostRender"
      >
        <!-- 透视相机 - perspective 视图 -->
        <TresPerspectiveCamera
          v-if="!isOrthographic"
          ref="cameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :up="cameraUp"
          :zoom="cameraZoom"
          :fov="settingsStore.settings.cameraFov"
          :near="dynamicNear"
          :far="100000"
        />

        <!-- 正交相机 - 六个方向视图 -->
        <TresOrthographicCamera
          v-if="isOrthographic"
          ref="orthoCameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :up="cameraUp"
          :zoom="cameraZoom"
          :left="orthoFrustum.left"
          :right="orthoFrustum.right"
          :top="orthoFrustum.top"
          :bottom="orthoFrustum.bottom"
          :near="dynamicNear"
          :far="100000"
        />

        <!-- 轨道控制器：透视视图下使用中键旋转，正交视图下使用中键平移 -->
        <!-- 使用 v-if 而非 :enabled，确保 flight 模式下完全移除控制器，避免事件竞态 -->
        <OrbitControls
          v-if="controlMode === 'orbit'"
          ref="orbitControlsRef"
          :target="orbitTarget"
          :enabled="orbitControlsEnabled"
          :enableDamping="true"
          :dampingFactor="0.3"
          :enableRotate="orbitEnableRotate"
          :enablePan="orbitEnablePan"
          :enable-zoom="!isCtrlPressed"
          :zoomSpeed="settingsStore.settings.cameraZoomSpeed"
          :mouseButtons="orbitMouseButtons"
          :touches="orbitTouches"
          @change="handleOrbitChange"
        />

        <!-- 简约光照系统：IBL + 辅助光 -->

        <!-- 半球光：有了 IBL 后，这个可以作为微弱的补光 -->
        <TresHemisphereLight :sky-color="0xffffff" :ground-color="0x888888" :intensity="2" />

        <!-- 主光源：产生阴影 -->
        <TresDirectionalLight
          :position="[1500, 2000, 3000]"
          :intensity="2.0"
          :color="0xfff4e6"
          :cast-shadow="true"
          :shadow-mapSize-width="2048"
          :shadow-mapSize-height="2048"
          :shadow-camera-left="-3000"
          :shadow-camera-right="3000"
          :shadow-camera-top="3000"
          :shadow-camera-bottom="-3000"
          :shadow-bias="-0.0005"
        />

        <!-- 场景内容容器：Y轴翻转以实现左手坐标系视觉（Y轴朝南） -->
        <TresGroup :scale="[1, -1, 1]">
          <!-- 背景地图 -->
          <!-- 由于父级 Group 翻转了 Y 轴，这里再次翻转 Y 轴以保持地图图片方向正确（北朝上） -->
          <TresMesh
            v-if="backgroundTexture && shouldShowBackground"
            :position="backgroundPosition"
            :scale="[1, -1, 1]"
            :render-order="isMapDepthDisabled ? -1 : 0"
          >
            <TresPlaneGeometry :args="[backgroundSize.width, backgroundSize.height]" />
            <TresMeshBasicMaterial
              :map="backgroundTexture"
              :color="mapColor"
              :tone-mapped="false"
              :side="2"
              :depth-write="!isMapDepthDisabled"
            />
          </TresMesh>

          <TresAxesHelper ref="axesRef" :args="[5000]" />

          <!-- 原点标记 - 放大以适应大场景 -->
          <TresGroup :position="[0, 0, 0]">
            <TresMesh>
              <TresSphereGeometry :args="[200, 16, 16]" />
              <TresMeshBasicMaterial :color="0xef4444" />
            </TresMesh>
          </TresGroup>

          <!-- Instanced 渲染：按显示模式切换 -->
          <primitive v-if="shouldShowBoxMesh && instancedMesh" :object="instancedMesh" />
          <primitive v-if="shouldShowIconMesh && iconInstancedMesh" :object="iconInstancedMesh" />
          <primitive
            v-if="shouldShowSimpleBoxMesh && simpleBoxInstancedMesh"
            :object="simpleBoxInstancedMesh"
          />
          <!-- Model 模式：渲染所有模型 Mesh -->
          <template v-if="shouldShowModelMesh">
            <primitive v-for="[modelName, mesh] in modelMeshMap" :key="modelName" :object="mesh" />
            <!-- 渲染回退 Mesh（用于缺少模型数据的物品，count=0 时 GPU 不渲染） -->
            <primitive v-if="modelFallbackMesh" :object="modelFallbackMesh" />
          </template>
        </TresGroup>

        <!-- 辅助元素 - 适配大场景 - 移至世界空间 -->
        <TresGroup v-if="backgroundTexture" :position="gridPosition" :rotation="containerRotation">
          <TresGroup :rotation="innerRotation">
            <!-- Grid 组件 -->
            <Grid
              :args="[backgroundSize.width, backgroundSize.height]"
              :cell-size="1000"
              :section-size="1000"
              :cell-color="gridColor"
              :section-color="gridColor"
              :fade-distance="50000"
              :fade-strength="0.5"
              :infinite-grid="false"
            />
          </TresGroup>
        </TresGroup>

        <!-- 选中物品的 Transform Gizmo 的锚点 - 移至世界空间 -->
        <primitive v-if="shouldShowGizmo && gizmoPivot" :object="gizmoPivot" />

        <!-- TransformControls 放在世界空间 -->
        <TransformControls
          v-if="shouldShowGizmo && gizmoPivot"
          ref="transformRef"
          :object="gizmoPivot"
          :camera="activeCameraRef"
          :mode="editorStore.gizmoMode || 'translate'"
          :space="transformSpace"
          :size="gizmoSize"
          :translationSnap="effectiveTranslationSnap"
          :rotationSnap="effectiveRotationSnap"
          @dragging="handleGizmoDragging"
          @mouseDown="handleGizmoMouseDown"
          @mouseUp="handleGizmoMouseUp"
          @change="handleGizmoChange"
        />
      </TresCanvas>
    </div>

    <!-- 所有 UI 叠加层 (统一子组件) -->
    <ThreeEditorOverlays
      :context-menu="contextMenuState"
      :tooltip="{ visible: tooltipVisible, data: tooltipData }"
      :selection="{ rect: selectionRect, lasso: lassoPoints }"
      :view-info="{ isOrthographic, controlMode, currentViewPreset }"
      :camera-debug-data="
        isDev
          ? {
              cameraPosition,
              cameraLookAt,
              orbitTarget,
              controlMode,
              currentViewPreset,
              isOrthographic,
              isViewFocused,
              isNavKeyPressed,
              cameraZoom,
            }
          : null
      "
      :is-dev="isDev"
      :command-store="commandStore"
      @update:context-menu="(v) => (contextMenuState = v)"
    />
  </div>
</template>

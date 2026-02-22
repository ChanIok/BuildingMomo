<script setup lang="ts">
import { ref, computed, markRaw, onActivated, onDeactivated, onMounted, toRef, watch } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls, Grid } from '@tresjs/cientos'
import { Object3D, Raycaster, Vector2, Vector3, type WebGLRenderer, type Camera } from 'three'
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
import { useThreePointerRouter } from '@/composables/useThreePointerRouter'
import { useOrbitControlsInput } from '@/composables/useOrbitControlsInput'
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
let isWritingOrbitRuntimePose = false

function unwrapTresInstance<T>(raw: any): T | null {
  if (!raw) return null
  return (raw.instance || raw.value || raw) as T
}

function getOrbitControlsInstance() {
  return orbitControlsRef.value?.instance || orbitControlsRef.value?.value || null
}

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

const activeCameraComponentRef = computed(() => {
  return currentViewPreset.value !== 'perspective' ? orthoCameraRef.value : cameraRef.value
})

// 统一解包真实 Three 相机，避免组件 ref / instance 形态差异
const activeCameraRef = computed<Camera | null>(() => {
  return unwrapTresInstance<Camera>(activeCameraComponentRef.value)
})
const activeCameraForTransform = computed<Camera | undefined>(
  () => activeCameraRef.value ?? undefined
)

function readOrbitRuntimePose() {
  if (isWritingOrbitRuntimePose) return null
  const controls: any = getOrbitControlsInstance()
  const cam = (controls?.object as Camera | undefined) || activeCameraRef.value
  if (!controls?.target || !cam) return null

  return {
    position: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number],
    target: [controls.target.x, controls.target.y, controls.target.z] as [number, number, number],
    zoom: typeof (cam as any).zoom === 'number' ? (cam as any).zoom : undefined,
  }
}

function writeOrbitRuntimePose(pose: {
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  zoom?: number
}): boolean {
  const controls: any = getOrbitControlsInstance()
  if (!controls?.target) return false

  const cam = (controls.object as Camera | undefined) || activeCameraRef.value
  if (!cam) return false

  isWritingOrbitRuntimePose = true
  try {
    cam.position.set(...pose.position)
    cam.up.set(...pose.up)

    if (typeof pose.zoom === 'number' && typeof (cam as any).zoom === 'number') {
      ;(cam as any).zoom = pose.zoom
      if (typeof (cam as any).updateProjectionMatrix === 'function') {
        ;(cam as any).updateProjectionMatrix()
      }
    }

    controls.target.set(...pose.target)
    controls.update()
    return true
  } finally {
    isWritingOrbitRuntimePose = false
  }
}

// 监听 OrbitControls 挂载，确保初始化时 target 同步
watchOnce(orbitControlsRef, (ref) => {
  if (!ref) return

  // 等待下一帧，确保 OrbitControls 完全初始化
  requestAnimationFrame(() => {
    const controls: any = ref.instance || ref.value
    controls?.target.set(...cameraLookAt.value)
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
  toggleCameraMode,
  switchToViewPreset,
  fitCameraToScene,
  focusOnSelection,
} = useThreeCamera(cameraOptions, {
  isTransformDragging,
  readOrbitRuntimePose,
  writeOrbitRuntimePose,
  defaultCenter: mapCenter,
})

const { orbitMouseButtons, orbitEnableRotate, orbitEnablePan, orbitTouches } =
  useOrbitControlsInput(cameraInput, {
    isOrthographic,
    isCoarsePointer,
  })

// 监听 FOV 变化并更新相机
watch(
  () => settingsStore.settings.cameraFov,
  (newFov) => {
    if (cameraRef.value && !isOrthographic.value) {
      const camera = unwrapTresInstance<any>(cameraRef.value)
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
  handleGizmoMouseDown: handleGizmoMouseDownInternal,
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

function isPointerOnGizmoAxis(): boolean {
  if (!shouldShowGizmo.value) return false

  const controls: any =
    (transformRef.value && (transformRef.value.instance || transformRef.value.value)) ||
    transformRef.value

  return !!controls?.axis
}

const {
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
} = useThreePointerRouter({
  controlMode,
  isTransformDragging,
  isPointerOverGizmo,
  isSelectionDisabled: cameraInput.shouldDisableSelection,
  isPointerOnGizmoAxis,
  handleSelectionPointerDown: handlePointerDown,
  handleSelectionPointerMove: handlePointerMove,
  handleSelectionPointerUp: handlePointerUp,
  cancelSelectionSession,
  handleNavPointerDown,
  handleNavPointerMove,
  handleNavPointerUp,
  handleFlightPinch,
  handlePointerMoveWithTooltip,
  hideTooltip,
})

function handleGizmoMouseDown(event?: any) {
  handleGizmoTouchPreempt(event)
  handleGizmoMouseDownInternal(event)
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
  const camera = activeCameraRef.value
  if (!camera) {
    // 兜底：使用视野中心，Z=0
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
      @touchstart.capture="handleContainerTouchStartCapture"
      @pointerdown.capture="handleContainerPointerDownCapture"
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
          :target="cameraLookAt"
          :enabled="orbitControlsEnabled"
          :enableDamping="true"
          :dampingFactor="0.3"
          :enableRotate="orbitEnableRotate"
          :enablePan="orbitEnablePan"
          :enable-zoom="!isCtrlPressed"
          :zoomSpeed="settingsStore.settings.cameraZoomSpeed"
          :mouseButtons="orbitMouseButtons"
          :touches="orbitTouches"
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
          :camera="activeCameraForTransform"
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

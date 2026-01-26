<script setup lang="ts">
import { ref, computed, markRaw, onActivated, onDeactivated, onMounted, toRef, watch } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls, Grid } from '@tresjs/cientos'
import {
  Object3D,
  MOUSE,
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
import { useNearbyObjectsCheck } from '@/composables/useNearbyObjectsCheck'
import { useMagicKeys, useElementSize, useResizeObserver, watchOnce } from '@vueuse/core'
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

// 监听按键状态
const { Ctrl } = useMagicKeys()
const isCtrlPressed = computed(() => Ctrl?.value ?? false)

// 调试面板状态
const showCameraDebug = ref(false)

// 创建共享的 isTransformDragging ref
const isTransformDragging = ref(false)

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
  cameraDistance,
  handleNavPointerDown,
  handleNavPointerMove,
  handleNavPointerUp,
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

// 自动管理 Gizmo 外观（一次性调用）
setupGizmoAppearance(transformRef, axesRef)

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
}

// 相机模式切换包装函数（仅在透视模式下生效）
function handleToggleCameraMode() {
  // 只在透视模式下允许切换 orbit/flight
  if (!isOrthographic.value) {
    toggleCameraMode()
  }
}

// 渲染循环回调（每帧调用）
function handleLoop(context: any) {
  if (currentDisplayMode.value !== 'model') return

  // TresJS loop context: renderer.instance 已经是 WebGLRenderer 实例
  const renderer = context.renderer?.instance as WebGLRenderer | undefined
  const camera = activeCameraRef.value

  if (!renderer || !camera) return

  const size = renderer.getSize(new Vector2())

  // 1. 在 TresJS 渲染主场景之前，先渲染 mask pass
  const hasMask = renderSelectionOutlineMaskPass(renderer, camera as Camera, size.x, size.y)

  // 2. 让 TresJS 正常渲染主场景（自动发生）

  // 3. 在 TresJS 渲染完成后，叠加 overlay
  if (hasMask) {
    queueMicrotask(() => {
      renderSelectionOutlineOverlay(renderer)
    })
  }
}

const { selectionRect, lassoPoints, handlePointerDown, handlePointerMove, handlePointerUp } =
  useThreeSelection(activeCameraRef, { pickingConfig }, threeContainerRef, isTransformDragging)

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
  setHoveredItemId
)

function handlePointerMoveWithTooltip(evt: PointerEvent) {
  // 如果应该禁用框选，跳过选择逻辑
  if (cameraInput.shouldDisableSelection.value) {
    hideTooltip()
    return
  }

  handlePointerMove(evt)
  // 3D 中没有拖动选框以外的拖拽逻辑，这里直接用 selectionRect 是否存在来判断是否在框选
  const isSelecting = !!selectionRect.value || lassoPoints.value.length > 0
  handleTooltipPointerMove(evt, isSelecting)
}

// 处理容器滚轮事件（用于 Ctrl+滚轮 缩放图标/方块）
function handleContainerWheel(evt: WheelEvent) {
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

// 右键拖拽检测状态
const rightClickState = ref<{
  startX: number
  startY: number
  wasDragged: boolean
} | null>(null)

const DRAG_THRESHOLD = 5 // px

// 容器级指针事件：先交给导航，再交给选择/tooltip
function handleContainerPointerDown(evt: PointerEvent) {
  // 捕获指针，确保移出画布后仍能响应事件
  ;(evt.target as HTMLElement).setPointerCapture(evt.pointerId)

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

  handleNavPointerDown(evt)

  // 禁用框选的条件由 cameraInput.shouldDisableSelection 统一判断
  if (!cameraInput.shouldDisableSelection.value) {
    handlePointerDown(evt)
  }
}

function handleContainerPointerMove(evt: PointerEvent) {
  // 检测右键拖拽
  if (rightClickState.value && evt.buttons === 2) {
    const dx = evt.clientX - rightClickState.value.startX
    const dy = evt.clientY - rightClickState.value.startY
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      rightClickState.value.wasDragged = true
    }
  }

  handleNavPointerMove(evt)
  handlePointerMoveWithTooltip(evt)
}

function handleContainerPointerUp(evt: PointerEvent) {
  ;(evt.target as HTMLElement).releasePointerCapture(evt.pointerId)

  handleNavPointerUp(evt)

  if (!cameraInput.shouldDisableSelection.value) {
    handlePointerUp(evt)
  }
}

function handleContainerPointerLeave() {
  hideTooltip()
}

// 处理原生 contextmenu 事件（参考 Blender：右键不改变选中状态）
function handleNativeContextMenu(evt: MouseEvent) {
  evt.preventDefault()
  evt.stopPropagation()

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
})
</script>

<template>
  <div class="absolute inset-0 bg-background">
    <!-- Three.js 场景 + 选择层 -->
    <div
      ref="threeContainerRef"
      class="absolute inset-0 overflow-hidden"
      @pointerdown="handleContainerPointerDown"
      @pointermove="handleContainerPointerMove"
      @pointerup="handleContainerPointerUp"
      @pointerleave="handleContainerPointerLeave"
      @contextmenu="handleNativeContextMenu"
      @wheel="handleContainerWheel"
    >
      <TresCanvas :clear-color="canvasClearColor" @ready="handleTresReady" @loop="handleLoop">
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
          :enableDamping="true"
          :dampingFactor="0.3"
          :enableRotate="!isOrthographic"
          :enablePan="isOrthographic"
          :enable-zoom="!isCtrlPressed"
          :zoomSpeed="settingsStore.settings.cameraZoomSpeed"
          :mouseButtons="orbitMouseButtons"
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
          :translationSnap="settingsStore.settings.translationSnap || undefined"
          :rotationSnap="settingsStore.settings.rotationSnap || undefined"
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
      :debug="
        isDev
          ? {
              show: showCameraDebug,
              data: {
                cameraPosition,
                cameraLookAt,
                orbitTarget,
                controlMode,
                currentViewPreset,
                isOrthographic,
                isViewFocused,
                isNavKeyPressed,
                cameraZoom,
              },
            }
          : null
      "
      :is-dev="isDev"
      :command-store="commandStore"
      @update:context-menu="(v) => (contextMenuState = v)"
      @update:show-debug="(v) => (showCameraDebug = v)"
    />
  </div>
</template>

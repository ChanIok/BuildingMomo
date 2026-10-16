<script setup lang="ts">
import { installFurnitureRender } from '@/composables/useFurnitureRender'
import { homeOutputUniforms } from '@/composables/renderer/homeOutput'
import {
  ref,
  shallowRef,
  computed,
  markRaw,
  toRaw,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  toRef,
  watch,
} from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls } from '@tresjs/cientos'
import {
  Object3D,
  PCFShadowMap,
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
import { useLoadingStore } from '@/stores/loadingStore'
import { useUIStore } from '@/stores/uiStore'
import { useThreeSelection } from '@/composables/useThreeSelection'
import { useThreeTransformGizmo } from '@/composables/useThreeTransformGizmo'
import {
  useThreeInstancedRenderer,
  type InteractionAdapter,
  type RaycastHit,
} from '@/composables/renderer'
import { useSlidePathRenderer } from '@/composables/renderer/useSlidePathRenderer'
import { useThreeTooltip } from '@/composables/useThreeTooltip'
import { useThreeCamera, type ViewPreset } from '@/composables/useThreeCamera'
import { useThreeGrid } from '@/composables/useThreeGrid'
import { useThreeBackground } from '@/composables/useThreeBackground'
import { useHomeTerrain } from '@/composables/useHomeTerrain'
import { useI18n } from '@/composables/useI18n'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { useCameraInputConfig } from '@/composables/useCameraInputConfig'
import { createSceneEnvironment } from '@/composables/useThreeEnvironment'
import { createEnvironmentTransition } from '@/composables/renderer/environmentTransition'
import { useThreePointerRouter } from '@/composables/useThreePointerRouter'
import { useOrbitControlsInput } from '@/composables/useOrbitControlsInput'
import { setSceneInvalidate, invalidateScene } from '@/composables/useSceneInvalidate'
import { ORTHO_BASE_FRUSTUM_HEIGHT } from '@/lib/cameraUtils'
import { computeClipFarFromWorldBounds } from '@/lib/cameraClipRange'
import { getItemsWorldBoundsMetrics } from '@/lib/spatialBounds'
import {
  useMagicKeys,
  useElementSize,
  useResizeObserver,
  useMediaQuery,
  watchOnce,
} from '@vueuse/core'
import ThreeEditorOverlays from './ThreeEditorOverlays.vue'
import LogDepthGrid from '@/components/scene/LogDepthGrid.vue'
import { recordRenderFrame } from '@/composables/useFpsMonitor'

// 设置 Three.js 全局 Z 轴向上
Object3D.DEFAULT_UP.set(0, 0, 1)

const editorStore = useEditorStore()
const commandStore = useCommandStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()
const { t } = useI18n()

// 相机输入配置（统一管理）
const cameraInput = useCameraInputConfig()
let sceneEnvironment: ReturnType<typeof createSceneEnvironment> | null = null

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

// Tres 实例必须保留原始身份；深层代理会让 controls 的构造参数混入同一相机的 raw/proxy。
const cameraRef = shallowRef<any | null>(null) // 透视相机
const orthoCameraRef = shallowRef<any | null>(null) // 正交相机
const orbitControlsRef = shallowRef<any | null>(null)
const transformRef = shallowRef()
const axesRef = shallowRef()
const gizmoPivot = ref<Object3D | null>(markRaw(new Object3D()))
let isWritingOrbitRuntimePose = false

function unwrapTresInstance<T>(raw: any): T | null {
  if (!raw) return null
  return toRaw(raw.instance || raw.value || raw) as T
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
  backgroundTodMaterial,
  backgroundSize,
  backgroundPosition,
  backgroundRotation,
  mapCenter,
  shouldShowBackground,
  isMapDepthDisabled,
} = useThreeBackground(backgroundUrl, {
  // Similarity fit to the overview's money-tree terrace, pavilion and like-button centers.
  scale: 11.12,
  offset: [-19752.35, -27276.3],
  rotationZ: (0.25 * Math.PI) / 180,
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
const isWorldBuildScheme = computed(
  () => editorStore.activeScheme?.filePath.value?.startsWith('WORLDBUILD_') === true
)
const terrainEnabled = computed(
  () =>
    settingsStore.settings.homeTerrainEnabled &&
    settingsStore.settings.showBackground &&
    !isWorldBuildScheme.value
)
const {
  object: terrainObject,
  bounds: terrainBounds,
  error: terrainError,
} = useHomeTerrain(terrainEnabled)

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

// 对数深度缓冲下 near 无需随场景切换；固定较小值便于贴近视口编辑
const cameraNearPlane = 10

// 全场景合并 AABB → 动态远裁面（配合对数深度缓冲，避免大地图预览整屏被裁）
const sceneWorldBoundsMetrics = computed(() => {
  void editorStore.sceneVersion
  const items = editorStore.activeScheme?.items.value ?? []
  if (items.length === 0) return null
  return getItemsWorldBoundsMetrics(items)
})

const clipFar = computed(() => {
  let far = computeClipFarFromWorldBounds(cameraPosition.value, sceneWorldBoundsMetrics.value)
  if (terrainEnabled.value && terrainBounds.value) {
    const bounds = terrainBounds.value
    const [x, y, z] = cameraPosition.value
    far = Math.max(
      far,
      Math.hypot(
        Math.max(Math.abs(x - bounds.min.x), Math.abs(x - bounds.max.x)),
        Math.max(Math.abs(y - bounds.min.y), Math.abs(y - bounds.max.y)),
        Math.max(Math.abs(z - bounds.min.z), Math.abs(z - bounds.max.z))
      ) * 1.1
    )
  }
  return far
})

// 先初始化 renderer 获取 updateSelectedInstancesMatrix 和 interactionAdapter
const {
  instancedMesh,
  iconInstancedMesh,
  simpleBoxInstancedMesh,
  modelMeshMap,
  modelFallbackMesh,
  updateSelectedInstancesMatrix,
  interactionAdapter: standardInteractionAdapter,
  setHoveredItemId: setStandardHoveredItemId,
  setupIconFacing,
  renderSelectionOutlineMaskPass,
  renderSelectionOutlineOverlay,
  syncOutlineSceneTransform,
} = useThreeInstancedRenderer(isTransformDragging)

const {
  segmentMesh: slidePathSegmentMesh,
  pointMesh: slidePathPointMesh,
  interactionAdapter: slidePathInteractionAdapter,
  setHoveredHit: setSlidePathHoveredHit,
  updateItemWorldMatrices: updateSlidePathItemWorldMatrices,
  previewPoint: previewSlidePathPoint,
  clearPreview: clearSlidePathPreview,
} = useSlidePathRenderer()

// 合并标准 renderer 和飞花道 renderer 的交互适配器：raycast 取最近命中，框选合并两者候选集
const interactionAdapter = ref<InteractionAdapter>({
  pick: (raycaster) => {
    const sHit = slidePathInteractionAdapter.value.pick(raycaster)
    const nHit = standardInteractionAdapter.value.pick(raycaster)
    if (!sHit) return nHit
    if (!nHit) return sHit
    return sHit.distance <= nHit.distance ? sHit : nHit
  },
  pickAsync: async (raycaster) => {
    const [sHit, nHit] = await Promise.all([
      slidePathInteractionAdapter.value.pickAsync(raycaster),
      standardInteractionAdapter.value.pickAsync(raycaster),
    ])
    if (!sHit) return nHit
    if (!nHit) return sHit
    return sHit.distance <= nHit.distance ? sHit : nHit
  },
  cancelPick: () => {
    slidePathInteractionAdapter.value.cancelPick()
    standardInteractionAdapter.value.cancelPick()
  },
  forEachRegionCenterCandidate: (camera, viewport, visitor) => {
    standardInteractionAdapter.value.forEachRegionCenterCandidate(camera, viewport, visitor)
    slidePathInteractionAdapter.value.forEachRegionCenterCandidate(camera, viewport, visitor)
  },
})

// hover 路由：标准物品和飞花道分别处理，飞花道需要额外传 hit 信息以区分 segment/point
function setHoveredItemId(id: string | null, hit?: RaycastHit | null) {
  setStandardHoveredItemId(id)
  setSlidePathHoveredHit(
    hit && (hit.kind === 'slide-path-segment' || hit.kind === 'slide-path-point') ? hit : null
  )
}

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
  transformRef,
  {
    updateItemWorldMatrices: updateSlidePathItemWorldMatrices,
    previewPoint: previewSlidePathPoint,
    clearPreview: clearSlidePathPreview,
  }
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
let restoreRenderFunction: (() => void) | null = null
let furnitureContext: ReturnType<typeof installFurnitureRender> | null = null
let environmentTransition: ReturnType<typeof createEnvironmentTransition> | null = null
onUnmounted(() => {
  environmentTransition?.dispose()
  environmentTransition = null
  sceneEnvironment?.dispose()
  sceneEnvironment = null
  furnitureContext?.dispose()
  furnitureContext = null
  restoreRenderFunction?.()
  restoreRenderFunction = null
})

function handleTresReady(context: any) {
  environmentTransition?.dispose()
  environmentTransition = null
  sceneEnvironment?.dispose()
  sceneEnvironment = null
  furnitureContext?.dispose()
  furnitureContext = null
  console.log('[ThreeEditor] TresCanvas ready')

  // 配置渲染器
  const renderer = toRaw(context.renderer?.instance)
  const scene = toRaw(context.scene.value)

  if (renderer && scene) {
    // 2. 色调映射
    renderer.toneMapping = 3
    renderer.toneMappingExposure = 0.8

    // 确保输出色彩空间正确
    renderer.outputColorSpace = 'srgb'
    renderer.shadowMap.enabled = settingsStore.settings.shadowsEnabled
    // 按光源/投影物变化更新阴影；仅视角变化时复用静态阴影贴图
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    sceneEnvironment = createSceneEnvironment(renderer, scene, () => context.renderer.invalidate())
    sceneEnvironment.update(settingsStore.settings.lightingMode, settingsStore.settings.todMinute)
    furnitureContext = installFurnitureRender({
      renderer,
      scene,
      getCamera: () => toRaw(context.camera.activeCamera.value),
      invalidate: () => context.renderer.invalidate(),
      outputUniforms: homeOutputUniforms(renderer),
      lighting: () => {
        if (!sceneEnvironment) throw new Error('Furniture environment owner missing')
        return sceneEnvironment.materialLighting()
      },
    })
    const environment = sceneEnvironment
    const furniture = furnitureContext
    const loading = useLoadingStore()
    let session: number | undefined
    environmentTransition = createEnvironmentTransition({
      async apply() {
        await environment.prepare(
          settingsStore.settings.lightingMode,
          settingsStore.settings.todMinute
        )
        environment.setShadowsEnabled(settingsStore.settings.shadowsEnabled)
        environment.update(settingsStore.settings.lightingMode, settingsStore.settings.todMinute)
      },
      prepare(stale, progress) {
        environment.beforeRender()
        return furniture.prepareScene(stale, progress)
      },
      start() {
        session = loading.startLoading('environment', 1, 'staged', { showDelayMs: 150 })
      },
      progress(completed, total, phase = 'shaders') {
        if (loading.phase !== phase || loading.total !== Math.max(1, total))
          loading.setPhase(phase, Math.max(1, total), session)
        loading.updateProgress(completed, 0, session)
      },
      finish() {
        loading.finishLoading(session)
      },
      cancel() {
        loading.cancelLoading(session)
      },
      fail(error) {
        loading.failLoading(error, session)
      },
      invalidate: () => context.renderer.invalidate(),
    })

    // Reuse Tres' direct render loop and the independently dirty shadow pass.
    restoreRenderFunction?.()
    const renderMainScene = (notifyFrameRendered: () => void) => {
      // Tres stores registered cameras in a deep ref; keep matrix/uniform reads
      // in Three's draw loop off that proxy without caching the active camera.
      const camera = toRaw(context.camera.activeCamera.value)
      if (!camera) return
      renderer.render(context.scene.value, camera)
      notifyFrameRendered()
    }
    restoreRenderFunction = () => context.renderer.replaceRenderFunction(renderMainScene)
    context.renderer.replaceRenderFunction((notifyFrameRendered: () => void) => {
      if (environmentTransition?.pending) {
        notifyFrameRendered()
        return
      }
      const camera = toRaw(context.camera.activeCamera.value)
      if (!camera) return
      furnitureContext?.beforeRender()
      sceneEnvironment?.beforeRender()
      renderMainScene(notifyFrameRendered)
    })
  }

  // 连接场景的 invalidate 函数
  if (context.renderer?.invalidate) {
    setSceneInvalidate(context.renderer.invalidate)
  }
}

watch(
  () => [settingsStore.settings.lightingMode, settingsStore.settings.shadowsEnabled] as const,
  () => {
    void environmentTransition?.request()
  }
)
watch(
  () => settingsStore.settings.todMinute,
  (minute) => {
    if (environmentTransition?.pending) void environmentTransition.request()
    else sceneEnvironment?.update(settingsStore.settings.lightingMode, minute)
  }
)

// 相机模式切换包装函数（仅在透视模式下生效）
function handleToggleCameraMode() {
  // 只在透视模式下允许切换 orbit/flight
  if (!isOrthographic.value) {
    toggleCameraMode()
  }
}

// 逐帧相机位置缓存（用于检测帧间移动）
// NaN 作初始值：首帧会视为"已移动"，以便后续补渲一帧应用静止态效果
let _prevCamX = NaN,
  _prevCamY = NaN,
  _prevCamZ = NaN

// 渲染后回调（仅在 TresJS 实际渲染主场景后触发）
function handlePostRender(context: any) {
  if (environmentTransition?.pending) return
  recordRenderFrame()

  const renderer = context.renderer?.instance as WebGLRenderer | undefined
  const camera = activeCameraRef.value

  if (!renderer || !camera) return

  // 检测帧间相机位移
  const cam = camera as any
  const cx = cam.position.x,
    cy = cam.position.y,
    cz = cam.position.z
  const moved = cx !== _prevCamX || cy !== _prevCamY || cz !== _prevCamZ
  _prevCamX = cx
  _prevCamY = cy
  _prevCamZ = cz

  if (moved) {
    // 移动中：继续请求下一帧，阴影由光源/投影物的脏状态独立更新
    invalidateScene()
  }

  if (currentDisplayMode.value !== 'model') return

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
} = useThreeSelection(activeCameraRef, interactionAdapter, isTransformDragging)

// 3D Tooltip 系统（与 2D 复用同一开关）
const {
  tooltipVisible,
  tooltipData,
  handlePointerMove: handleTooltipPointerMove,
  hideTooltip,
} = useThreeTooltip(
  activeCameraRef,
  threeContainerRef,
  interactionAdapter,
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
  // 正交视图使用固定视锥体高度，避免 framing 受场景整体大小影响
  const size = ORTHO_BASE_FRUSTUM_HEIGHT

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
const gridBase = computed<[number, number, number]>(() => {
  if (terrainEnabled.value && terrainBounds.value) {
    const { min, max } = terrainBounds.value
    return [(min.x + max.x) / 2, -(min.y + max.y) / 2, -2]
  }
  return backgroundPosition.value
})
const gridSize = computed(() => {
  if (terrainEnabled.value && terrainBounds.value) {
    const { min, max } = terrainBounds.value
    return { width: max.x - min.x, height: max.y - min.y }
  }
  return backgroundSize.value
})
const { containerRotation, innerRotation, gridPosition } = useThreeGrid(gridBase)

// 视图切换函数（供命令系统调用）
function switchToView(preset: ViewPreset) {
  switchToViewPreset(preset)
}

// 添加物品位置获取函数（屏幕中心射线检测）
const { getAddPositionFn } = useEditorItemAdd()

// 未命中任何支撑面时，才退回到前方固定距离的“空中摆放”点。
const ADD_AIR_FALLBACK_DISTANCE = 1000
// 当屏幕中心射线有足够明显的向下分量时，认为用户是在朝地面/楼板看。
const GROUND_LOOK_DIRECTION_Z_THRESHOLD = -0.5

// Three.js 世界坐标 → 游戏数据坐标（Y 轴翻转）。
function worldPointToDataPosition(point: {
  x: number
  y: number
  z: number
}): [number, number, number] {
  return [point.x, -point.y, point.z]
}

// 当射线未命中物体时，尝试把落点投到 z=fallbackHeight 的水平平面。
// 这样高空俯视时会优先“落地”，而不是落在半空中。
function tryProjectRayToGround(
  raycaster: Raycaster,
  fallbackHeight = 0
): [number, number, number] | null {
  const { origin, direction } = raycaster.ray

  if (direction.z >= GROUND_LOOK_DIRECTION_Z_THRESHOLD) {
    return null
  }

  const distanceToGround = (fallbackHeight - origin.z) / direction.z
  if (distanceToGround < 0 || !Number.isFinite(distanceToGround)) {
    return null
  }

  const groundPoint = markRaw(new Vector3())
  groundPoint.copy(origin)
  groundPoint.addScaledVector(direction, distanceToGround)

  return worldPointToDataPosition(groundPoint)
}

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
    // Model 模式下可能拆成多个 instanced mesh，需手动取最近交点。
    let closestHit: { point: { x: number; y: number; z: number }; distance: number } | null = null

    for (const [, mesh] of modelMeshMap.value.entries()) {
      if (!mesh || mesh.count === 0) continue
      const intersects = raycaster.intersectObject(mesh, false)
      const hit = intersects[0]
      if (hit && (!closestHit || hit.distance < closestHit.distance)) {
        closestHit = {
          point: hit.point,
          distance: hit.distance,
        }
      }
    }

    // fallback mesh 承载没有专属模型配置的物品，也要参与放置命中。
    const fallbackMesh = modelFallbackMesh.value
    if (fallbackMesh && fallbackMesh.count > 0) {
      const intersects = raycaster.intersectObject(fallbackMesh, false)
      const hit = intersects[0]
      if (hit && (!closestHit || hit.distance < closestHit.distance)) {
        closestHit = {
          point: hit.point,
          distance: hit.distance,
        }
      }
    }

    if (closestHit) {
      return worldPointToDataPosition(closestHit.point)
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
      if (hit) {
        return worldPointToDataPosition(hit.point)
      }
    }
  }

  // 命中已有物体表面优先；只有完全 miss 时才考虑“落地”。
  const groundPoint = tryProjectRayToGround(raycaster)
  if (groundPoint) {
    return groundPoint
  }

  // 没有命中任何物体，且相机不是朝地面时：使用射线方向上固定距离的位置（支持空中摆放）
  const fallbackPoint = markRaw(new Vector3())
  fallbackPoint.copy(raycaster.ray.origin)
  fallbackPoint.addScaledVector(raycaster.ray.direction, ADD_AIR_FALLBACK_DISTANCE)

  return worldPointToDataPosition(fallbackPoint)
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
        :clear-color="canvasClearColor"
        :shadow-map-type="PCFShadowMap"
        render-mode="on-demand"
        logarithmic-depth-buffer
        power-preference="high-performance"
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
          :near="cameraNearPlane"
          :far="clipFar"
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
          :near="cameraNearPlane"
          :far="clipFar"
        />

        <!-- 轨道控制器：透视视图下使用中键旋转，正交视图下使用中键平移 -->
        <!-- 使用 v-if 而非 :enabled，确保 flight 模式下完全移除控制器，避免事件竞态 -->
        <OrbitControls
          v-if="controlMode === 'orbit'"
          ref="orbitControlsRef"
          :target="cameraLookAt"
          :enabled="orbitControlsEnabled"
          :enableDamping="false"
          :rotateSpeed="settingsStore.settings.cameraOrbitRotateSpeed"
          :enableRotate="orbitEnableRotate"
          :enablePan="orbitEnablePan"
          :enable-zoom="!isCtrlPressed"
          :zoomSpeed="settingsStore.settings.cameraZoomSpeed"
          :mouseButtons="orbitMouseButtons"
          :touches="orbitTouches"
        />

        <!-- Standalone export already contains world-space Z-up cm transforms. -->
        <primitive v-if="terrainEnabled && terrainObject" :object="terrainObject" />

        <!-- 场景内容容器：Y轴翻转以实现左手坐标系视觉（Y轴朝南） -->
        <TresGroup :scale="[1, -1, 1]">
          <!-- 背景地图 -->
          <!-- 由于父级 Group 翻转了 Y 轴，这里再次翻转 Y 轴以保持地图图片方向正确（北朝上） -->
          <TresMesh
            v-if="
              backgroundTexture &&
              shouldShowBackground &&
              !isWorldBuildScheme &&
              !(terrainEnabled && terrainObject)
            "
            :position="backgroundPosition"
            :rotation="backgroundRotation"
            :scale="[1, -1, 1]"
            :render-order="isMapDepthDisabled ? -1 : 0"
          >
            <TresPlaneGeometry :args="[backgroundSize.width, backgroundSize.height]" />
            <primitive
              v-if="settingsStore.settings.lightingMode === 'home'"
              :object="backgroundTodMaterial"
              attach="material"
              :dispose="false"
            />
            <TresMeshBasicMaterial
              v-else
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
            <!-- 渲染回退 Mesh（用于缺少模型数据的物品，count=0 时 GPU 不渲染） -->
            <primitive v-if="modelFallbackMesh" :object="modelFallbackMesh" />
          </template>

          <primitive v-if="slidePathSegmentMesh" :object="slidePathSegmentMesh" />
          <primitive v-if="slidePathPointMesh" :object="slidePathPointMesh" />
        </TresGroup>

        <!-- 辅助元素 - 适配大场景 - 移至世界空间 -->
        <TresGroup
          v-if="(backgroundTexture || terrainObject) && !isWorldBuildScheme"
          :position="gridPosition"
          :rotation="containerRotation"
        >
          <TresGroup :rotation="innerRotation">
            <!-- Grid 组件 -->
            <LogDepthGrid
              :args="[gridSize.width, gridSize.height]"
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
    <div
      v-if="terrainEnabled && terrainError"
      class="pointer-events-none absolute bottom-3 left-3 max-w-md rounded bg-background/90 px-3 py-2 text-xs text-destructive"
    >
      {{ t('sidebar.environment.terrainError', { message: terrainError }) }}
    </div>
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

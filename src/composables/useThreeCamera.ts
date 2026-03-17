import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  watch,
  type Ref,
  toValue,
} from 'vue'
import { useRafFn, useMagicKeys } from '@vueuse/core'
import { getItemsWorldBoundsMetrics } from '@/lib/spatialBounds'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCameraInputConfig } from '@/composables/useCameraInputConfig'
import {
  computeViewPose,
  computeZoomConversion,
  getForwardVector,
  getRightVector,
  calculateYawPitchFromDirection,
  ORTHO_BASE_FRUSTUM_HEIGHT,
  scaleVec3,
  addScaled,
  normalize,
  clamp,
} from '@/lib/cameraUtils'

// ============================================================
// 📦 Types & Constants
// ============================================================

type Vec3 = [number, number, number]

export type ViewPreset = 'perspective' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

interface OrbitRuntimePose {
  position: Vec3
  target: Vec3
  zoom?: number
}

// 相机控制模式（简化）
type ControlMode = 'orbit' | 'flight'

// 相机状态：单一真实来源
interface CameraState {
  position: Vec3
  target: Vec3 // lookAt 点
  yaw: number // 弧度
  pitch: number // 弧度
  up: Vec3 // 相机的上方向
  zoom: number // 缩放级别 (主要用于正交相机)
}

// 配置选项（支持响应式）
export interface CameraControllerOptions {
  baseSpeed?: number | Ref<number>
  shiftSpeedMultiplier?: number | Ref<number>
  mouseSensitivity?: number | Ref<number>
  pitchLimits?: { min: number; max: number } | Ref<{ min: number; max: number }>
  minHeight?: number | Ref<number>
}

// 依赖项
export interface CameraControllerDeps {
  isTransformDragging?: Ref<boolean>
  readOrbitRuntimePose?: () => OrbitRuntimePose | null
  writeOrbitRuntimePose?: (pose: OrbitRuntimePose & { up: Vec3 }) => boolean | void
  defaultCenter?: Ref<Vec3>
}

// 对外接口
export interface CameraControllerResult {
  cameraPosition: Ref<Vec3>
  cameraLookAt: Ref<Vec3>
  cameraUp: Ref<Vec3>
  cameraZoom: Ref<number>
  isViewFocused: Ref<boolean>
  isNavKeyPressed: Ref<boolean>
  isCameraMoving: Ref<boolean>
  controlMode: Ref<ControlMode>
  isOrthographic: Ref<boolean>
  sceneCenter: Ref<Vec3>
  cameraDistance: Ref<number>
  handleNavPointerDown: (evt: PointerEvent) => void
  handleNavPointerMove: (evt: PointerEvent) => void
  handleNavPointerUp: (evt: PointerEvent) => void
  handleFlightWheel: (deltaY: number) => void
  handleFlightPinch: (deltaDistance: number) => void
  setPoseFromLookAt: (position: Vec3, target: Vec3) => void
  lookAtTarget: (target: Vec3) => void
  toggleCameraMode: () => void
  switchToOrbitMode: () => Vec3 | null
  switchToViewPreset: (preset: ViewPreset) => void
  setZoom: (zoom: number) => void
  fitCameraToScene: () => void
  focusOnSelection: () => void
  restoreSnapshot: (snapshot: {
    position: Vec3
    target: Vec3
    preset: ViewPreset | null
    zoom?: number
  }) => void
}

// ============================================================
// 🎮 Main Controller
// ============================================================

export function useThreeCamera(
  options: CameraControllerOptions | Ref<CameraControllerOptions> = {},
  deps: CameraControllerDeps = {}
): CameraControllerResult {
  // === 引入 Store ===
  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const settingsStore = useSettingsStore()

  // 获取相机输入配置（统一管理）
  const cameraInput = useCameraInputConfig()

  // 支持响应式 options
  const optionsValue = computed(() => toValue(options))
  const baseSpeed = computed(() => toValue(optionsValue.value.baseSpeed) ?? 1000)
  const shiftSpeedMultiplier = computed(() => toValue(optionsValue.value.shiftSpeedMultiplier) ?? 4)
  const mouseSensitivity = computed(() => toValue(optionsValue.value.mouseSensitivity) ?? 0.002)
  const pitchLimits = computed(
    () => toValue(optionsValue.value.pitchLimits) ?? { min: -90, max: 90 }
  )
  const pitchMinRad = computed(() => (pitchLimits.value.min * Math.PI) / 180)
  const pitchMaxRad = computed(() => (pitchLimits.value.max * Math.PI) / 180)
  const minHeight = computed(() => toValue(optionsValue.value.minHeight) ?? -10000)
  const FOV = computed(() => settingsStore.settings.cameraFov)

  // ============================================================
  // 🎯 State Management
  // ============================================================

  const state = ref<CameraState>({
    position: [0, 3000, 3000], // Z-up: height in Z
    target: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    up: [0, 0, 1], // Z-up default
    zoom: 1,
  })

  const controlMode = ref<ControlMode>('orbit')

  const isViewFocused = ref(false)
  const isMouseLookActive = ref(false) // 重命名：是否正在进行鼠标视角拖拽
  const isOrbitDragging = ref(false) // Orbit 模式下的鼠标拖拽状态
  const hasPendingOrbitRuntimeWrite = ref(false)
  const touchLookPointerId = ref<number | null>(null)
  const touchLookLastPos = ref<{ x: number; y: number } | null>(null)
  let isActive = false

  // === 派生状态 (Computed) ===
  const currentViewPreset = computed(() => uiStore.currentViewPreset)
  const isOrthographic = computed(() => currentViewPreset.value !== 'perspective')

  function toVec3Tuple(vector: { x: number; y: number; z: number }): Vec3 {
    return [vector.x, vector.y, vector.z]
  }

  // 当前相机只关心“视觉 framing”语义，所以这里取的是选区物品列表，
  // 后续统一交给世界空间 bounds 工具求 frame center / maxDim。
  function getSelectedItems() {
    const scheme = editorStore.activeScheme
    if (!scheme) return []

    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return []

    return scheme.items.value.filter((item) => selectedIds.has(item.internalId))
  }

  function getSelectedItemsFrameMetrics() {
    return getItemsWorldBoundsMetrics(getSelectedItems())
  }

  // 场景级 frame metrics：用于场景中心和正交视锥体基准距离。
  const sceneFrameMetrics = computed(() => {
    const items = editorStore.activeScheme?.items.value ?? []
    return getItemsWorldBoundsMetrics(items)
  })

  // === 场景中心与距离计算 ===
  const sceneCenter = computed<Vec3>(() => {
    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      return deps.defaultCenter?.value ?? [0, 0, 0]
    }

    const metrics = sceneFrameMetrics.value
    if (!metrics) {
      return [0, 0, 0]
    }

    return toVec3Tuple(metrics.center)
  })

  // 默认基准距离 (用于正交视锥体计算等)
  const cameraDistance = ref(40000)

  function updateCameraDistance() {
    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      cameraDistance.value = 40000
      return
    }

    const metrics = sceneFrameMetrics.value
    if (!metrics) {
      cameraDistance.value = 3000
      return
    }

    cameraDistance.value = Math.max(metrics.maxDim, 3000)
  }

  // === 响应式绑定 (Reactive Binding with Store) ===

  // 1. Sync Store (Scheme Switch) -> Internal State
  watch(
    () => editorStore.activeSchemeId,
    (newId) => {
      if (!newId) return

      const scheme = editorStore.activeScheme
      // 更新一次基准距离
      updateCameraDistance()

      // scheme.viewState 是 Ref，需要传入 .value
      if (scheme?.viewState.value) {
        // 恢复状态
        restoreSnapshot(scheme.viewState.value)
      } else {
        // 无状态（如新导入），默认使用顶视图并聚焦到物品中心
        // 先设置正确的 target，再切换视图（确保 position 基于正确的 target 计算）
        state.value.target = [...sceneCenter.value]
        state.value.zoom = 1
        switchToViewPreset('top')
      }
    },
    { immediate: true }
  )

  // 2. Sync Internal State -> Store (相机移动时触发)
  watch(
    state,
    (newVal) => {
      if (editorStore.activeScheme) {
        editorStore.activeScheme.viewState.value = {
          position: [...newVal.position],
          target: [...newVal.target],
          preset: uiStore.currentViewPreset,
          zoom: newVal.zoom,
        }
      }
    },
    { deep: true }
  )

  // === 监听按键状态 ===
  const keys = useMagicKeys()
  // 这些键在运行时总是存在，这里通过非空断言消除 TS 的 undefined 警告
  const w = keys.w!
  const a = keys.a!
  const s = keys.s!
  const d = keys.d!
  const q = keys.q!
  const space = keys.space!
  const shift = keys.shift!
  const ctrl = keys.ctrl!
  const meta = keys.meta!
  // const tab = keys.tab! // 未使用

  // === 监听视图预设变化，自动切换控制模式 ===
  watch(
    currentViewPreset,
    (preset) => {
      if (preset === 'perspective') {
        // 切换到透视视图：恢复用户偏好
        controlMode.value = settingsStore.settings.perspectiveControlMode
      } else {
        // 切换到正交视图：强制使用 orbit
        controlMode.value = 'orbit'
      }
    },
    { immediate: true }
  )

  function vec3ApproxEqual(a: Vec3, b: Vec3, epsilon = 1e-4): boolean {
    return (
      Math.abs(a[0] - b[0]) < epsilon &&
      Math.abs(a[1] - b[1]) < epsilon &&
      Math.abs(a[2] - b[2]) < epsilon
    )
  }

  function markOrbitRuntimeWriteNeeded() {
    if (controlMode.value === 'orbit') {
      hasPendingOrbitRuntimeWrite.value = true
    }
  }

  // 切回 Orbit 时，要求将当前 state 写回 runtime（处理视图切换 / controls 重挂载）
  watch(controlMode, (mode) => {
    if (mode === 'orbit') {
      hasPendingOrbitRuntimeWrite.value = true
    }
  })

  function flushOrbitRuntimeWrite() {
    if (controlMode.value !== 'orbit') return
    if (!hasPendingOrbitRuntimeWrite.value) return
    if (!deps.writeOrbitRuntimePose) return

    const ok = deps.writeOrbitRuntimePose({
      position: [...state.value.position],
      target: [...state.value.target],
      up: [...state.value.up],
      zoom: state.value.zoom,
    })

    if (ok !== false) {
      hasPendingOrbitRuntimeWrite.value = false
    }
  }

  function syncOrbitStateFromRuntime() {
    if (controlMode.value !== 'orbit') return
    if (!deps.readOrbitRuntimePose) return

    const runtimePose = deps.readOrbitRuntimePose()
    if (!runtimePose) return

    const posChanged = !vec3ApproxEqual(state.value.position, runtimePose.position)
    const targetChanged = !vec3ApproxEqual(state.value.target, runtimePose.target)
    const zoomChanged =
      typeof runtimePose.zoom === 'number' &&
      Math.abs((runtimePose.zoom ?? 0) - state.value.zoom) > 1e-5

    if (!posChanged && !targetChanged && !zoomChanged) return

    if (posChanged || targetChanged) {
      setPoseFromLookAt([...runtimePose.position], [...runtimePose.target], 'runtime')
    }
    if (zoomChanged && typeof runtimePose.zoom === 'number') {
      state.value.zoom = runtimePose.zoom
    }
  }

  function updateLookAtFromYawPitch() {
    const forward = getForwardVector(state.value.yaw, state.value.pitch)
    state.value.target = addScaled(state.value.position, forward, 2000)
  }

  function updateYawPitchFromDirection() {
    const dir: Vec3 = [
      state.value.target[0] - state.value.position[0],
      state.value.target[1] - state.value.position[1],
      state.value.target[2] - state.value.position[2],
    ]
    const { yaw, pitch } = calculateYawPitchFromDirection(dir, pitchMinRad.value, pitchMaxRad.value)
    state.value.yaw = yaw
    state.value.pitch = pitch
  }

  // ============================================================
  // 🎮 Mode Handlers
  // ============================================================

  // 检查是否有导航键按下
  // 注意：排除修饰键（Ctrl/Meta），避免快捷键（如 Ctrl+S）触发相机移动
  function hasNavKeys(): boolean {
    // 如果按下了 Ctrl 或 Meta（Command），则不视为导航键
    if (ctrl.value || meta.value) {
      return false
    }
    return !!(w.value || a.value || s.value || d.value || q.value || space.value)
  }

  /**
   * 获取移动向量（根据锁定水平移动设置）
   * @param useLockHorizontal 是否锁定在水平面上移动
   * @returns 前进、右移、上下三个方向向量
   */
  function getMovementVectors(useLockHorizontal: boolean) {
    if (useLockHorizontal) {
      // 锁定水平移动 - 忽略俯仰角，WASD 仅在水平面移动
      return {
        forward: [Math.sin(state.value.yaw), Math.cos(state.value.yaw), 0] as Vec3,
        right: [Math.cos(state.value.yaw), -Math.sin(state.value.yaw), 0] as Vec3,
        up: [0, 0, 1] as Vec3,
      }
    } else {
      // 跟随视角移动 - 包含俯仰角，WASD 跟随相机朝向
      return {
        forward: getForwardVector(state.value.yaw, state.value.pitch),
        right: getRightVector(state.value.yaw),
        up: [0, 0, 1] as Vec3,
      }
    }
  }

  // 通用移动向量计算函数
  function calculateMovementDelta(
    forward: Vec3,
    right: Vec3,
    up: Vec3,
    deltaSeconds: number,
    speedMultiplier: number
  ): Vec3 | null {
    let move: Vec3 = [0, 0, 0]
    const push = (dir: Vec3, sign: number) => {
      move = [move[0] + dir[0] * sign, move[1] + dir[1] * sign, move[2] + dir[2] * sign]
    }

    if (w.value) push(forward, 1)
    if (s.value) push(forward, -1)
    if (a.value) push(right, -1)
    if (d.value) push(right, 1)
    if (space.value) push(up, 1)
    if (q.value) push(up, -1)

    const moveNorm = normalize(move)
    if (moveNorm[0] === 0 && moveNorm[1] === 0 && moveNorm[2] === 0) return null

    const distance = baseSpeed.value * deltaSeconds * speedMultiplier
    return scaleVec3(moveNorm, distance)
  }

  // 计算当前是否应该响应导航键
  const isNavKeyPressed = computed(() => {
    if (controlMode.value !== 'flight' || !isViewFocused.value || deps.isTransformDragging?.value) {
      return false
    }
    return hasNavKeys()
  })

  // 计算相机是否正在移动（用于性能优化：大量物品时跳过射线检测）
  const isCameraMoving = computed(() => {
    // Flight 模式：WASD 按下或鼠标视角拖拽
    if (controlMode.value === 'flight') {
      return isNavKeyPressed.value || isMouseLookActive.value
    }
    // Orbit 模式：鼠标拖拽或 WASD 平移
    return isOrbitDragging.value || hasNavKeys()
  })

  // Flight 模式更新
  function updateFlightMode(deltaSeconds: number) {
    if (!hasNavKeys() || !isViewFocused.value || deps.isTransformDragging?.value) {
      return
    }

    // 根据设置获取移动向量
    const { forward, right, up } = getMovementVectors(
      settingsStore.settings.cameraLockHorizontalMovement
    )

    // 应用速度
    const speedMultiplier = shift.value ? shiftSpeedMultiplier.value : 1
    const deltaVec = calculateMovementDelta(forward, right, up, deltaSeconds, speedMultiplier)

    if (!deltaVec) return

    const newPos: Vec3 = [
      state.value.position[0] + deltaVec[0],
      state.value.position[1] + deltaVec[1],
      state.value.position[2] + deltaVec[2],
    ]

    // 高度限制 (Z axis)
    if (newPos[2] < minHeight.value) {
      newPos[2] = minHeight.value
    }

    state.value.position = newPos
    updateLookAtFromYawPitch()
  }

  // ============================================================
  // 🔄 Mode Transitions
  // ============================================================

  function toggleCameraMode() {
    // 只在透视模式下允许切换
    if (isOrthographic.value) return

    if (controlMode.value === 'orbit') {
      controlMode.value = 'flight'
      // 保存到全局设置
      settingsStore.settings.perspectiveControlMode = 'flight'
    } else {
      switchToOrbitMode()
      // 保存到全局设置
      settingsStore.settings.perspectiveControlMode = 'orbit'
    }
  }

  function switchToOrbitMode(): Vec3 | null {
    if (controlMode.value === 'orbit') return null
    isMouseLookActive.value = false
    touchLookPointerId.value = null
    touchLookLastPos.value = null

    let newTarget: Vec3

    // 1. 检查是否有选中的物品
    const scheme = editorStore.activeScheme
    const selectedIds = scheme?.selectedItemIds.value

    if (selectedIds && selectedIds.size > 0) {
      // Flight -> Orbit 时，如果存在选区，则直接看向选区的 frame center。
      const frameMetrics = getSelectedItemsFrameMetrics()

      if (frameMetrics) {
        newTarget = toVec3Tuple(frameMetrics.center)
      } else {
        // 包围盒计算失败，fallback 到原逻辑
        const forward = getForwardVector(state.value.yaw, state.value.pitch)
        newTarget = addScaled(state.value.position, forward, 2000)
      }
    } else {
      // 无选中物品：使用视线前方固定距离（原逻辑）
      const forward = getForwardVector(state.value.yaw, state.value.pitch)
      newTarget = addScaled(state.value.position, forward, 2000)
    }

    // 更新 state.target，watch 会自动同步到 OrbitControls
    state.value.target = [...newTarget]
    markOrbitRuntimeWriteNeeded()

    controlMode.value = 'orbit'

    return newTarget
  }

  // ============================================================
  // ⌨️ Input Processing
  // ============================================================

  function handleNavPointerDown(evt: PointerEvent) {
    if (deps.isTransformDragging?.value) return
    isViewFocused.value = true

    // Flight 模式下根据配置控制视角
    if (controlMode.value === 'flight') {
      // 触屏下：单指导航会话直接进入视角拖拽
      if (evt.pointerType === 'touch') {
        touchLookPointerId.value = evt.pointerId
        touchLookLastPos.value = { x: evt.clientX, y: evt.clientY }
        isMouseLookActive.value = true
        return
      }

      if (cameraInput.shouldTriggerFlightLook(evt.button)) {
        isMouseLookActive.value = true
        evt.preventDefault()
      }
    }

    // Orbit 模式下追踪鼠标拖拽（中键或右键）
    if (controlMode.value === 'orbit') {
      if (evt.button === 1 || evt.button === 2) {
        isOrbitDragging.value = true
      }
    }
  }

  function handleNavPointerMove(evt: PointerEvent) {
    if (!isMouseLookActive.value || controlMode.value !== 'flight') return
    if (deps.isTransformDragging?.value) return

    // 触摸事件在多数浏览器没有 movementX/Y，改用 client 坐标差分
    if (evt.pointerType === 'touch') {
      if (touchLookPointerId.value !== evt.pointerId || !touchLookLastPos.value) return

      const deltaX = evt.clientX - touchLookLastPos.value.x
      const deltaY = evt.clientY - touchLookLastPos.value.y

      touchLookLastPos.value = { x: evt.clientX, y: evt.clientY }

      state.value.yaw += deltaX * mouseSensitivity.value
      state.value.pitch = clamp(
        state.value.pitch - deltaY * mouseSensitivity.value,
        pitchMinRad.value,
        pitchMaxRad.value
      )

      updateLookAtFromYawPitch()
      return
    }

    // 更新 yaw/pitch（透视视角下始终视为透视预设的连续变体）
    state.value.yaw += evt.movementX * mouseSensitivity.value
    state.value.pitch = clamp(
      state.value.pitch - evt.movementY * mouseSensitivity.value,
      pitchMinRad.value,
      pitchMaxRad.value
    )

    updateLookAtFromYawPitch()
  }

  function handleNavPointerUp(evt: PointerEvent) {
    if (evt.pointerType === 'touch' && touchLookPointerId.value === evt.pointerId) {
      isMouseLookActive.value = false
      touchLookPointerId.value = null
      touchLookLastPos.value = null
      return
    }

    // 检查是否是当前配置的按键
    if (cameraInput.shouldReleaseFlightLook(evt.button)) {
      isMouseLookActive.value = false
    }

    // Orbit 模式下释放拖拽状态
    if (controlMode.value === 'orbit') {
      if (evt.button === 1 || evt.button === 2) {
        isOrbitDragging.value = false
      }
    }
  }

  function moveFlightAlongForward(distance: number) {
    // 获取移动向量（尊重 lockHorizontalMovement 设置）
    const { forward } = getMovementVectors(settingsStore.settings.cameraLockHorizontalMovement)

    const newPos: Vec3 = [
      state.value.position[0] + forward[0] * distance,
      state.value.position[1] + forward[1] * distance,
      state.value.position[2] + forward[2] * distance,
    ]

    // 高度限制 (Z axis)
    if (newPos[2] < minHeight.value) {
      newPos[2] = minHeight.value
    }

    state.value.position = newPos
    updateLookAtFromYawPitch()
  }

  // Flight 模式下的滚轮前进/后退
  function handleFlightWheel(deltaY: number) {
    if (controlMode.value !== 'flight') return
    if (!isViewFocused.value || deps.isTransformDragging?.value) return

    // 方向：deltaY > 0 (向下滚) = 后退, deltaY < 0 (向上滚) = 前进
    const direction = deltaY > 0 ? -1 : 1

    // 固定步长 × 滚轮速度设置
    const stepDistance = 200 * settingsStore.settings.cameraZoomSpeed

    moveFlightAlongForward(stepDistance * direction)
  }

  // Flight 模式下的双指 pinch 前进/后退
  function handleFlightPinch(deltaDistance: number) {
    if (controlMode.value !== 'flight') return
    if (!isViewFocused.value || deps.isTransformDragging?.value) return
    if (Math.abs(deltaDistance) < 0.5) return

    // 双指间距增大（delta > 0）= 前进；间距减小（delta < 0）= 后退
    // 跟随“移动基础速度”设置，而非缩放速度，保证触摸前进/后退与飞行移动手感一致
    const pinchScaleByBaseSpeed = 0.01
    const moveDistance = deltaDistance * baseSpeed.value * pinchScaleByBaseSpeed
    moveFlightAlongForward(moveDistance)
  }

  // ============================================================
  // 🔌 Public API (Internal Implementation)
  // ============================================================

  function setPoseFromLookAt(position: Vec3, target: Vec3, source: 'state' | 'runtime' = 'state') {
    state.value.position = [...position]
    state.value.target = [...target]

    const dir: Vec3 = [target[0] - position[0], target[1] - position[1], target[2] - position[2]]
    const { yaw, pitch } = calculateYawPitchFromDirection(dir, pitchMinRad.value, pitchMaxRad.value)
    state.value.yaw = yaw
    state.value.pitch = pitch

    if (source === 'state') {
      markOrbitRuntimeWriteNeeded()
    }
  }

  function lookAtTarget(target: Vec3) {
    setPoseFromLookAt(state.value.position, target)
  }

  /**
   * 切换视图预设（唯一公开 API）
   * 自动处理透视↔正交的 zoom/distance 转换
   */
  function switchToViewPreset(preset: ViewPreset) {
    // 调用 switchToOrbitMode() 自动确定合理的 target（选区中心或视线前方点）
    if (controlMode.value === 'flight' && preset !== 'perspective') {
      switchToOrbitMode()
    }

    const fromPreset = currentViewPreset.value

    // 1. 计算当前相机到目标的实际物理距离
    const dx = state.value.position[0] - state.value.target[0]
    const dy = state.value.position[1] - state.value.target[1]
    const dz = state.value.position[2] - state.value.target[2]
    const currentDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    // 2. 计算 zoom/distance 转换
    const { newDistance, newZoom } = computeZoomConversion(
      fromPreset,
      preset,
      state.value.zoom,
      currentDistance,
      cameraDistance.value,
      FOV.value
    )

    // 3. 计算新姿态（含 WCS 旋转）
    const { position, up, yaw, pitch } = computeViewPose(
      preset,
      state.value.target,
      newDistance,
      uiStore.workingCoordinateSystem,
      { min: pitchMinRad.value, max: pitchMaxRad.value }
    )

    // 4. 更新状态（单次赋值）
    state.value.position = position
    state.value.up = up
    state.value.yaw = yaw
    state.value.pitch = pitch
    state.value.zoom = newZoom

    // 5. 更新 UI Store（唯一写入点）
    uiStore.setCurrentViewPreset(preset)
    markOrbitRuntimeWriteNeeded()
  }

  /**
   * 恢复相机状态快照（从存储的 viewState 恢复）
   */
  function restoreSnapshot(snapshot: {
    position: Vec3
    target: Vec3
    preset: ViewPreset | null
    zoom?: number
  }) {
    const preset = snapshot.preset ?? 'perspective'

    // 1. 先设置视图预设（计算 up 向量等）
    const { up } = computeViewPose(
      preset,
      snapshot.target,
      1, // distance 不重要，因为我们会覆盖 position
      uiStore.workingCoordinateSystem,
      { min: pitchMinRad.value, max: pitchMaxRad.value }
    )

    // 2. 覆盖具体位置（保留快照中的精确位置）
    state.value.position = [...snapshot.position]
    state.value.target = [...snapshot.target]
    state.value.up = up
    state.value.zoom = snapshot.zoom ?? 1

    // 3. 重算 yaw/pitch（使用实际的 position 和 target）
    updateYawPitchFromDirection()

    // 4. 更新 UI Store
    uiStore.setCurrentViewPreset(preset)
    markOrbitRuntimeWriteNeeded()

    // 5. 控制模式由 watch(currentViewPreset) 自动处理
    // target 同步由 watch 自动处理
  }

  // ============================================================
  // 🔁 Update Loop
  // ============================================================

  const { pause, resume } = useRafFn(
    ({ delta }) => {
      if (!isActive) return

      // 1. Flight 模式下更新移动
      if (controlMode.value === 'flight') {
        updateFlightMode(delta / 1000)
      }

      // Orbit 模式采用 runtime controls 作为权威源：
      // 先尝试将 state 写回 runtime，再从 runtime 拉取最新姿态
      if (controlMode.value === 'orbit') {
        flushOrbitRuntimeWrite()
        syncOrbitStateFromRuntime()
      }

      // 2. Orbit 模式下检测 WASD → 平移 (Pan)
      if (
        controlMode.value === 'orbit' &&
        !isOrthographic.value &&
        hasNavKeys() &&
        isViewFocused.value &&
        !deps.isTransformDragging?.value
      ) {
        // 计算平移向量
        // Orbit 下 WASD 类似于 "RTS 地图移动" 或 Blender Shift+Middle Pan
        // 这里采用平面移动逻辑：W/S 前后，A/D 左右，Q/Space 上下

        // 1. 获取水平方向的 Forward 和 Right (忽略 pitch，只看 yaw)
        // 这样 W 总是沿着相机的“水平视线”向前
        const { forward, right, up } = getMovementVectors(
          settingsStore.settings.cameraLockHorizontalMovement
        )

        const speedMultiplier = shift.value ? shiftSpeedMultiplier.value : 1
        const deltaVec = calculateMovementDelta(forward, right, up, delta / 1000, speedMultiplier)

        if (deltaVec) {
          // 同时更新 position 和 target，保持相对视角不变，实现“平移”
          const newPos: Vec3 = [
            state.value.position[0] + deltaVec[0],
            state.value.position[1] + deltaVec[1],
            state.value.position[2] + deltaVec[2],
          ]

          // 高度限制 (Z axis)
          if (newPos[2] < minHeight.value) {
            // 如果被限制了，只调整 Z 分量
            const zDiff = minHeight.value - newPos[2]
            newPos[2] = minHeight.value
            // deltaVec 的 Z 分量也需要相应调整，以保证 target 同步
            deltaVec[2] += zDiff
          }

          state.value.position = newPos
          state.value.target = [
            state.value.target[0] + deltaVec[0],
            state.value.target[1] + deltaVec[1],
            state.value.target[2] + deltaVec[2],
          ]

          hasPendingOrbitRuntimeWrite.value = true
          flushOrbitRuntimeWrite()

          // target 的同步由 watch 自动处理
        }
      }
    },
    { immediate: false }
  )

  // ============================================================
  // 🔄 Lifecycle
  // ============================================================

  function activate() {
    if (isActive) return
    isActive = true
    resume()
  }

  function deactivate() {
    if (!isActive) return
    isActive = false
    pause()
    isViewFocused.value = false
    isMouseLookActive.value = false
    touchLookPointerId.value = null
    touchLookLastPos.value = null
  }

  onMounted(() => {
    activate()
  })

  onUnmounted(() => {
    deactivate()
  })

  onActivated(() => {
    activate()
  })

  onDeactivated(() => {
    deactivate()
  })

  // ============================================================
  // 🔍 Focus & Fit Logic
  // ============================================================

  function fitCameraToScene() {
    // 1. 更新基准距离以适配当前场景
    updateCameraDistance()

    // 2. 确定目标参数（不依赖当前状态，确保重置行为一致）
    const preset = currentViewPreset.value
    const targetCenter = sceneCenter.value
    const distance = cameraDistance.value
    const zoom = 1

    // 3. 直接使用 computeViewPose 计算相机姿态（纯函数，不依赖当前状态）
    //    绕过 switchToViewPreset 的 computeZoomConversion 复杂转换逻辑
    const { position, up, yaw, pitch } = computeViewPose(
      preset,
      targetCenter,
      distance,
      uiStore.workingCoordinateSystem,
      { min: pitchMinRad.value, max: pitchMaxRad.value }
    )

    // 4. 直接更新状态（确保完全重置到目标位置）
    state.value.position = position
    state.value.target = [...targetCenter]
    state.value.up = up
    state.value.yaw = yaw
    state.value.pitch = pitch
    state.value.zoom = zoom

    // 5. 同步 UI Store
    uiStore.setCurrentViewPreset(preset)
    markOrbitRuntimeWriteNeeded()

    // 6. 确保控制模式正确
    controlMode.value = 'orbit'
  }

  function focusOnSelection() {
    const scheme = editorStore.activeScheme
    if (!scheme) return

    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return

    const frameMetrics = getSelectedItemsFrameMetrics()
    if (!frameMetrics) return

    // F 聚焦使用 frame center，而不是 Gizmo pivot，
    // 这样视觉上更接近主流 3D 编辑器的 Frame Selected 行为。
    const target = toVec3Tuple(frameMetrics.center)
    const maxDim = frameMetrics.maxDim

    // 特殊处理 Flight 模式：仅瞬移，不切换模式
    if (controlMode.value === 'flight') {
      // 计算理想距离 (复用透视视图计算)
      const requiredSize = Math.max(maxDim, 1000) * 1.2
      const dist = requiredSize / (2 * Math.tan((FOV.value * Math.PI) / 360))

      // 保持当前相机相对于物体的方向
      // 计算从物体指向相机的向量
      const currentPos = state.value.position
      let dx = currentPos[0] - target[0]
      let dy = currentPos[1] - target[1]
      let dz = currentPos[2] - target[2]
      let len = Math.sqrt(dx * dx + dy * dy + dz * dz)

      // 如果距离太近，使用默认方向 (南向北俯视)
      if (len < 1) {
        dx = 0.6
        dy = -0.6
        dz = 0.8
        len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      }

      const dirX = dx / len
      const dirY = dy / len
      const dirZ = dz / len

      const newPos: Vec3 = [
        target[0] + dirX * dist,
        target[1] + dirY * dist,
        target[2] + dirZ * dist,
      ]

      setPoseFromLookAt(newPos, target)
      return
    }

    if (isOrthographic.value) {
      // === 正交视图处理 ===
      // 1. 平移相机：保持方向不变，移动位置使视线穿过新目标
      const currentPos = state.value.position
      const currentTarget = state.value.target

      const offsetX = target[0] - currentTarget[0]
      const offsetY = target[1] - currentTarget[1]
      const offsetZ = target[2] - currentTarget[2]

      const newPos: Vec3 = [
        currentPos[0] + offsetX,
        currentPos[1] + offsetY,
        currentPos[2] + offsetZ,
      ]

      setPoseFromLookAt(newPos, target)

      // 2. 调整 Zoom 适配包围盒
      // 正交聚焦使用固定视锥体高度，避免结果受场景大小影响
      const frustumHeight = ORTHO_BASE_FRUSTUM_HEIGHT

      // 计算目标需要的视口大小
      const requiredSize = Math.max(maxDim, 1000) * 1.2

      // zoom = 基准高度 / 实际需要高度
      // 限制 zoom 范围防止出错
      const newZoom = clamp(frustumHeight / requiredSize, 0.1, 20)
      state.value.zoom = newZoom
    } else {
      // === 透视视图处理 ===
      // 移动相机距离以包含包围盒
      const currentPos = state.value.position
      const currentTarget = state.value.target

      // 计算当前方向向量
      const dx = currentTarget[0] - currentPos[0]
      const dy = currentTarget[1] - currentPos[1]
      const dz = currentTarget[2] - currentPos[2]
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz)

      // 归一化反向向量 (从目标指向相机)
      const backX = len > 0 ? -dx / len : 0
      const backY = len > 0 ? -dy / len : 0
      const backZ = len > 0 ? -dz / len : 1

      // 计算合适距离
      const requiredSize = Math.max(maxDim, 1000) * 1.2
      const dist = requiredSize / (2 * Math.tan((FOV.value * Math.PI) / 360))

      const newPos: Vec3 = [
        target[0] + backX * dist,
        target[1] + backY * dist,
        target[2] + backZ * dist,
      ]

      setPoseFromLookAt(newPos, target)
      state.value.zoom = 1 // 透视模式重置 Zoom
      markOrbitRuntimeWriteNeeded()
    }
  }

  // ============================================================
  // 📤 Return API
  // ============================================================

  return {
    // 状态（只读）
    cameraPosition: computed(() => state.value.position),
    cameraLookAt: computed(() => state.value.target),
    cameraUp: computed(() => state.value.up),
    cameraZoom: computed(() => state.value.zoom),
    isViewFocused,
    isNavKeyPressed,
    isCameraMoving,
    controlMode,
    isOrthographic,
    sceneCenter,
    cameraDistance,

    // 事件处理
    handleNavPointerDown,
    handleNavPointerMove,
    handleNavPointerUp,
    handleFlightWheel,
    handleFlightPinch,

    // 命令
    setPoseFromLookAt,
    setZoom: (zoom: number) => {
      state.value.zoom = zoom
    },
    lookAtTarget,
    toggleCameraMode,
    switchToOrbitMode,
    switchToViewPreset,
    restoreSnapshot,
    fitCameraToScene,
    focusOnSelection,
  }
}

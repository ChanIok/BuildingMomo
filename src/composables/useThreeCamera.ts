import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  type Ref,
} from 'vue'
import { useRafFn } from '@vueuse/core'
import { useInputState } from './useInputState'

// ============================================================
// 📦 Types & Constants
// ============================================================

type Vec3 = [number, number, number]

export type ViewPreset = 'perspective' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

// 视图预设配置
interface ViewPresetConfig {
  direction: Vec3 // 相机相对于目标的方向（单位向量）
  up: Vec3 // 相机的上方向
}

export const VIEW_PRESETS: Record<ViewPreset, ViewPresetConfig> = {
  perspective: {
    direction: [0.6, 0.8, 0.6],
    up: [0, 1, 0],
  },
  top: {
    direction: [0, 1, 0],
    up: [0, 0, -1],
  },
  bottom: {
    direction: [0, -1, 0],
    up: [0, 0, 1],
  },
  front: {
    direction: [0, 0, 1],
    up: [0, 1, 0],
  },
  back: {
    direction: [0, 0, -1],
    up: [0, 1, 0],
  },
  right: {
    direction: [1, 0, 0],
    up: [0, 1, 0],
  },
  left: {
    direction: [-1, 0, 0],
    up: [0, 1, 0],
  },
}

// 相机模式：使用判别联合确保类型安全
type CameraMode =
  | { kind: 'orbit'; projection: 'perspective' | 'orthographic'; target: Vec3 }
  | { kind: 'flight' }

// 相机状态：单一真实来源
interface CameraState {
  position: Vec3
  target: Vec3 // lookAt 点
  yaw: number // 弧度
  pitch: number // 弧度
  viewPreset: ViewPreset | null
  up: Vec3 // 相机的上方向
}

// 配置选项
export interface CameraControllerOptions {
  baseSpeed?: number
  shiftSpeedMultiplier?: number
  mouseSensitivity?: number
  pitchLimits?: { min: number; max: number }
  minHeight?: number
}

// 依赖项
export interface CameraControllerDeps {
  isTransformDragging?: Ref<boolean>
  onOrbitTargetUpdate?: (target: Vec3) => void
}

// 对外接口
export interface CameraControllerResult {
  cameraPosition: Ref<Vec3>
  cameraLookAt: Ref<Vec3>
  cameraUp: Ref<Vec3>
  isViewFocused: Ref<boolean>
  isNavKeyPressed: Ref<boolean>
  controlMode: Ref<'orbit' | 'flight'>
  currentViewPreset: Ref<ViewPreset | null>
  isOrthographic: Ref<boolean>
  handleNavPointerDown: (evt: PointerEvent) => void
  handleNavPointerMove: (evt: PointerEvent) => void
  handleNavPointerUp: (evt: PointerEvent) => void
  setPoseFromLookAt: (position: Vec3, target: Vec3) => void
  lookAtTarget: (target: Vec3) => void
  switchToOrbitMode: () => Vec3 | null
  setViewPreset: (preset: ViewPreset, target: Vec3, distance: number) => void
}

// ============================================================
// 🔧 Utility Functions
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len === 0) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function scaleVec3(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale]
}

function addScaled(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]
}

// ============================================================
// 🎮 Main Controller
// ============================================================

export function useThreeCamera(
  options: CameraControllerOptions = {},
  deps: CameraControllerDeps = {}
): CameraControllerResult {
  // === 配置 ===
  const baseSpeed = options.baseSpeed ?? 1000
  const shiftSpeedMultiplier = options.shiftSpeedMultiplier ?? 4
  const mouseSensitivity = options.mouseSensitivity ?? 0.002
  const pitchMinRad = ((options.pitchLimits?.min ?? -90) * Math.PI) / 180
  const pitchMaxRad = ((options.pitchLimits?.max ?? 90) * Math.PI) / 180
  const minHeight = options.minHeight ?? -10000

  // ============================================================
  // 🎯 State Management
  // ============================================================

  const state = ref<CameraState>({
    position: [0, 0, 3000],
    target: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    viewPreset: 'perspective',
    up: [0, 1, 0],
  })

  const mode = ref<CameraMode>({
    kind: 'orbit',
    projection: 'perspective',
    target: [0, 0, 0],
  })

  const isViewFocused = ref(false)
  const isMiddleButtonDown = ref(false)
  let isActive = false

  // === 键盘输入：使用统一的全局输入状态管理 ===
  const { w, a, s, d, q, space, isShiftPressed: shift, isMiddleMousePressed } = useInputState()
  // ============================================================
  // 📐 Geometry Helpers
  // ============================================================

  function getForwardVector(yaw: number, pitch: number): Vec3 {
    const cosPitch = Math.cos(pitch)
    return [Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch]
  }

  function getRightVector(yaw: number): Vec3 {
    // right = forward × up (where up = [0,1,0])
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    return normalize([fz, 0, -fx])
  }

  function calculateYawPitchFromDirection(dir: Vec3): { yaw: number; pitch: number } {
    const dirNorm = normalize(dir)
    const yaw = Math.atan2(dirNorm[0], dirNorm[2])
    const pitch = clamp(Math.asin(dirNorm[1]), pitchMinRad, pitchMaxRad)
    return { yaw, pitch }
  }

  function updateLookAtFromYawPitch() {
    const forward = getForwardVector(state.value.yaw, state.value.pitch)
    state.value.target = addScaled(state.value.position, forward, 2000)
  }

  // ============================================================
  // 🎮 Mode Handlers
  // ============================================================

  // 检查是否有导航键按下
  function hasNavKeys(): boolean {
    return !!(w.value || a.value || s.value || d.value || q.value || space.value)
  }

  // 计算当前是否应该响应导航键
  const isNavKeyPressed = computed(() => {
    if (mode.value.kind !== 'flight' || !isViewFocused.value || deps.isTransformDragging?.value) {
      return false
    }
    return hasNavKeys()
  })

  // Flight 模式更新
  function updateFlightMode(deltaSeconds: number) {
    if (!hasNavKeys() || !isViewFocused.value || deps.isTransformDragging?.value) {
      return
    }

    const forward = getForwardVector(state.value.yaw, state.value.pitch)
    const right = getRightVector(state.value.yaw)
    const up: Vec3 = [0, 1, 0]

    let move: Vec3 = [0, 0, 0]

    const push = (dir: Vec3, sign: number) => {
      move = [move[0] + dir[0] * sign, move[1] + dir[1] * sign, move[2] + dir[2] * sign]
    }

    if (w.value) push(forward, 1)
    if (s.value) push(forward, -1)
    if (a.value) push(right, 1)
    if (d.value) push(right, -1)
    if (space.value) push(up, 1)
    if (q.value) push(up, -1)

    const moveNorm = normalize(move)
    if (moveNorm[0] === 0 && moveNorm[1] === 0 && moveNorm[2] === 0) return

    // 应用速度
    const speedMultiplier = shift.value ? shiftSpeedMultiplier : 1
    const distance = baseSpeed * deltaSeconds * speedMultiplier
    const newPos = addScaled(state.value.position, moveNorm, distance)

    // 高度限制
    if (newPos[1] < minHeight) {
      newPos[1] = minHeight
    }

    state.value.position = newPos
    updateLookAtFromYawPitch()
  }

  // ============================================================
  // 🔄 Mode Transitions
  // ============================================================

  function switchToFlightMode() {
    if (mode.value.kind === 'flight') return
    mode.value = { kind: 'flight' }
  }

  function switchToOrbitMode(): Vec3 | null {
    if (mode.value.kind === 'orbit') return null

    // 计算前方焦点作为新 target
    const forward = getForwardVector(state.value.yaw, state.value.pitch)
    const newTarget = addScaled(state.value.position, forward, 2000)

    mode.value = {
      kind: 'orbit',
      projection: 'perspective',
      target: newTarget,
    }

    return newTarget
  }

  // ============================================================
  // ⌨️ Input Processing
  // ============================================================

  function handleNavPointerDown(evt: PointerEvent) {
    if (deps.isTransformDragging?.value) return
    isViewFocused.value = true

    // 中键在 flight 模式下控制视角
    if (evt.button === 1 && mode.value.kind === 'flight') {
      isMiddleButtonDown.value = true
      evt.preventDefault()
    }
  }

  function handleNavPointerMove(evt: PointerEvent) {
    if (!isMiddleButtonDown.value || mode.value.kind !== 'flight') return
    if (deps.isTransformDragging?.value) return

    // 手动旋转 → 退出预设视图
    state.value.viewPreset = null

    // 更新 yaw/pitch
    state.value.yaw -= evt.movementX * mouseSensitivity
    state.value.pitch = clamp(
      state.value.pitch - evt.movementY * mouseSensitivity,
      pitchMinRad,
      pitchMaxRad
    )

    updateLookAtFromYawPitch()
  }

  function handleNavPointerUp(evt: PointerEvent) {
    // 中键释放 或 鼠标离开画布时，都清理中键拖拽状态
    // （pointerleave 事件的 button 属性可能不准确，所以需要显式处理）
    if (evt.button === 1 || evt.type === 'pointerleave') {
      isMiddleButtonDown.value = false
    }
  }

  // ============================================================
  // 🔌 Public API
  // ============================================================

  function setPoseFromLookAt(position: Vec3, target: Vec3) {
    state.value.position = [...position]
    state.value.target = [...target]

    const dir: Vec3 = [target[0] - position[0], target[1] - position[1], target[2] - position[2]]
    const { yaw, pitch } = calculateYawPitchFromDirection(dir)
    state.value.yaw = yaw
    state.value.pitch = pitch
  }

  function lookAtTarget(target: Vec3) {
    setPoseFromLookAt(state.value.position, target)
  }

  function setViewPreset(preset: ViewPreset, target: Vec3, distance: number) {
    const config = VIEW_PRESETS[preset]
    const direction = normalize(config.direction)

    const newPosition = addScaled(target, direction, distance)
    const { yaw, pitch } = calculateYawPitchFromDirection(scaleVec3(direction, -1))

    // 直接设置状态，无动画
    state.value = {
      position: newPosition,
      target: [...target],
      yaw,
      pitch,
      viewPreset: preset,
      up: [...config.up],
    }

    // 直接切换模式
    mode.value = {
      kind: 'orbit',
      projection: preset === 'perspective' ? 'perspective' : 'orthographic',
      target: [...target],
    }

    // 通知外部更新 orbit target
    if (deps.onOrbitTargetUpdate) {
      deps.onOrbitTargetUpdate(mode.value.target)
    }
  }

  // ============================================================
  // 🔁 Update Loop
  // ============================================================

  const { pause, resume } = useRafFn(
    ({ delta }) => {
      if (!isActive) return

      // 1. 在正交预设视图下，强制同步 up 向量保持坐标对齐
      if (
        mode.value.kind === 'orbit' &&
        mode.value.projection === 'orthographic' &&
        state.value.viewPreset &&
        state.value.viewPreset !== 'perspective'
      ) {
        const config = VIEW_PRESETS[state.value.viewPreset]
        state.value.up = [...config.up]
      }

      // 2. Flight 模式下更新移动
      if (mode.value.kind === 'flight') {
        updateFlightMode(delta / 1000)
      }

      // 3. Orbit 模式下检测 WASD → 切换到 flight
      if (
        mode.value.kind === 'orbit' &&
        mode.value.projection === 'perspective' &&
        hasNavKeys() &&
        isViewFocused.value &&
        !deps.isTransformDragging?.value
      ) {
        switchToFlightMode()
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

  // 监听中键释放（在画布外也能捕获）
  watch(isMiddleMousePressed, (pressed) => {
    if (!pressed) {
      isMiddleButtonDown.value = false
    }
  })

  // ============================================================
  // 📤 Return API
  // ============================================================

  return {
    // 状态（只读）
    cameraPosition: computed(() => state.value.position),
    cameraLookAt: computed(() => state.value.target),
    cameraUp: computed(() => state.value.up),
    isViewFocused,
    isNavKeyPressed,
    controlMode: computed(() => (mode.value.kind === 'flight' ? 'flight' : 'orbit')),
    currentViewPreset: computed(() => state.value.viewPreset),
    isOrthographic: computed(
      () => mode.value.kind === 'orbit' && mode.value.projection === 'orthographic'
    ),

    // 事件处理
    handleNavPointerDown,
    handleNavPointerMove,
    handleNavPointerUp,

    // 命令
    setPoseFromLookAt,
    lookAtTarget,
    switchToOrbitMode,
    setViewPreset,
  }
}

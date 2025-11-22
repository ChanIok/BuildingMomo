import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  watch,
  type Ref,
} from 'vue'
import { useRafFn, useMagicKeys } from '@vueuse/core'
import { useEditorStore } from '@/stores/editorStore'

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
  zoom: number // 缩放级别 (主要用于正交相机)
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
  cameraZoom: Ref<number>
  isViewFocused: Ref<boolean>
  isNavKeyPressed: Ref<boolean>
  controlMode: Ref<'orbit' | 'flight'>
  currentViewPreset: Ref<ViewPreset | null>
  isOrthographic: Ref<boolean>
  sceneCenter: Ref<Vec3>
  cameraDistance: Ref<number>
  handleNavPointerDown: (evt: PointerEvent) => void
  handleNavPointerMove: (evt: PointerEvent) => void
  handleNavPointerUp: (evt: PointerEvent) => void
  setPoseFromLookAt: (position: Vec3, target: Vec3) => void
  lookAtTarget: (target: Vec3) => void
  switchToOrbitMode: () => Vec3 | null
  setViewPreset: (preset: ViewPreset, target: Vec3, distance: number, newZoom?: number) => void
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
  // === 引入 Store ===
  const editorStore = useEditorStore()
  const baseSpeed = options.baseSpeed ?? 1000
  const shiftSpeedMultiplier = options.shiftSpeedMultiplier ?? 4
  const mouseSensitivity = options.mouseSensitivity ?? 0.002
  const pitchMinRad = ((options.pitchLimits?.min ?? -90) * Math.PI) / 180
  const pitchMaxRad = ((options.pitchLimits?.max ?? 90) * Math.PI) / 180
  const minHeight = options.minHeight ?? -10000

  // ============================================================
  // 🎯 State Management
  // ============================================================

  const FOV = 50 // 透视相机默认 FOV

  const state = ref<CameraState>({
    position: [0, 0, 3000],
    target: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    viewPreset: 'perspective',
    up: [0, 1, 0],
    zoom: 1,
  })

  const mode = ref<CameraMode>({
    kind: 'orbit',
    projection: 'perspective',
    target: [0, 0, 0],
  })

  const isViewFocused = ref(false)
  const isMiddleButtonDown = ref(false)
  let isActive = false

  // === 场景中心与距离计算 (Computed from Store) ===
  const sceneCenter = computed<Vec3>(() => {
    if (editorStore.items.length === 0) {
      return [0, 0, 0]
    }

    const bounds = editorStore.bounds

    // 安全检查：bounds 可能为 null
    if (!bounds) {
      return [0, 0, 0]
    }

    return [
      bounds.centerX,
      bounds.centerZ, // Z轴（高度）
      bounds.centerY,
    ]
  })

  const cameraDistance = computed(() => {
    if (editorStore.items.length === 0) {
      return 5000
    }

    const bounds = editorStore.bounds

    // 安全检查：bounds 可能为 null
    if (!bounds) {
      return 3000
    }

    const rangeX = bounds.width
    const rangeY = bounds.height
    const rangeZ = bounds.depth

    const maxRange = Math.max(rangeX, rangeY, rangeZ)
    return Math.max(maxRange * 1, 3000)
  })

  // === 响应式绑定 (Reactive Binding with Store) ===

  // 1. Sync Store (Scheme Switch) -> Internal State
  watch(
    () => editorStore.activeSchemeId,
    (newId) => {
      if (!newId) return

      const scheme = editorStore.activeScheme
      if (scheme?.viewState) {
        // 恢复状态
        restoreSnapshot(scheme.viewState)
      } else {
        // 无状态（如新导入），默认使用顶视图并聚焦到物品中心
        setViewPreset('top', sceneCenter.value, cameraDistance.value, 1)
      }
    },
    { immediate: true }
  )

  // 2. Sync Internal State -> Store (相机移动时触发)
  watch(
    state,
    (newVal) => {
      if (editorStore.activeScheme) {
        editorStore.activeScheme.viewState = {
          position: [...newVal.position],
          target: [...newVal.target],
          preset: newVal.viewPreset,
          zoom: newVal.zoom,
        }
      }
    },
    { deep: true }
  )

  // === 键盘输入 ===
  const keys = useMagicKeys()
  // 这些键在运行时总是存在，这里通过非空断言消除 TS 的 undefined 警告
  const w = keys.w!
  const a = keys.a!
  const s = keys.s!
  const d = keys.d!
  const q = keys.q!
  const space = keys.space!
  const shift = keys.shift!
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

    // 更新 yaw/pitch（透视视角下始终视为透视预设的连续变体）
    state.value.yaw -= evt.movementX * mouseSensitivity
    state.value.pitch = clamp(
      state.value.pitch - evt.movementY * mouseSensitivity,
      pitchMinRad,
      pitchMaxRad
    )

    updateLookAtFromYawPitch()
  }

  function handleNavPointerUp(evt: PointerEvent) {
    if (evt.button === 1) {
      isMiddleButtonDown.value = false
    }
  }

  // ============================================================
  // 🔌 Public API (Internal Implementation)
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

  function setViewPreset(preset: ViewPreset, target: Vec3, distance: number, newZoom?: number) {
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
      zoom: newZoom ?? (preset === 'perspective' ? 1 : state.value.zoom),
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

  function switchToViewPreset(preset: ViewPreset) {
    // 计算当前相机到目标的实际物理距离
    const dx = state.value.position[0] - state.value.target[0]
    const dy = state.value.position[1] - state.value.target[1]
    const dz = state.value.position[2] - state.value.target[2]
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    const isCurrentlyPerspective =
      state.value.viewPreset === 'perspective' ||
      (mode.value.kind === 'orbit' && mode.value.projection === 'perspective')
    const isSwitchingToPerspective = preset === 'perspective'

    // 基础距离参考（用于全景时的距离）
    const baseDistance = cameraDistance.value
    // 视锥体基准大小 (参考 ThreeEditor.vue 中的 orthoFrustum 计算：size = distance * 0.93)
    const frustumSize = baseDistance * 0.93

    let newDistance = currentDist
    let newZoom = 1

    if (isCurrentlyPerspective && !isSwitchingToPerspective) {
      // 1. 透视 -> 正交
      // 通过 Zoom 模拟远近，保持物理距离不变
      const tanHalfFov = Math.tan(((FOV / 2) * Math.PI) / 180)
      // 限制最小距离防止除零或过大
      const safeDist = Math.max(currentDist, 100)

      // 计算公式：zoom = frustumSize / (2 * dist * tan(fov/2))
      newZoom = frustumSize / (2 * safeDist * tanHalfFov)

      // 限制 Zoom 范围，防止过度放大/缩小
      newZoom = clamp(newZoom, 0.1, 20)

      // 正交视图下，相机拉远避免穿模
      newDistance = baseDistance
    } else if (!isCurrentlyPerspective && isSwitchingToPerspective) {
      // 2. 正交 -> 透视
      // 将 Zoom 转换回物理距离
      const currentZoom = state.value.zoom
      const tanHalfFov = Math.tan(((FOV / 2) * Math.PI) / 180)

      // 计算等效距离：dist = frustumSize / (2 * zoom * tan(fov/2))
      newDistance = frustumSize / (2 * currentZoom * tanHalfFov)

      // 限制距离范围
      newDistance = clamp(newDistance, 100, baseDistance * 2)

      // 透视模式 Zoom 重置为 1
      newZoom = 1
    } else if (!isCurrentlyPerspective && !isSwitchingToPerspective) {
      // 3. 正交 -> 正交
      // 保持当前的 Zoom 和物理距离
      newZoom = state.value.zoom
      newDistance = currentDist < baseDistance ? baseDistance : currentDist
    } else {
      // 4. 透视 -> 透视 (兜底处理)
      newDistance = currentDist
      newZoom = 1
    }

    // 切换视图时，使用新的距离和 Zoom
    setViewPreset(preset, state.value.target, newDistance, newZoom)
  }

  function restoreSnapshot(snapshot: {
    position: Vec3
    target: Vec3
    preset: ViewPreset | null
    zoom?: number
  }) {
    state.value.position = [...snapshot.position]
    state.value.target = [...snapshot.target]
    state.value.viewPreset = snapshot.preset
    state.value.zoom = snapshot.zoom ?? 1

    const dir: Vec3 = [
      snapshot.target[0] - snapshot.position[0],
      snapshot.target[1] - snapshot.position[1],
      snapshot.target[2] - snapshot.position[2],
    ]
    const { yaw, pitch } = calculateYawPitchFromDirection(dir)
    state.value.yaw = yaw
    state.value.pitch = pitch

    // 恢复 up 向量
    if (snapshot.preset && VIEW_PRESETS[snapshot.preset]) {
      state.value.up = [...VIEW_PRESETS[snapshot.preset].up]
    } else {
      state.value.up = [0, 1, 0]
    }

    // 恢复模式
    if (snapshot.preset && snapshot.preset !== 'perspective') {
      mode.value = {
        kind: 'orbit',
        projection: 'orthographic',
        target: [...snapshot.target],
      }
    } else {
      mode.value = {
        kind: 'orbit',
        projection: 'perspective',
        target: [...snapshot.target],
      }
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

  // ============================================================
  // 🔍 Focus & Fit Logic
  // ============================================================

  const currentViewPreset = computed(() => {
    // 透视投影下，即使没有显式预设，也统一视为 "perspective"，避免出现"自定义视角"概念
    if (state.value.viewPreset) return state.value.viewPreset
    if (mode.value.kind === 'orbit' && mode.value.projection === 'perspective') return 'perspective'
    return null
  })

  const isOrthographic = computed(
    () => mode.value.kind === 'orbit' && mode.value.projection === 'orthographic'
  )

  function fitCameraToScene() {
    // 使用当前视图预设重置；若没有预设则按透视视图处理
    const preset = currentViewPreset.value ?? 'perspective'
    // 强制使用全局场景中心和全景距离，并重置缩放为 1
    setViewPreset(preset, sceneCenter.value, cameraDistance.value, 1)
  }

  function focusOnSelection() {
    const selectedItems = editorStore.selectedItems
    if (selectedItems.length === 0) return

    // 1. 计算包围盒
    let minX = Infinity,
      maxX = -Infinity
    let minY = Infinity,
      maxY = -Infinity // Store Y (对应 World Z)
    let minZ = Infinity,
      maxZ = -Infinity // Store Z (对应 World Y)

    selectedItems.forEach((item) => {
      minX = Math.min(minX, item.x)
      maxX = Math.max(maxX, item.x)
      minY = Math.min(minY, item.y)
      maxY = Math.max(maxY, item.y)
      minZ = Math.min(minZ, item.z)
      maxZ = Math.max(maxZ, item.z)
    })

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const centerZ = (minZ + maxZ) / 2

    // 转换为世界坐标: X->X, Z->Y, Y->Z
    const target: Vec3 = [centerX, centerZ, centerY]

    const sizeX = maxX - minX
    const sizeY = maxZ - minZ // World Y
    const sizeZ = maxY - minY // World Z
    const maxDim = Math.max(sizeX, sizeY, sizeZ)

    // 确保切换到 Orbit 模式
    switchToOrbitMode()
    // 更新内部 target 状态
    mode.value = { ...mode.value, target: [...target] } as any
    if (deps.onOrbitTargetUpdate) {
      deps.onOrbitTargetUpdate(target)
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
      // 获取当前视锥体高度基准 (zoom=1时的高度)
      // 参考 ThreeEditor 中的计算：size = distance * 0.93
      const frustumHeight = cameraDistance.value * 0.93

      // 计算目标需要的视口大小
      const requiredSize = Math.max(maxDim, 100) * 1.2

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
      // FOV 默认 50
      const k = Math.tan((FOV * Math.PI) / 360) // tan(fov/2)
      // distance = (objectSize / 2) / tan(fov/2)
      let dist = maxDim / 2 / k
      dist = Math.max(dist, 1376) * 1.2

      const newPos: Vec3 = [
        target[0] + backX * dist,
        target[1] + backY * dist,
        target[2] + backZ * dist,
      ]

      setPoseFromLookAt(newPos, target)
      state.value.zoom = 1 // 透视模式重置 Zoom
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
    controlMode: computed(() => (mode.value.kind === 'flight' ? 'flight' : 'orbit')),
    currentViewPreset,
    isOrthographic,
    sceneCenter,
    cameraDistance,

    // 事件处理
    handleNavPointerDown,
    handleNavPointerMove,
    handleNavPointerUp,

    // 命令
    setPoseFromLookAt,
    setZoom: (zoom: number) => {
      state.value.zoom = zoom
    },
    lookAtTarget,
    switchToOrbitMode,
    setViewPreset,
    switchToViewPreset,
    restoreSnapshot,
    fitCameraToScene,
    focusOnSelection,
  }
}

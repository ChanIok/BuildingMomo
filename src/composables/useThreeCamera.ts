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
import { calculateBounds } from '@/lib/geometry'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import {
  computeViewPose,
  computeZoomConversion,
  getForwardVector,
  getRightVector,
  calculateYawPitchFromDirection,
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
  controlMode: Ref<ControlMode>
  isOrthographic: Ref<boolean>
  sceneCenter: Ref<Vec3>
  cameraDistance: Ref<number>
  handleNavPointerDown: (evt: PointerEvent) => void
  handleNavPointerMove: (evt: PointerEvent) => void
  handleNavPointerUp: (evt: PointerEvent) => void
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
  options: CameraControllerOptions = {},
  deps: CameraControllerDeps = {}
): CameraControllerResult {
  // === 引入 Store ===
  const editorStore = useEditorStore()
  const uiStore = useUIStore()
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
    position: [0, 3000, 3000], // Z-up: height in Z
    target: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    up: [0, 0, 1], // Z-up default
    zoom: 1,
  })

  const controlMode = ref<ControlMode>('orbit')

  const isViewFocused = ref(false)
  const isMiddleButtonDown = ref(false)
  let isActive = false

  // === 派生状态 (Computed) ===
  const currentViewPreset = computed(() => uiStore.currentViewPreset)
  const isOrthographic = computed(() => currentViewPreset.value !== 'perspective')

  // === 场景中心与距离计算 ===
  const sceneCenter = computed<Vec3>(() => {
    const items = editorStore.activeScheme?.items.value ?? []
    if (items.length === 0) {
      return deps.defaultCenter?.value ?? [0, 0, 0]
    }

    const bounds = calculateBounds(items)

    // 安全检查：bounds 可能为 null
    if (!bounds) {
      return [0, 0, 0]
    }

    return [
      bounds.centerX,
      -bounds.centerY,
      bounds.centerZ, // Z-up: Z is height
    ]
  })

  // 默认基准距离 (用于正交视锥体计算等)
  const cameraDistance = ref(40000)

  function updateCameraDistance() {
    const items = editorStore.activeScheme?.items.value ?? []
    if (items.length === 0) {
      cameraDistance.value = 40000
      return
    }

    const bounds = calculateBounds(items)
    if (!bounds) {
      cameraDistance.value = 3000
      return
    }

    const maxRange = Math.max(bounds.width, bounds.height, bounds.depth)
    cameraDistance.value = Math.max(maxRange * 1, 3000)
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
        switchToViewPreset('top')
        state.value.target = [...sceneCenter.value]
        state.value.zoom = 1
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

  // === 自动同步 target 到外部 (OrbitControls) ===
  watch(
    () => state.value.target,
    (newTarget) => {
      if (controlMode.value === 'orbit' && deps.onOrbitTargetUpdate) {
        deps.onOrbitTargetUpdate(newTarget)
      }
    },
    { deep: true }
  )

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
    const { yaw, pitch } = calculateYawPitchFromDirection(dir, pitchMinRad, pitchMaxRad)
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

    const distance = baseSpeed * deltaSeconds * speedMultiplier
    return scaleVec3(moveNorm, distance)
  }

  // 计算当前是否应该响应导航键
  const isNavKeyPressed = computed(() => {
    if (controlMode.value !== 'flight' || !isViewFocused.value || deps.isTransformDragging?.value) {
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
    const up: Vec3 = [0, 0, 1] // Z-up

    // 应用速度
    const speedMultiplier = shift.value ? shiftSpeedMultiplier : 1
    const deltaVec = calculateMovementDelta(forward, right, up, deltaSeconds, speedMultiplier)

    if (!deltaVec) return

    const newPos: Vec3 = [
      state.value.position[0] + deltaVec[0],
      state.value.position[1] + deltaVec[1],
      state.value.position[2] + deltaVec[2],
    ]

    // 高度限制 (Z axis)
    if (newPos[2] < minHeight) {
      newPos[2] = minHeight
    }

    state.value.position = newPos
    updateLookAtFromYawPitch()
  }

  // ============================================================
  // 🔄 Mode Transitions
  // ============================================================

  function switchToFlightMode() {
    if (controlMode.value === 'flight') return
    controlMode.value = 'flight'
  }

  function toggleCameraMode() {
    if (controlMode.value === 'orbit') {
      switchToFlightMode()
    } else {
      switchToOrbitMode()
    }
  }

  function switchToOrbitMode(): Vec3 | null {
    if (controlMode.value === 'orbit') return null

    // 计算前方焦点作为新 target
    const forward = getForwardVector(state.value.yaw, state.value.pitch)
    const newTarget = addScaled(state.value.position, forward, 2000)

    // 更新 state.target，watch 会自动同步到 OrbitControls
    state.value.target = [...newTarget]

    controlMode.value = 'orbit'

    return newTarget
  }

  // ============================================================
  // ⌨️ Input Processing
  // ============================================================

  function handleNavPointerDown(evt: PointerEvent) {
    if (deps.isTransformDragging?.value) return
    isViewFocused.value = true

    // 中键在 flight 模式下控制视角
    if (evt.button === 1 && controlMode.value === 'flight') {
      isMiddleButtonDown.value = true
      evt.preventDefault()
    }
  }

  function handleNavPointerMove(evt: PointerEvent) {
    if (!isMiddleButtonDown.value || controlMode.value !== 'flight') return
    if (deps.isTransformDragging?.value) return

    // 更新 yaw/pitch（透视视角下始终视为透视预设的连续变体）
    state.value.yaw += evt.movementX * mouseSensitivity
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
    const { yaw, pitch } = calculateYawPitchFromDirection(dir, pitchMinRad, pitchMaxRad)
    state.value.yaw = yaw
    state.value.pitch = pitch
  }

  function lookAtTarget(target: Vec3) {
    setPoseFromLookAt(state.value.position, target)
  }

  /**
   * 切换视图预设（唯一公开 API）
   * 自动处理透视↔正交的 zoom/distance 转换
   */
  function switchToViewPreset(preset: ViewPreset) {
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
      cameraDistance.value
    )

    // 3. 计算新姿态（含 WCS 旋转）
    const { position, up, yaw, pitch } = computeViewPose(
      preset,
      state.value.target,
      newDistance,
      uiStore.workingCoordinateSystem,
      { min: pitchMinRad, max: pitchMaxRad }
    )

    // 4. 更新状态（单次赋值）
    state.value.position = position
    state.value.up = up
    state.value.yaw = yaw
    state.value.pitch = pitch
    state.value.zoom = newZoom

    // 5. 更新 UI Store（唯一写入点）
    uiStore.setCurrentViewPreset(preset)

    // 6. 更新控制模式
    controlMode.value = 'orbit'

    // target 的同步由 watch 自动处理
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
      { min: pitchMinRad, max: pitchMaxRad }
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

    // 5. 恢复控制模式
    controlMode.value = 'orbit'

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
        const forward: Vec3 = [Math.sin(state.value.yaw), Math.cos(state.value.yaw), 0]
        const right: Vec3 = [Math.cos(state.value.yaw), -Math.sin(state.value.yaw), 0]
        const up: Vec3 = [0, 0, 1]

        const speedMultiplier = shift.value ? shiftSpeedMultiplier : 1
        const deltaVec = calculateMovementDelta(forward, right, up, delta / 1000, speedMultiplier)

        if (deltaVec) {
          // 同时更新 position 和 target，保持相对视角不变，实现“平移”
          const newPos: Vec3 = [
            state.value.position[0] + deltaVec[0],
            state.value.position[1] + deltaVec[1],
            state.value.position[2] + deltaVec[2],
          ]

          // 高度限制 (Z axis)
          if (newPos[2] < minHeight) {
            // 如果被限制了，只调整 Z 分量
            const zDiff = minHeight - newPos[2]
            newPos[2] = minHeight
            // deltaVec 的 Z 分量也需要相应调整，以保证 target 同步
            deltaVec[2] += zDiff
          }

          state.value.position = newPos
          state.value.target = [
            state.value.target[0] + deltaVec[0],
            state.value.target[1] + deltaVec[1],
            state.value.target[2] + deltaVec[2],
          ]

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
    // 更新基准距离以适配当前场景
    updateCameraDistance()
    // 使用当前视图预设重置；若没有预设则按透视视图处理
    const preset = currentViewPreset.value
    // 强制使用全局场景中心和全景距离，并重置缩放为 1
    switchToViewPreset(preset)
    // 覆盖 target 为场景中心
    state.value.target = [...sceneCenter.value]
    state.value.zoom = 1
  }

  function focusOnSelection() {
    const scheme = editorStore.activeScheme
    if (!scheme) return

    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return

    const selectedItems = scheme.items.value.filter((item) => selectedIds.has(item.internalId))
    if (selectedItems.length === 0) return

    const bounds = calculateBounds(selectedItems)
    if (!bounds) return

    // Z-up: Y 取反适配 Three.js 坐标系
    const target: Vec3 = [bounds.centerX, -bounds.centerY, bounds.centerZ]

    const maxDim = Math.max(bounds.width, bounds.height, bounds.depth)

    // 特殊处理 Flight 模式：仅瞬移，不切换模式
    if (controlMode.value === 'flight') {
      // 计算理想距离 (复用透视视图计算)
      const k = Math.tan((FOV * Math.PI) / 360)
      let dist = maxDim / 2 / k
      dist = Math.max(dist, 1376) * 1.2

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

    // 否则：切换到 Orbit 模式
    switchToOrbitMode()
    // 更新内部 target 状态，watch 会自动同步到 OrbitControls

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
    controlMode,
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
    toggleCameraMode,
    switchToOrbitMode,
    switchToViewPreset,
    restoreSnapshot,
    fitCameraToScene,
    focusOnSelection,
  }
}

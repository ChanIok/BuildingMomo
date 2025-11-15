import { ref, onMounted, onUnmounted, onActivated, onDeactivated, type Ref, computed } from 'vue'
import { useRafFn, useMagicKeys, clamp } from '@vueuse/core'

type Vec3Tuple = [number, number, number]

export interface ThreeNavigationOptions {
  /** 基础移动速度，单位：world units / 秒 */
  baseSpeed?: number
  /** 鼠标灵敏度：每像素对应的弧度 */
  mouseSensitivity?: number
  /** 俯仰角限制（单位：度） */
  pitchLimits?: { min: number; max: number }
  /** 相机高度下限（world Y 坐标） */
  minHeight?: number
}

export interface ThreeNavigationDeps {
  /** 拖动 Transform Gizmo 时禁用导航 */
  isTransformDragging?: Ref<boolean>
  /** 当导航系统更新相机位置/朝向时，同步更新 OrbitControls 的 target */
  onOrbitTargetUpdate?: (target: Vec3Tuple) => void
}

export interface ThreeNavigationResult {
  /** 相机位置，绑定到 <TresPerspectiveCamera :position> */
  cameraPosition: Ref<Vec3Tuple>
  /** 相机当前的观察点，通常为 position + forward * 常数距离 */
  cameraLookAt: Ref<Vec3Tuple>

  /** 3D 视图是否获得了键盘焦点（WASD 是否生效） */
  isViewFocused: Ref<boolean>
  /** 当前是否有导航按键（WASD/Q/Space）按下 */
  isNavKeyPressed: Ref<boolean>

  /** 导航层的 pointer 事件处理函数（容器上转发）：用于标记 3D 视图获得键盘焦点 */
  handleNavPointerDown: (evt: PointerEvent) => void

  /** 根据给定 position / target 设置相机姿态（用于重置视图、聚焦场景） */
  setPoseFromLookAt: (position: Vec3Tuple, target: Vec3Tuple) => void
  /** 仅改变观察目标，保持当前位置不变（用于聚焦选中） */
  lookAtTarget: (target: Vec3Tuple) => void
}

export function useThreeNavigation(
  options: ThreeNavigationOptions = {},
  deps: ThreeNavigationDeps = {}
): ThreeNavigationResult {
  // === 配置 ===
  const baseSpeed = options.baseSpeed ?? 800 // 结合当前坐标尺度，属于中等速度
  const pitchMinRad = ((options.pitchLimits?.min ?? -80) * Math.PI) / 180
  const pitchMaxRad = ((options.pitchLimits?.max ?? 80) * Math.PI) / 180
  const minHeight = options.minHeight ?? -10000

  // === 对外暴露的状态 ===
  const cameraPosition = ref<Vec3Tuple>([0, 0, 3000])
  const cameraLookAt = ref<Vec3Tuple>([0, 0, 0])

  const isViewFocused = ref(false)

  // === 内部姿态状态（弧度制） ===
  let yaw = 0 // 绕世界 Y 轴，水平旋转
  let pitch = 0 // 绕相机局部 X 轴，俯仰

  // 是否激活（用于控制生命周期）
  let isActive = false

  // === 使用 VueUse 的 useMagicKeys 监听按键 ===
  const keys = useMagicKeys()
  const { w, a, s, d, q, space } = keys

  // 计算当前是否有导航键按下（仅在视图聚焦且未拖动时生效）
  const isNavKeyPressed = computed(() => {
    if (!isViewFocused.value || deps.isTransformDragging?.value) {
      return false
    }
    return w?.value || a?.value || s?.value || d?.value || q?.value || space?.value || false
  })

  // === 工具函数 ===

  function getForward(): Vec3Tuple {
    // 约定：yaw=0, pitch=0 时朝 +Z 看
    const cosPitch = Math.cos(pitch)
    return [Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch]
  }

  function getRight(): Vec3Tuple {
    // right = forward × up，其中 up = (0,1,0)
    const [fx, , fz] = getForward()
    // forward × up = (fz, 0, -fx)
    const x = fz
    const y = 0
    const z = -fx
    const len = Math.hypot(x, y, z)
    if (len === 0) return [1, 0, 0]
    return [x / len, y / len, z / len]
  }

  function updateCameraLookAt() {
    const [px, py, pz] = cameraPosition.value
    const [fx, fy, fz] = getForward()
    const distance = 1000 // 只影响 lookAt 距离，不影响旋转方向
    cameraLookAt.value = [px + fx * distance, py + fy * distance, pz + fz * distance]

    // 同步更新 OrbitControls 的 target，使其跟随相机前方
    if (deps.onOrbitTargetUpdate && isNavKeyPressed.value) {
      deps.onOrbitTargetUpdate(cameraLookAt.value)
    }
  }

  function normalize(v: Vec3Tuple): Vec3Tuple {
    const len = Math.hypot(v[0], v[1], v[2])
    if (len === 0) return [0, 0, 0]
    return [v[0] / len, v[1] / len, v[2] / len]
  }

  function addScaled(a: Vec3Tuple, b: Vec3Tuple, scale: number): Vec3Tuple {
    return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]
  }

  // 从 position/target 反推 yaw/pitch，并更新 lookAt
  function setPoseFromLookAt(position: Vec3Tuple, target: Vec3Tuple) {
    cameraPosition.value = [...position]

    const dir: Vec3Tuple = [
      target[0] - position[0],
      target[1] - position[1],
      target[2] - position[2],
    ]
    const dirNorm = normalize(dir)

    // 根据 dirNorm 计算 yaw/pitch，使得 getForward() 对齐这个方向
    // yaw = atan2(x, z)，pitch = asin(y)
    yaw = Math.atan2(dirNorm[0], dirNorm[2])
    pitch = clamp(Math.asin(dirNorm[1]), pitchMinRad, pitchMaxRad)

    updateCameraLookAt()
  }

  function lookAtTarget(target: Vec3Tuple) {
    setPoseFromLookAt(cameraPosition.value, target)
  }

  // === 使用 VueUse 的 useRafFn 实现更新循环 ===
  function step(deltaSeconds: number) {
    // 检查是否有按键按下且满足条件
    if (!isNavKeyPressed.value) return

    const forward = getForward()
    const right = getRight()
    const up: Vec3Tuple = [0, 1, 0]

    let move: Vec3Tuple = [0, 0, 0]

    const push = (dir: Vec3Tuple, sign: number) => {
      move = [move[0] + dir[0] * sign, move[1] + dir[1] * sign, move[2] + dir[2] * sign]
    }

    if (w?.value) push(forward, 1)
    if (s?.value) push(forward, -1)
    // A = 向左移动，D = 向右移动，这里根据用户体验调整方向
    if (a?.value) push(right, 1)
    if (d?.value) push(right, -1)
    if (space?.value) push(up, 1)
    if (q?.value) push(up, -1)

    const moveNorm = normalize(move)
    if (moveNorm[0] === 0 && moveNorm[1] === 0 && moveNorm[2] === 0) return

    const distance = baseSpeed * deltaSeconds
    const newPos = addScaled(cameraPosition.value, moveNorm, distance)

    // 高度下限限制
    if (newPos[1] < minHeight) {
      newPos[1] = minHeight
    }

    cameraPosition.value = newPos
    updateCameraLookAt()
  }

  // 使用 useRafFn 替代手动 RAF 循环
  const { pause, resume } = useRafFn(
    ({ delta }) => {
      if (!isActive) return
      const deltaSeconds = delta / 1000 // delta 是毫秒，转换为秒
      step(deltaSeconds)
    },
    { immediate: false }
  )

  // === Pointer：仅负责 3D 视图焦点管理（用于启用 WASD/Q/Space 键盘导航） ===
  function handleNavPointerDown(_evt: PointerEvent) {
    // 任意在 3D 区域点击，都视为视图获得焦点
    if (deps.isTransformDragging?.value) return
    isViewFocused.value = true
  }

  // === 生命周期管理：KeepAlive 友好 ===
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

  return {
    cameraPosition,
    cameraLookAt,
    isViewFocused,
    isNavKeyPressed,
    handleNavPointerDown,
    setPoseFromLookAt,
    lookAtTarget,
  }
}

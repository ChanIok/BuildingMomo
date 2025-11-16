import {
  ref,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  watch,
  type Ref,
  computed,
} from 'vue'
import { useRafFn, useMagicKeys, clamp } from '@vueuse/core'

type Vec3Tuple = [number, number, number]

// 视图预设类型
export type ViewPreset = 'perspective' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

// 视图预设配置（相对于目标点的方向向量）
interface ViewPresetConfig {
  // 相机应该在目标点的哪个方向（单位向量）
  direction: Vec3Tuple
  // 相机的上方向（用于正确的视角方向）
  up: Vec3Tuple
}

// 视图预设配置表
const VIEW_PRESETS: Record<ViewPreset, ViewPresetConfig> = {
  perspective: {
    direction: [0.6, 0.8, 0.6], // 默认等距视角
    up: [0, 1, 0],
  },
  top: {
    direction: [0, 1, 0], // 从上往下看
    up: [0, 0, -1], // 上方向指向-Z（屏幕上方对应游戏世界的前方）
  },
  bottom: {
    direction: [0, -1, 0], // 从下往上看
    up: [0, 0, 1],
  },
  front: {
    direction: [0, 0, 1], // 从前往后看（+Z看向-Z）
    up: [0, 1, 0],
  },
  back: {
    direction: [0, 0, -1], // 从后往前看
    up: [0, 1, 0],
  },
  right: {
    direction: [1, 0, 0], // 从右往左看
    up: [0, 1, 0],
  },
  left: {
    direction: [-1, 0, 0], // 从左往右看
    up: [0, 1, 0],
  },
}

export interface ThreeNavigationOptions {
  /** 基础移动速度，单位：world units / 秒 */
  baseSpeed?: number
  /** 鼠标灵敏度：每像素对应的弧度 */
  mouseSensitivity?: number
  /** 俯仰角限制（单位：度） */
  pitchLimits?: { min: number; max: number }
  /** 相机高度下限（world Y 坐标） */
  minHeight?: number
  /** Shift 键加速倍数 */
  shiftSpeedMultiplier?: number
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
  /** 当前控制模式：orbit（轨道）或 flight（飞行） */
  controlMode: Ref<'orbit' | 'flight'>
  /** 当前视图预设（如果手动旋转则为 null） */
  currentViewPreset: Ref<ViewPreset | null>
  /** 当前是否为正交视图（六个方向视图） */
  isOrthographic: Ref<boolean>

  /** 导航层的 pointer 事件处理函数（容器上转发）：用于标记 3D 视图获得键盘焦点 */
  handleNavPointerDown: (evt: PointerEvent) => void
  /** 导航层的 pointer move 事件处理函数：用于 flight 模式下中键控制视角 */
  handleNavPointerMove: (evt: PointerEvent) => void
  /** 导航层的 pointer up 事件处理函数：用于释放中键状态 */
  handleNavPointerUp: (evt: PointerEvent) => void

  /** 根据给定 position / target 设置相机姿态（用于重置视图、聚焦场景） */
  setPoseFromLookAt: (position: Vec3Tuple, target: Vec3Tuple) => void
  /** 仅改变观察目标，保持当前位置不变（用于聚焦选中） */
  lookAtTarget: (target: Vec3Tuple) => void
  /** 切换到 orbit 模式，返回新的 orbitTarget（用于 focus 功能） */
  switchToOrbitMode: () => Vec3Tuple | null
  /** 切换到预设视图（带平滑动画） */
  setViewPreset: (preset: ViewPreset, target: Vec3Tuple, distance: number) => void
}

export function useThreeNavigation(
  options: ThreeNavigationOptions = {},
  deps: ThreeNavigationDeps = {}
): ThreeNavigationResult {
  // === 配置 ===
  const baseSpeed = options.baseSpeed ?? 1000 // 结合当前坐标尺度，属于中等速度
  const shiftSpeedMultiplier = options.shiftSpeedMultiplier ?? 4
  const pitchMinRad = ((options.pitchLimits?.min ?? -90) * Math.PI) / 180
  const pitchMaxRad = ((options.pitchLimits?.max ?? 90) * Math.PI) / 180
  const minHeight = options.minHeight ?? -10000

  // === 对外暴露的状态 ===
  const cameraPosition = ref<Vec3Tuple>([0, 0, 3000])
  const cameraLookAt = ref<Vec3Tuple>([0, 0, 0])

  const isViewFocused = ref(false)
  const controlMode = ref<'orbit' | 'flight'>('orbit')
  const isMiddleButtonDown = ref(false)
  const currentViewPreset = ref<ViewPreset | null>('perspective')

  // 判断当前是否为正交视图（六个方向视图）
  const isOrthographic = computed(() => {
    return currentViewPreset.value !== null && currentViewPreset.value !== 'perspective'
  })

  // 动画状态
  let animationFrameId: number | null = null
  let animationStartTime = 0
  let animationDuration = 500 // 毫秒
  let animationStartPos: Vec3Tuple = [0, 0, 0]
  let animationEndPos: Vec3Tuple = [0, 0, 0]
  let animationStartTarget: Vec3Tuple = [0, 0, 0]
  let animationEndTarget: Vec3Tuple = [0, 0, 0]

  // === 内部姿态状态（弧度制） ===
  let yaw = 0 // 绕世界 Y 轴，水平旋转
  let pitch = 0 // 绕相机局部 X 轴，俯仰

  // 是否激活（用于控制生命周期）
  let isActive = false

  // === 使用 VueUse 的 useMagicKeys 监听按键 ===
  const keys = useMagicKeys()
  const { w, a, s, d, q, space, shift, tab } = keys

  // 计算当前是否有导航键按下（仅在 flight 模式、视图聚焦、未拖动且非正交视图时生效）
  const isNavKeyPressed = computed(() => {
    if (
      controlMode.value !== 'flight' ||
      !isViewFocused.value ||
      deps.isTransformDragging?.value ||
      isOrthographic.value
    ) {
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
    const distance = 2000 // 只影响 lookAt 距离，不影响旋转方向
    cameraLookAt.value = [px + fx * distance, py + fy * distance, pz + fz * distance]
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

  // 缓动函数（ease-in-out）
  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  // 线性插值
  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  // 向量插值
  function lerpVec3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
  }

  // 动画更新函数
  function animateCamera(timestamp: number) {
    const elapsed = timestamp - animationStartTime
    const progress = Math.min(elapsed / animationDuration, 1)
    const easedProgress = easeInOutCubic(progress)

    // 插值相机位置
    const newPos = lerpVec3(animationStartPos, animationEndPos, easedProgress)
    cameraPosition.value = newPos

    // 插值观察目标
    const newTarget = lerpVec3(animationStartTarget, animationEndTarget, easedProgress)
    cameraLookAt.value = newTarget

    // 同步更新内部姿态（yaw/pitch）
    const dir: Vec3Tuple = [
      newTarget[0] - newPos[0],
      newTarget[1] - newPos[1],
      newTarget[2] - newPos[2],
    ]
    const dirNorm = normalize(dir)
    yaw = Math.atan2(dirNorm[0], dirNorm[2])
    pitch = clamp(Math.asin(dirNorm[1]), pitchMinRad, pitchMaxRad)

    // 继续动画或结束
    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animateCamera)
    } else {
      animationFrameId = null
      // 动画结束后，如果需要更新 orbitTarget
      if (deps.onOrbitTargetUpdate) {
        deps.onOrbitTargetUpdate(animationEndTarget)
      }
    }
  }

  // 停止当前动画
  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  // 切换到预设视图（带平滑动画）
  function setViewPreset(preset: ViewPreset, target: Vec3Tuple, distance: number) {
    // 停止当前动画
    stopAnimation()

    // 切换到 Orbit 模式
    if (controlMode.value !== 'orbit') {
      controlMode.value = 'orbit'
    }

    // 获取预设配置
    const config = VIEW_PRESETS[preset]
    const dir = config.direction

    // 归一化方向向量
    const dirNorm = normalize(dir)

    // 计算相机位置：目标点 + 方向 * 距离
    const newPos: Vec3Tuple = [
      target[0] + dirNorm[0] * distance,
      target[1] + dirNorm[1] * distance,
      target[2] + dirNorm[2] * distance,
    ]

    // 设置动画起始和结束状态
    animationStartPos = [...cameraPosition.value]
    animationEndPos = newPos
    animationStartTarget = [...cameraLookAt.value]
    animationEndTarget = target
    animationStartTime = performance.now()

    // 更新当前视图预设
    currentViewPreset.value = preset

    // 开始动画
    animationFrameId = requestAnimationFrame(animateCamera)
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

    // 应用 Shift 加速倍数
    const speedMultiplier = shift?.value ? shiftSpeedMultiplier : 1
    const distance = baseSpeed * deltaSeconds * speedMultiplier
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

  // === 键盘触发：Tab 作为双向 toggle，WASD/Q/Space 在 orbit 模式下触发进入 flight ===
  onMounted(() => {
    // Tab 切换模式
    const stopWatchTab = watch(
      () => tab?.value,
      (pressed) => {
        if (pressed && isViewFocused.value && !deps.isTransformDragging?.value) {
          toggleMode()
        }
      }
    )

    // 当 orbit 模式下检测到移动键按下，进入 flight 模式
    const stopWatchMoveKeys = watch(
      () =>
        [
          w?.value,
          a?.value,
          s?.value,
          d?.value,
          q?.value,
          space?.value,
          controlMode.value,
          isViewFocused.value,
        ] as const,
      (vals) => {
        const [wv, av, sv, dv, qv, spv, mode, focused] = vals
        if (
          mode === 'orbit' &&
          focused &&
          (wv || av || sv || dv || qv || spv) &&
          !deps.isTransformDragging?.value &&
          !isOrthographic.value  // 正交视图下不自动切换到飞行模式
        ) {
          switchToFlightMode()
        }
      }
    )

    // 清理
    onUnmounted(() => {
      stopWatchTab()
      stopWatchMoveKeys()
    })
  })

  // === 模式切换函数 ===
  function switchToFlightMode() {
    if (controlMode.value === 'flight') return
    controlMode.value = 'flight'
  }

  function switchToOrbitMode(): Vec3Tuple | null {
    if (controlMode.value === 'orbit') return null
    controlMode.value = 'orbit'

    // 计算新的 orbitTarget：相机位置 + 前方 * 2000
    const [px, py, pz] = cameraPosition.value
    const [fx, fy, fz] = getForward()
    const distance = 2000
    return [px + fx * distance, py + fy * distance, pz + fz * distance]
  }

  function toggleMode() {
    if (controlMode.value === 'orbit') {
      switchToFlightMode()
    } else {
      const newTarget = switchToOrbitMode()
      if (newTarget && deps.onOrbitTargetUpdate) {
        deps.onOrbitTargetUpdate(newTarget)
      }
    }
  }

  // === Pointer：视图焦点管理 + 中键控制视角 ===
  function handleNavPointerDown(evt: PointerEvent) {
    // 任意在 3D 区域点击，都视为视图获得焦点
    if (deps.isTransformDragging?.value) return
    isViewFocused.value = true

    // 中键（button === 1）在 flight 模式下用于控制视角
    if (evt.button === 1 && controlMode.value === 'flight') {
      isMiddleButtonDown.value = true
      evt.preventDefault()
    }
  }

  function handleNavPointerMove(evt: PointerEvent) {
    if (!isMiddleButtonDown.value || controlMode.value !== 'flight') return
    if (deps.isTransformDragging?.value) return
    // 正交视图下禁用中键旋转
    if (isOrthographic.value) return

    // 手动旋转时，退出预设视图
    currentViewPreset.value = null

    // 使用鼠标移动量更新 yaw 和 pitch
    const sensitivity = options.mouseSensitivity ?? 0.002
    yaw -= evt.movementX * sensitivity
    pitch = clamp(pitch - evt.movementY * sensitivity, pitchMinRad, pitchMaxRad)

    updateCameraLookAt()
  }

  function handleNavPointerUp(evt: PointerEvent) {
    if (evt.button === 1) {
      isMiddleButtonDown.value = false
    }
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
    stopAnimation()
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
    controlMode,
    currentViewPreset,
    isOrthographic,
    handleNavPointerDown,
    handleNavPointerMove,
    handleNavPointerUp,
    setPoseFromLookAt,
    lookAtTarget,
    switchToOrbitMode,
    setViewPreset,
  }
}

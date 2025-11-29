import { computed, type Ref } from 'vue'
import type { useUIStore } from '@/stores/uiStore'
import type { ViewPreset } from '@/composables/useThreeCamera'

// Grid 基础旋转配置 (Three.js GridHelper 默认在 XZ 平面)
// 我们需要将其旋转以面对相机
// 注意：这里使用欧拉角 [X, Y, Z]
const PRESET_ROTATIONS: Record<ViewPreset, [number, number, number]> = {
  // 透视/顶视图：Grid 位于 XY 平面 (地面)
  // GridHelper 默认 XZ -> 绕 X 转 90 度 -> XY
  perspective: [Math.PI / 2, 0, 0],
  top: [Math.PI / 2, 0, 0],

  // 底视图：Grid 位于 XY 平面，但需翻转以面对 +Z 视角的相机
  // 绕 X 转 -90 度
  bottom: [-Math.PI / 2, 0, 0],

  // 前视图 (看 +Y)：Grid 位于 XZ 平面
  // GridHelper 默认 XZ。相机看 +Y，Grid 法线默认 +Y (背对相机)。
  // 需绕 X 转 180 度 (或者 Z 转 180)，让法线朝 -Y
  front: [Math.PI, 0, 0], // 翻转 180 度

  // 后视图 (看 -Y)：Grid 位于 XZ 平面
  // 相机看 -Y，Grid 法线 +Y (面对相机)。保持默认。
  back: [0, 0, 0],

  // 右视图 (看 -X)：Grid 位于 YZ 平面
  // 需绕 Z 转 -90 度 (让 X 轴变 -Y)
  right: [0, 0, -Math.PI / 2],

  // 左视图 (看 +X)：Grid 位于 YZ 平面
  // 需绕 Z 转 90 度
  left: [0, 0, Math.PI / 2],
}

export function useThreeGrid(
  uiStore: ReturnType<typeof useUIStore>,
  basePosition: Ref<[number, number, number]>
) {
  // 计算最终的网格旋转
  const gridRotation = computed<[number, number, number]>(() => {
    const preset = uiStore.currentViewPreset || 'perspective'

    // 1. 获取基础视图旋转
    const baseRotation = PRESET_ROTATIONS[preset]

    // 2. 获取工作坐标系 (WCS) 旋转
    // 策略：仅在 Top/Bottom/Perspective 视图下应用 WCS 旋转
    // 在侧视图 (Front/Back/Left/Right) 保持世界坐标对齐，避免视觉混乱
    let wcsAngle = 0
    if (
      uiStore.workingCoordinateSystem.enabled &&
      (preset === 'perspective' || preset === 'top' || preset === 'bottom')
    ) {
      wcsAngle = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
    }

    // 如果没有 WCS 旋转，直接返回基础旋转
    if (wcsAngle === 0) {
      return baseRotation
    }

    // 3. 叠加 WCS 旋转
    // 基础旋转是 [Math.PI/2, 0, 0] (变成 XY 平面)
    // 叠加的 WCS 旋转应该是绕 Z 轴 (即世界坐标系的 Z，也就是 Grid 本地坐标系变换后的法线轴)
    // 但由于 TresJS/ThreeJS 的欧拉角顺序问题，简单的数组相加可能不对。
    // 幸好：
    // Top View (RX=90): 本地 Y 轴指向世界 -Z, 本地 Z 轴指向世界 +Y... 等等。
    // 更简单的思考：
    // 我们的 Grid 组件是处于一个 Group 中。
    // 我们可以让 Group 负责 View 的基础定位 (Face Camera)，
    // 然后 Grid 组件本身负责 WCS 旋转？
    // 或者，我们在 useThreeGrid 里计算出一个融合的 Euler。

    // 鉴于 TresJS 的响应式特性，最简单的做法是：
    // 返回两层旋转：
    // outerRotation: 用于对齐视图平面 (View Alignment)
    // innerRotation: 用于 WCS 旋转 (WCS Alignment)
    // 这样结构最清晰，避免万向节死锁或复杂的四元数计算。
    return baseRotation
  })

  // 为了支持 WCS，我们需要两层旋转结构，或者在组件里拆分。
  // 为了保持组件代码整洁，我们这里输出两个旋转值。

  // 1. 外层旋转：决定网格所在的“主平面” (XY, XZ, YZ) 以及朝向
  const containerRotation = computed<[number, number, number]>(() => {
    const preset = uiStore.currentViewPreset || 'perspective'
    return PRESET_ROTATIONS[preset]
  })

  // 2. 内层旋转：仅负责平面内的旋转 (WCS)
  const innerRotation = computed<[number, number, number]>(() => {
    const preset = uiStore.currentViewPreset || 'perspective'

    // 仅在 Top/Bottom/Perspective 显示 WCS 旋转
    const shouldApplyWCS =
      uiStore.workingCoordinateSystem.enabled &&
      (preset === 'perspective' || preset === 'top' || preset === 'bottom')

    if (!shouldApplyWCS) {
      return [0, 0, 0]
    }

    const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180

    // GridHelper 本地是 XZ 平面 (Y Up)。
    // 当 containerRotation 为 Top (RX=90) 时，Grid 被立起来变成 XY 平面 (Z Up)。
    // 此时 Grid 的本地 Y 轴指向世界 -Z，Grid 的本地 Z 轴指向世界 +Y。
    // 我们想要让 Grid 在 XY 平面上旋转，实际上是绕着 **Grid 的本地 Y 轴** 旋转吗？
    // 不，GridHelper 是 XZ 平面，法线是 Y。
    // 我们希望网格在“平面内”旋转，那就是绕着法线旋转。也就是绕着 Grid 的本地 Y 轴旋转。

    return [0, angleRad, 0]
  })

  // 计算网格位置
  const gridPosition = computed<[number, number, number]>(() => {
    const [x, y] = basePosition.value
    const preset = uiStore.currentViewPreset

    // Z-fighting 修复
    // 1. 强制基准 Z 为 0，确保网格在背景图(Z=-1)之上
    // 2. 在 Bottom 视图下，网格和背景图可能会重叠 (都由 Z 轴控制深度)，稍微偏移一点
    let zOffset = 0
    if (preset === 'bottom') {
      zOffset = -2
    }

    // Y轴取反修复：
    // 原代码中网格的位置使用了 -backgroundPosition[1]。
    // 恢复该行为以解决错位问题。
    return [x, -y, 0 + zOffset]
  })

  return {
    containerRotation, // 对应 View 预设
    innerRotation, // 对应 WCS 旋转
    gridPosition,
  }
}

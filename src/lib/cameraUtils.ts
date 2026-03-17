import type { WorkingCoordinateSystem } from '@/types/editor'
import type { ViewPreset } from '@/composables/useThreeCamera'

// ============================================================
// 📦 Types
// ============================================================

type Vec3 = [number, number, number]

export const ORTHO_BASE_FRUSTUM_HEIGHT = 3000

// 视图预设配置
interface ViewPresetConfig {
  direction: Vec3 // 相机相对于目标的方向（单位向量）
  up: Vec3 // 相机的上方向
}

// Z-Up 坐标系下的视图预设
export const VIEW_PRESETS: Record<ViewPreset, ViewPresetConfig> = {
  perspective: {
    direction: [0.6, -0.6, 0.8], // X, Y, Z (东南上方，看向西北)
    up: [0, 0, 1],
  },
  top: {
    direction: [0, 0, 1], // 顶视图：从 +Z 看向 -Z
    up: [0, 1, 0], // 上方向为 +Y
  },
  bottom: {
    direction: [0, 0, -1],
    up: [0, -1, 0],
  },
  front: {
    direction: [0, -1, 0], // 前视图：从 -Y 看向 +Y
    up: [0, 0, 1],
  },
  back: {
    direction: [0, 1, 0], // 后视图：从 +Y 看向 -Y
    up: [0, 0, 1],
  },
  right: {
    direction: [1, 0, 0], // 右视图：从 +X 看向 -X
    up: [0, 0, 1],
  },
  left: {
    direction: [-1, 0, 0], // 左视图：从 -X 看向 +X
    up: [0, 0, 1],
  },
}

// ============================================================
// 🔧 Utility Functions
// ============================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len === 0) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

export function scaleVec3(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale]
}

export function addScaled(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]
}

// ============================================================
// 📐 Geometry Helpers
// ============================================================

export function getForwardVector(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch)
  return [Math.sin(yaw) * cosPitch, Math.cos(yaw) * cosPitch, Math.sin(pitch)]
}

export function getRightVector(yaw: number): Vec3 {
  const fy = Math.cos(yaw)
  const fx = Math.sin(yaw)
  return normalize([fy, -fx, 0])
}

export function calculateYawPitchFromDirection(
  dir: Vec3,
  pitchMin: number,
  pitchMax: number
): { yaw: number; pitch: number } {
  const dirNorm = normalize(dir)
  const pitch = clamp(Math.asin(dirNorm[2]), pitchMin, pitchMax)
  const yaw = Math.atan2(dirNorm[0], dirNorm[1])
  return { yaw, pitch }
}

// ============================================================
// 🌐 Working Coordinate System (WCS)
// ============================================================

/**
 * 应用工作坐标系旋转到方向向量和上向量
 * @param direction 视线方向向量
 * @param up 上方向向量
 * @param preset 视图预设
 * @param wcs 工作坐标系配置
 * @returns 旋转后的方向和上向量
 */
export function applyWCSRotation(
  direction: Vec3,
  up: Vec3,
  preset: ViewPreset,
  wcs: WorkingCoordinateSystem
): { direction: Vec3; up: Vec3 } {
  // 透视视图或未启用 WCS 时不旋转
  const hasRotation = wcs.rotation.x !== 0 || wcs.rotation.y !== 0 || wcs.rotation.z !== 0
  if (!wcs.enabled || !hasRotation || preset === 'perspective') {
    return { direction: [...direction], up: [...up] }
  }

  // 使用负角度，使得视野顺时针旋转，与 Gizmo 和 Grid 的视觉效果一致
  // 注意：对于 top/bottom 视图，主要使用 Z 轴旋转
  const angleRad = (-wcs.rotation.z * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)

  if (preset === 'top' || preset === 'bottom') {
    // 顶/底视图：视线方向(Z轴)不变，旋转 Up 向量
    return {
      direction: [...direction],
      up: [up[0] * cos - up[1] * sin, up[0] * sin + up[1] * cos, up[2]],
    }
  } else {
    // 侧视图：旋转方向向量，Up 向量不变
    return {
      direction: [
        direction[0] * cos - direction[1] * sin,
        direction[0] * sin + direction[1] * cos,
        direction[2],
      ],
      up: [...up],
    }
  }
}

// ============================================================
// 🎥 View Preset Calculations
// ============================================================

/**
 * 计算指定视图预设的相机姿态
 * @param preset 视图预设
 * @param target 观察目标点
 * @param distance 相机到目标的距离
 * @param wcs 工作坐标系配置
 * @returns 相机位置、方向、上向量、yaw、pitch
 */
export function computeViewPose(
  preset: ViewPreset,
  target: Vec3,
  distance: number,
  wcs: WorkingCoordinateSystem,
  pitchLimits: { min: number; max: number }
): { position: Vec3; direction: Vec3; up: Vec3; yaw: number; pitch: number } {
  const config = VIEW_PRESETS[preset]
  let direction = normalize(config.direction)
  let up = [...config.up] as Vec3

  // 应用工作坐标系旋转
  const rotated = applyWCSRotation(direction, up, preset, wcs)
  direction = rotated.direction
  up = rotated.up

  // 计算相机位置 (target + direction * distance)
  const position = addScaled(target, direction, distance)

  // 计算 yaw/pitch（用于内部状态）
  const { yaw, pitch } = calculateYawPitchFromDirection(
    scaleVec3(direction, -1), // 反向：从相机指向目标
    pitchLimits.min,
    pitchLimits.max
  )

  return { position, direction, up, yaw, pitch }
}

// ============================================================
// 🔄 Zoom Conversion (Perspective ↔ Orthographic)
// ============================================================

/**
 * 计算透视↔正交视图切换时的 zoom 和 distance 转换
 * @param fromPreset 当前视图预设
 * @param toPreset 目标视图预设
 * @param currentZoom 当前 zoom
 * @param currentDistance 当前相机到目标的距离
 * @param baseDistance 场景基准距离（用于正交视图）
 * @param fov 透视相机视场角（度）
 * @returns 新的距离和 zoom
 */
export function computeZoomConversion(
  fromPreset: ViewPreset,
  toPreset: ViewPreset,
  currentZoom: number,
  currentDistance: number,
  baseDistance: number,
  fov: number = 50
): { newDistance: number; newZoom: number } {
  const isFromPerspective = fromPreset === 'perspective'
  const isToPerspective = toPreset === 'perspective'

  // 正交视图使用固定视锥体基准高度，避免视图切换受场景大小影响。
  // baseDistance 仍保留给透视视图的相机位置计算。
  const frustumSize = ORTHO_BASE_FRUSTUM_HEIGHT

  if (isFromPerspective && !isToPerspective) {
    // 1. 透视 -> 正交
    const tanHalfFov = Math.tan(((fov / 2) * Math.PI) / 180)
    const safeDist = Math.max(currentDistance, 100)

    // zoom = frustumSize / (2 * dist * tan(fov/2))
    const newZoom = clamp(frustumSize / (2 * safeDist * tanHalfFov), 0.1, 20)

    return {
      newDistance: baseDistance, // 正交视图拉远到基准距离
      newZoom,
    }
  } else if (!isFromPerspective && isToPerspective) {
    // 2. 正交 -> 透视
    const tanHalfFov = Math.tan(((fov / 2) * Math.PI) / 180)

    // dist = frustumSize / (2 * zoom * tan(fov/2))
    const newDistance = clamp(frustumSize / (2 * currentZoom * tanHalfFov), 100, baseDistance * 2)

    return {
      newDistance,
      newZoom: 1, // 透视模式重置 zoom
    }
  } else if (!isFromPerspective && !isToPerspective) {
    // 3. 正交 -> 正交：保持 zoom 和距离
    return {
      newDistance: currentDistance < baseDistance ? baseDistance : currentDistance,
      newZoom: currentZoom,
    }
  } else {
    // 4. 透视 -> 透视：保持距离，zoom = 1
    return {
      newDistance: currentDistance,
      newZoom: 1,
    }
  }
}

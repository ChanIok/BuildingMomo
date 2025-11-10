/**
 * 画布视觉元素尺寸管理
 * 负责将目标屏幕像素大小转换为世界坐标大小
 */

// 缩放响应曲线配置
const SCALE_CURVE = {
  // 使用幂函数曲线
  // 0 = 完全不变，1 = 线性跟随
  exponent: 0.9,
}

// 标点基础尺寸（屏幕像素）
const MARKER_BASE = {
  radius: 12, // 基础半径
  minRadius: 4, // 最小屏幕像素
  maxRadius: 48, // 最大屏幕像素
  strokeWidth: 1, // 基础描边宽度
  minStroke: 0.5,
  maxStroke: 2,
}

/**
 * 计算目标屏幕像素大小（带上下限）
 */
function getTargetScreenSize(baseSize: number, scale: number, min: number, max: number): number {
  const adjustedSize = baseSize * Math.pow(scale, SCALE_CURVE.exponent)
  return Math.max(min, Math.min(max, adjustedSize))
}

/**
 * 转换为世界坐标大小
 */
function toWorldSize(screenPixels: number, scale: number): number {
  return screenPixels / scale
}

export function useCanvasVisualSize() {
  return {
    /**
     * 获取标点半径（世界坐标）
     */
    getMarkerRadius: (scale: number) => {
      const screenPixels = getTargetScreenSize(
        MARKER_BASE.radius,
        scale,
        MARKER_BASE.minRadius,
        MARKER_BASE.maxRadius
      )
      return toWorldSize(screenPixels, scale)
    },

    /**
     * 获取标点描边宽度（世界坐标）
     */
    getMarkerStrokeWidth: (scale: number) => {
      const screenPixels = getTargetScreenSize(
        MARKER_BASE.strokeWidth,
        scale,
        MARKER_BASE.minStroke,
        MARKER_BASE.maxStroke
      )
      return toWorldSize(screenPixels, scale)
    },
  }
}

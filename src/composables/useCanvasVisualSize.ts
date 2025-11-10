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

// 图标基础尺寸（屏幕像素）
const ICON_BASE = {
  size: 48, // 基础尺寸
  minSize: 16, // 最小屏幕像素
  maxSize: 96, // 最大屏幕像素
  showThreshold: 1.0, // 开始显示图标的缩放阈值
  fadeEndThreshold: 1.2, // 图标完全不透明的缩放阈值
  markerHideThreshold: 1.2, // 隐藏标点的缩放阈值
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

    /**
     * 获取图标尺寸（世界坐标）
     */
    getIconSize: (scale: number) => {
      const screenPixels = getTargetScreenSize(
        ICON_BASE.size,
        scale,
        ICON_BASE.minSize,
        ICON_BASE.maxSize
      )
      return toWorldSize(screenPixels, scale)
    },

    /**
     * 判断是否应该显示图标
     */
    shouldShowIcon: (scale: number) => {
      return scale > ICON_BASE.showThreshold
    },

    /**
     * 判断是否应该显示标点
     */
    shouldShowMarker: (scale: number) => {
      return scale <= ICON_BASE.markerHideThreshold
    },

    /**
     * 获取图标透明度（渐变过渡）
     */
    getIconOpacity: (scale: number) => {
      if (scale <= ICON_BASE.showThreshold) return 0
      if (scale >= ICON_BASE.fadeEndThreshold) return 1

      // 在 showThreshold 和 fadeEndThreshold 之间线性插值
      const range = ICON_BASE.fadeEndThreshold - ICON_BASE.showThreshold
      const progress = (scale - ICON_BASE.showThreshold) / range
      return Math.max(0, Math.min(1, progress))
    },

    /**
     * 获取标点透明度（与图标相反的渐变）
     */
    getMarkerOpacity: (scale: number) => {
      if (scale <= ICON_BASE.showThreshold) return 1
      if (scale >= ICON_BASE.fadeEndThreshold) return 0

      // 在 showThreshold 和 fadeEndThreshold 之间线性插值（反向）
      const range = ICON_BASE.fadeEndThreshold - ICON_BASE.showThreshold
      const progress = (scale - ICON_BASE.showThreshold) / range
      return Math.max(0, Math.min(1, 1 - progress))
    },
  }
}

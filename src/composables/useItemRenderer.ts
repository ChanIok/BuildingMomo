import type { useEditorStore } from '../stores/editorStore'
import type { AppItem } from '../types/editor'
import { useCanvasVisualSize } from './useCanvasVisualSize'
import { getIconLoader } from './useIconLoader'

// 颜色配置常量
const ITEM_COLORS = {
  // 选中状态
  selected: {
    fill: 'rgba(59, 130, 246, 0.8)', // blue-500 with 80% opacity
    stroke: 'rgba(37, 99, 235, 1)', // blue-600 solid
  },
  // 普通标点
  normal: {
    fill: 'rgba(148, 163, 184, 0.8)', // slate-400 with 80% opacity
    stroke: 'rgba(71, 85, 105, 1)', // slate-600 solid
  },
  // 组标点描边
  group: {
    stroke: 'rgba(0, 0, 0, 0.29)', // dark semi-transparent
  },
} as const

/**
 * 物品渲染器配置
 */
export interface ItemRendererOptions {
  scale: number
  editorStore: ReturnType<typeof useEditorStore>
  skipItemCheck?: (item: AppItem) => boolean // 可选：跳过某些物品的渲染
  forceSelected?: boolean // 可选：强制显示为选中状态
}

/**
 * 创建物品渲染器
 * 提供统一的物品绘制逻辑，供主渲染层和拖拽层共享
 */
export function createItemRenderer() {
  const visualSize = useCanvasVisualSize()
  const iconLoader = getIconLoader()

  /**
   * 绘制多个物品
   */
  function drawItems(
    context: any, // Konva 的 context，兼容 CanvasRenderingContext2D
    items: AppItem[],
    options: ItemRendererOptions
  ): void {
    const { scale, editorStore, skipItemCheck, forceSelected = false } = options

    // 计算所有渲染参数
    const radius = visualSize.getMarkerRadius(scale)
    const strokeWidth = visualSize.getMarkerStrokeWidth(scale)
    const showMarker = visualSize.shouldShowMarker(scale)
    const showIcon = visualSize.shouldShowIcon(scale)
    const markerOpacity = visualSize.getMarkerOpacity(scale)
    const iconOpacity = visualSize.getIconOpacity(scale)
    const iconSize = visualSize.getIconSize(scale)

    items.forEach((item) => {
      // 跳过检查
      if (skipItemCheck && skipItemCheck(item)) return

      const isSelected = forceSelected || editorStore.selectedItemIds.has(item.internalId)
      const groupId = item.originalData.GroupID

      // 1. 绘制标点（圆形）
      if (showMarker && markerOpacity > 0) {
        context.save()
        context.globalAlpha = markerOpacity

        context.beginPath()
        context.arc(item.x, item.y, radius, 0, Math.PI * 2, false)

        // 根据状态设置颜色
        if (isSelected) {
          context.fillStyle = ITEM_COLORS.selected.fill
          context.strokeStyle = ITEM_COLORS.selected.stroke
        } else if (groupId > 0) {
          context.fillStyle = editorStore.getGroupColor(groupId)
          context.strokeStyle = ITEM_COLORS.group.stroke
        } else {
          context.fillStyle = ITEM_COLORS.normal.fill
          context.strokeStyle = ITEM_COLORS.normal.stroke
        }

        context.fill()
        context.lineWidth = strokeWidth
        context.stroke()

        context.restore()
      }

      // 2. 绘制图标
      if (showIcon && iconOpacity > 0) {
        const icon = iconLoader.getIcon(item.gameId)
        if (icon && icon.complete) {
          context.save()
          context.globalAlpha = iconOpacity

          // 绘制图标（居中）
          const halfSize = iconSize / 2
          context.drawImage(icon, item.x - halfSize, item.y - halfSize, iconSize, iconSize)

          // 绘制边框（选中状态或组状态）
          if (isSelected || groupId > 0) {
            context.beginPath()
            context.rect(item.x - halfSize, item.y - halfSize, iconSize, iconSize)

            if (isSelected) {
              context.strokeStyle = ITEM_COLORS.selected.stroke
              context.lineWidth = strokeWidth * 2
            } else {
              context.strokeStyle = editorStore.getGroupColor(groupId)
              context.lineWidth = strokeWidth * 1.5
            }

            context.stroke()
          }

          context.restore()
        }
      }
    })
  }

  /**
   * 绘制碰撞检测区域
   */
  function drawHitRegions(
    context: any, // Konva 的 context，包含 fillStrokeShape 方法
    shape: any,
    items: AppItem[],
    options: ItemRendererOptions
  ): void {
    const { scale, skipItemCheck } = options

    const showIcon = visualSize.shouldShowIcon(scale)
    const iconSize = visualSize.getIconSize(scale)
    const radius = visualSize.getMarkerRadius(scale)
    const strokeWidth = visualSize.getMarkerStrokeWidth(scale)
    const hitRadius = radius + strokeWidth / 2

    items.forEach((item) => {
      // 跳过检查
      if (skipItemCheck && skipItemCheck(item)) return

      context.beginPath()

      // 图标模式：使用矩形碰撞检测
      if (showIcon) {
        const halfSize = iconSize / 2
        context.rect(item.x - halfSize, item.y - halfSize, iconSize, iconSize)
      } else {
        // 标点模式：使用圆形碰撞检测
        context.arc(item.x, item.y, hitRadius, 0, Math.PI * 2, false)
      }

      context.fillStrokeShape(shape)
    })
  }

  /**
   * 预加载图标
   */
  function preloadIcons(items: AppItem[], scale: number): void {
    const shouldLoadIcons = visualSize.shouldShowIcon(scale)
    if (shouldLoadIcons) {
      const itemIds = items.map((item) => item.gameId)
      iconLoader.preloadIcons(itemIds).catch((err) => {
        console.warn('[ItemRenderer] Failed to preload icons:', err)
      })
    }
  }

  return {
    drawItems,
    drawHitRegions,
    preloadIcons,
  }
}

// 创建单例实例
let rendererInstance: ReturnType<typeof createItemRenderer> | null = null

/**
 * 获取渲染器单例
 */
export function getItemRenderer(): ReturnType<typeof createItemRenderer> {
  if (!rendererInstance) {
    rendererInstance = createItemRenderer()
  }
  return rendererInstance
}

/**
 * 碰撞检测：测试点击位置是否命中物品
 * 使用与渲染层一致的碰撞逻辑（圆形或方形）
 */
export function hitTestItem(
  item: AppItem,
  worldPos: { x: number; y: number },
  scale: number
): boolean {
  const visualSize = useCanvasVisualSize()
  const showIcon = visualSize.shouldShowIcon(scale)

  if (showIcon) {
    // 图标模式：矩形碰撞检测
    const iconSize = visualSize.getIconSize(scale)
    const halfSize = iconSize / 2

    return (
      worldPos.x >= item.x - halfSize &&
      worldPos.x <= item.x + halfSize &&
      worldPos.y >= item.y - halfSize &&
      worldPos.y <= item.y + halfSize
    )
  } else {
    // 标点模式：圆形碰撞检测
    const radius = visualSize.getMarkerRadius(scale)
    const strokeWidth = visualSize.getMarkerStrokeWidth(scale)
    const hitRadius = radius + strokeWidth

    const distance = Math.sqrt(Math.pow(item.x - worldPos.x, 2) + Math.pow(item.y - worldPos.y, 2))

    return distance <= hitRadius
  }
}

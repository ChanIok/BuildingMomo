import { computed, type Ref } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import type { ViewPreset } from '@/composables/useThreeCamera'

// 网格旋转配置 - 适配不同视图预设
const PRESET_ROTATIONS: Record<ViewPreset, [number, number, number]> = {
  perspective: [Math.PI / 2, 0, 0],
  top: [Math.PI / 2, 0, 0],
  bottom: [-Math.PI / 2, 0, 0],
  front: [Math.PI, 0, 0],
  back: [0, 0, 0],
  right: [0, 0, -Math.PI / 2],
  left: [0, 0, Math.PI / 2],
}

export function useThreeGrid(basePosition: Ref<[number, number, number]>) {
  const uiStore = useUIStore()

  // 外层旋转：适配视图预设
  const containerRotation = computed<[number, number, number]>(() => {
    const preset = uiStore.currentViewPreset || 'perspective'
    return PRESET_ROTATIONS[preset]
  })

  // 内层旋转：WCS（工作坐标系）平面内旋转
  const innerRotation = computed<[number, number, number]>(() => {
    const preset = uiStore.currentViewPreset || 'perspective'

    // 仅在透视/顶/底视图应用WCS旋转
    const shouldApplyWCS =
      uiStore.workingCoordinateSystem.enabled &&
      (preset === 'perspective' || preset === 'top' || preset === 'bottom')

    if (!shouldApplyWCS) {
      return [0, 0, 0]
    }

    const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
    return [0, angleRad, 0]
  })

  // 网格位置计算 - 处理Z-fighting问题
  const gridPosition = computed<[number, number, number]>(() => {
    const [x, y] = basePosition.value
    const preset = uiStore.currentViewPreset

    // 底视图特殊处理，避免Z-fighting
    let zOffset = -1
    if (preset === 'bottom') {
      zOffset = -2
    }

    // Y轴取反，匹配背景图坐标系
    return [x, -y, 0 + zOffset]
  })

  return {
    containerRotation,
    innerRotation,
    gridPosition,
  }
}

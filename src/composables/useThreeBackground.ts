import { ref, computed, onMounted, type Ref } from 'vue'
import { TextureLoader, SRGBColorSpace, type Texture } from 'three'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { ViewPreset } from './useThreeCamera'

export interface BackgroundConfig {
  /**
   * 背景图缩放因子
   */
  scale: number

  /**
   * 背景图偏移量 [xOffset, yOffset]
   * xOffset: Canvas X -> Game X 的偏移
   * yOffset: Canvas Y -> Game Y 的偏移
   */
  offset: [number, number]
}

export interface ThreeBackgroundResult {
  /** 背景纹理 */
  backgroundTexture: Ref<Texture | null>

  /** 背景图尺寸（世界坐标） */
  backgroundSize: Ref<{ width: number; height: number }>

  /** 背景图位置（Three.js 坐标系，Plane 中心点） */
  backgroundPosition: Ref<[number, number, number]>

  /** 地图中心（世界坐标） */
  mapCenter: Ref<[number, number, number]>

  /** 是否应该显示背景 */
  shouldShowBackground: Ref<boolean>

  /** 是否应该禁用地图深度写入（实现透视效果） */
  isMapDepthDisabled: Ref<boolean>
}

/**
 * 背景图管理 composable
 *
 * 负责加载背景纹理、计算位置和尺寸、管理显示条件
 */
export function useThreeBackground(
  imageUrl: string,
  config: BackgroundConfig
): ThreeBackgroundResult {
  const settingsStore = useSettingsStore()
  const uiStore = useUIStore()

  const backgroundTexture = ref<Texture | null>(null)
  const backgroundSize = ref<{ width: number; height: number }>({ width: 100, height: 100 })
  const backgroundPosition = ref<[number, number, number]>([0, 0, -50])
  const mapCenter = ref<[number, number, number]>([0, 0, 0])

  // 背景显示条件
  const shouldShowBackground = computed(() => {
    if (!settingsStore.settings.showBackground) return false

    // 仅在 顶/底/透视 视图显示，侧视图隐藏
    const currentPreset = uiStore.currentViewPreset
    const hiddenPresets: ViewPreset[] = ['front', 'back', 'left', 'right']

    if (currentPreset && hiddenPresets.includes(currentPreset)) {
      return false
    }

    return true
  })

  // 判断是否需要禁用地图深度写入（实现透视效果）
  // 当处于 图标/简易方块 模式 且 处于 顶视图/底视图 时，让地图不参与遮挡
  const isMapDepthDisabled = computed(() => {
    const currentPreset = uiStore.currentViewPreset
    const isTopOrBottom = currentPreset === 'top' || currentPreset === 'bottom'

    const displayMode = settingsStore.settings.threeDisplayMode
    const isSimpleMode = displayMode === 'icon' || displayMode === 'simple-box'

    return isTopOrBottom && isSimpleMode
  })

  // 加载背景图
  onMounted(() => {
    const loader = new TextureLoader()

    loader.load(imageUrl, (texture) => {
      texture.colorSpace = SRGBColorSpace
      backgroundTexture.value = texture

      const img = texture.image
      const scale = config.scale
      const xOffset = config.offset[0]
      const yOffset = config.offset[1]

      const width = img.width * scale
      const height = img.height * scale

      backgroundSize.value = { width, height }

      // 计算地图中心的世界坐标
      mapCenter.value = [xOffset + width / 2, yOffset + height / 2, 0]

      // ThreeEditor: x,y 是左上角
      // Three Plane: position 是中心点
      backgroundPosition.value = [
        xOffset + width / 2,
        -(yOffset + height / 2), // 对应 Game Y (Y轴取反)
        -2, // 微下移避免与网格 Z-fighting (Z-up)
      ]
    })
  })

  return {
    backgroundTexture,
    backgroundSize,
    backgroundPosition,
    mapCenter,
    shouldShowBackground,
    isMapDepthDisabled,
  }
}

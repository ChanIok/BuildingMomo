import { ref, computed, markRaw, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { DoubleSide, MeshBasicMaterial, TextureLoader, SRGBColorSpace, type Texture } from 'three'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { ViewPreset } from './useThreeCamera'
import { homeTodCurveShader, homeTodCurveUniforms } from './renderer/homeTodCurve'

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

  /** 平面绕中心的旋转（数据坐标系 Z 轴，弧度）。 */
  rotationZ?: number
}

export interface ThreeBackgroundResult {
  /** 背景纹理 */
  backgroundTexture: Ref<Texture | null>

  /** 保留白昼原图，仅按 TOD 曲线温和调整夜间显示。 */
  backgroundTodMaterial: MeshBasicMaterial

  /** 背景图尺寸（世界坐标） */
  backgroundSize: Ref<{ width: number; height: number }>

  /** 背景图位置（Three.js 坐标系，Plane 中心点） */
  backgroundPosition: Ref<[number, number, number]>

  backgroundRotation: Ref<[number, number, number]>

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
  // The overview already contains daylight and display grading. Relighting it
  // as albedo doubles that treatment; preserve the original image during day.
  const backgroundTodMaterial = markRaw(
    new MeshBasicMaterial({
      name: 'home-map-tod',
      toneMapped: false,
      side: DoubleSide,
    })
  )
  backgroundTodMaterial.onBeforeCompile = function (shader, renderer) {
    Object.assign(shader.uniforms, homeTodCurveUniforms(renderer))
    shader.fragmentShader =
      homeTodCurveShader +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
      #include <color_fragment>
      vec3 todColor = homeCloudTODColor();
      float daylight = dot(todColor, vec3(.2126, .7152, .0722));
      // Preview thresholds, not native lighting: above .5 leave the image alone,
      // below .25 halve linear brightness with only a quarter of the curve hue.
      float night = 1. - smoothstep(.25, .5, daylight);
      float peak = max(max(todColor.r, todColor.g), max(todColor.b, 1e-4));
      vec3 nightTint = .5 * mix(vec3(1.), todColor / peak, .25);
      diffuseColor.rgb *= mix(vec3(1.), nightTint, night);
    `
      )
  }
  backgroundTodMaterial.customProgramCacheKey = () => 'flat_map_tod_v2'
  const backgroundSize = ref<{ width: number; height: number }>({ width: 100, height: 100 })
  const backgroundPosition = ref<[number, number, number]>([0, 0, -50])
  const backgroundRotation = computed<[number, number, number]>(() => [0, 0, config.rotationZ ?? 0])
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

  watch(
    isMapDepthDisabled,
    (disabled) => {
      backgroundTodMaterial.depthWrite = !disabled
    },
    { immediate: true }
  )

  // 加载背景图
  let disposed = false
  onMounted(() => {
    const loader = new TextureLoader()

    loader.load(imageUrl, (texture) => {
      if (disposed) {
        texture.dispose()
        return
      }
      texture.colorSpace = SRGBColorSpace
      backgroundTodMaterial.map = texture
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

  onUnmounted(() => {
    disposed = true
    backgroundTodMaterial.dispose()
    backgroundTexture.value?.dispose()
  })

  return {
    backgroundTexture,
    backgroundTodMaterial,
    backgroundSize,
    backgroundPosition,
    backgroundRotation,
    mapCenter,
    shouldShowBackground,
    isMapDepthDisabled,
  }
}

import { TextureLoader, NearestFilter, ClampToEdgeWrapping, SRGBColorSpace } from 'three'
import type { Texture } from 'three'
import type { GameColorMap } from '@/types/editor'

// Array 贴图基础路径
const ARRAY_TEXTURE_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-model/arrays/'

// 贴图缓存：fileName → Three.js Texture
const textureCache = new Map<string, Texture>()

// 共享的 TextureLoader 实例
const textureLoader = new TextureLoader()

/**
 * 从 ColorMap 中解析颜色索引
 *
 * 规则：
 * - 对象格式 { "0": 0 } → 返回第一个值
 * - 数组格式 [null, 22] → 返回 null（多槽染色，暂不支持）
 * - undefined / 无效 → 返回 0（默认颜色）
 */
export function parseColorIndex(colorMap: GameColorMap | undefined): number | null {
  if (colorMap === undefined || colorMap === null) {
    return 0
  }

  // 数组格式 → 暂不支持多槽染色
  if (Array.isArray(colorMap)) {
    return null
  }

  // 对象格式 { "0": 0 } → 取第一个值
  if (typeof colorMap === 'object') {
    const values = Object.values(colorMap)
    if (values.length > 0 && typeof values[0] === 'number') {
      return values[0]
    }
    return 0
  }

  return 0
}

/**
 * 加载 Array 贴图为 Three.js Texture
 *
 * Array 贴图是小型调色板图（如 2×2 = 4色 或 3×3 = 9色），
 * 模型的 UV2 将每个顶点映射到对应的色块。
 * 使用 NearestFilter 避免色块间插值。
 *
 * @param textureFileName Array 贴图文件名（如 "T_NHFurn_Chair_07_Array_0.png"）
 * @returns Three.js Texture，失败返回 null
 */
export async function loadArrayTexture(textureFileName: string): Promise<Texture | null> {
  // 检查缓存
  const cached = textureCache.get(textureFileName)
  if (cached) return cached

  try {
    const url = ARRAY_TEXTURE_BASE_URL + textureFileName
    const texture = await textureLoader.loadAsync(url)

    // 关键：使用 NearestFilter 保持色块边界清晰，不插值
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
    texture.wrapS = ClampToEdgeWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.colorSpace = SRGBColorSpace
    // glTF 规范要求 flipY = false，与 GLTFLoader 加载的贴图保持一致
    texture.flipY = false
    texture.needsUpdate = true

    // 缓存
    textureCache.set(textureFileName, texture)

    return texture
  } catch (error) {
    console.warn(`[ColorMap] Failed to load array texture: ${textureFileName}`, error)
    return null
  }
}

import {
  TextureLoader,
  NearestFilter,
  LinearFilter,
  LinearMipmapLinearFilter,
  ClampToEdgeWrapping,
  SRGBColorSpace,
} from 'three'
import type { Texture } from 'three'
import type { GameColorMap } from '@/types/editor'

// Array 贴图基础路径
const ARRAY_TEXTURE_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-model/arrays/'

// 贴图缓存：fileName → Three.js Texture
const textureCache = new Map<string, Texture>()

// diffuse 贴图缓存（全分辨率，与 array 贴图分开缓存）
const diffuseTextureCache = new Map<string, Texture>()

// 共享的 TextureLoader 实例
const textureLoader = new TextureLoader()

/**
 * 从 ColorMap 中解析单个颜色索引（旧系统，单槽染色）
 *
 * 规则：
 * - 对象格式 { "0": 0 } → 返回第一个值
 * - 数组格式 [null, 22] → 返回 null（多槽染色，需使用 parseColorMapSlots）
 * - undefined / 无效 → 返回 0（默认颜色）
 */
export function parseColorIndex(colorMap: GameColorMap | undefined): number | null {
  if (colorMap === undefined || colorMap === null) {
    return 0
  }

  // 数组格式 → 需使用 parseColorMapSlots 处理
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
 * 从 ColorMap 中解析多槽颜色索引（新系统，多槽染色）
 *
 * ColorMap 编码规则：
 * - Key: 色盘组编号（不固定，可能是 0, 1, 4, 7 这样跳跃的）
 * - Value: 复合编号 = 色盘组编号 * 10 + 颜色编号
 *
 * 例子：
 * - slotIds = [1, 4, 7]（从 furniture_db.colors 的 keys 排序得到）
 * - ColorMap = { "1": 12, "4": 41, "7": 73 }
 * - 解码：
 *   - slots[0]: slotId=1, ColorMap["1"]=12, 12%10=2 → slots[0]=2
 *   - slots[1]: slotId=4, ColorMap["4"]=41, 41%10=1 → slots[1]=1
 *   - slots[2]: slotId=7, ColorMap["7"]=73, 73%10=3 → slots[2]=3
 * - 结果: [2, 1, 3]
 *
 * @param colorMap 游戏 ColorMap 数据
 * @param slotIds 色盘组编号列表（与 preset.slots 数组一一对应）
 * @returns 各槽位的变体索引数组（颜色编号），缺失的槽位默认为 0
 */
export function parseColorMapSlots(
  colorMap: GameColorMap | undefined,
  slotIds: number[]
): number[] {
  // 初始化所有槽位为默认值 0
  const slots = new Array(slotIds.length).fill(0)

  if (colorMap === undefined || colorMap === null) {
    return slots
  }

  // 遍历每个 slot，根据对应的 slotId 去 ColorMap 中查找
  for (let i = 0; i < slotIds.length; i++) {
    const slotId = slotIds[i]!
    let compositeValue: number | null | undefined

    if (Array.isArray(colorMap)) {
      // 数组格式：slotId 作为索引
      compositeValue = colorMap[slotId]
    } else if (typeof colorMap === 'object') {
      // 对象格式：slotId 作为 key
      compositeValue = colorMap[String(slotId)]
    }

    if (typeof compositeValue === 'number' && compositeValue > 0) {
      // 解码：复合编号 % 10 = 颜色编号
      slots[i] = compositeValue % 10
    }
    // 缺失、null 或 0 保持默认 0（未染色）
  }

  return slots
}

/**
 * 加载 Array 贴图为 Three.js Texture（用于 tint shader，UV2 采样）
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

/**
 * 加载 Diffuse 贴图为 Three.js Texture（用于替换基础 D 贴图，UV1 采样）
 *
 * Diffuse 贴图是全分辨率纹理图，使用 LinearFilter 和 mipmap 获得平滑的采样效果。
 *
 * @param textureFileName Diffuse 贴图文件名（如 "T_NH_Planks_01a_D_Array_0.png"）
 * @returns Three.js Texture，失败返回 null
 */
export async function loadDiffuseTexture(textureFileName: string): Promise<Texture | null> {
  // 检查缓存
  const cached = diffuseTextureCache.get(textureFileName)
  if (cached) return cached

  try {
    const url = ARRAY_TEXTURE_BASE_URL + textureFileName
    const texture = await textureLoader.loadAsync(url)

    // 全分辨率贴图：使用 LinearFilter + mipmap 获得平滑采样
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.wrapS = ClampToEdgeWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.colorSpace = SRGBColorSpace
    // glTF 规范要求 flipY = false
    texture.flipY = false
    texture.generateMipmaps = true
    texture.needsUpdate = true

    // 缓存
    diffuseTextureCache.set(textureFileName, texture)

    return texture
  } catch (error) {
    console.warn(`[ColorMap] Failed to load diffuse texture: ${textureFileName}`, error)
    return null
  }
}

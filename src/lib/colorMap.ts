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
 * 将 ColorMap 解码为「groupId -> colorIndex」映射。
 *
 * 统一解码规则（值驱动）：
 * - value <= 0 或无效：忽略
 * - value < 10：groupId = 0，colorIndex = value（简单模式）
 * - value >= 10：groupId = floor(value / 10)，colorIndex = value % 10（多组模式）
 *
 * 说明：
 * - 数组格式：逐项按 value 解码（不依赖索引语义）
 * - 对象格式：key 作为 groupId，value 仅用于取 colorIndex（兼容旧数据）
 */
export function decodeColorMapToGroupMap(colorMap: GameColorMap | undefined): Map<number, number> {
  const result = new Map<number, number>()
  if (!colorMap) return result

  const toColorIndex = (value: number): number | null => {
    if (!Number.isFinite(value) || value <= 0) return null
    const colorIndex = value < 10 ? value : value % 10
    return colorIndex > 0 ? colorIndex : null
  }

  if (Array.isArray(colorMap)) {
    for (const raw of colorMap) {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue
      const colorIndex = toColorIndex(raw)
      if (colorIndex === null) continue
      const groupId = raw < 10 ? 0 : Math.floor(raw / 10)
      result.set(groupId, colorIndex)
    }
    return result
  }

  for (const [groupKey, raw] of Object.entries(colorMap)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue
    const groupId = Number(groupKey)
    if (!Number.isFinite(groupId) || groupId < 0) continue
    const colorIndex = toColorIndex(raw)
    if (colorIndex === null) continue
    result.set(groupId, colorIndex)
  }

  return result
}

/**
 * 从 ColorMap 中解析多槽颜色索引（新系统，多槽染色）
 *
 * @param colorMap 游戏 ColorMap 数据
 * @param slotIds 色盘组编号列表（与 preset.slots 数组一一对应）
 * @returns 各槽位的变体索引数组（颜色编号），缺失的槽位默认为 0
 */
export function parseColorMapSlots(
  colorMap: GameColorMap | undefined,
  slotIds: number[]
): number[] {
  const groupMap = decodeColorMapToGroupMap(colorMap)
  return slotIds.map((slotId) => groupMap.get(slotId) ?? 0)
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

/**
 * 检查 Array 贴图是否已缓存
 */
export function isArrayTextureCached(fileName: string): boolean {
  return textureCache.has(fileName)
}

/**
 * 检查 Diffuse 贴图是否已缓存
 */
export function isDiffuseTextureCached(fileName: string): boolean {
  return diffuseTextureCache.has(fileName)
}

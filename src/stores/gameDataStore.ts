import { defineStore } from 'pinia'
import { ref, shallowRef, toRaw } from 'vue'
import type {
  FurnitureItem,
  FurnitureCategory,
  BuildingMomoFurniture,
  FurnitureDB,
  FurnitureModelConfig,
  FurnitureLiteTextureManifestMeta,
  FurnitureLiteTextureManifestFile,
  RawFurnitureCombinationColorPreset,
  FurnitureCombinationColorPreset,
} from '../types/furniture'

// 远程数据源 (Build time fetched)
const FURNITURE_DATA_URL = import.meta.env.BASE_URL + 'assets/data/building-momo-furniture.json'
// 可建造区域数据
const BUILDABLE_AREA_URL = import.meta.env.BASE_URL + 'assets/data/home-buildable-area.json'
// 家具模型数据库
const FURNITURE_DB_URL = import.meta.env.BASE_URL + 'assets/data/furniture_db.json'
// 本地图标路径
const ICON_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-icon/'
const CATEGORY_ICON_BASE_URL = import.meta.env.BASE_URL + 'assets/category-icon/'

const LITE_TEXTURE_BASE_PATH = 'assets/furniture-model-lite/textures/'

function normalizePublicAssetPath(assetPath: string): string {
  return assetPath.replace(/^\/+/, '')
}

function buildPublicAssetUrl(assetPath: string, hash?: string): string {
  if (/^https?:\/\//i.test(assetPath)) {
    return assetPath
  }

  const url = `${import.meta.env.BASE_URL}${normalizePublicAssetPath(assetPath)}`
  return hash ? `${url}?v=${encodeURIComponent(hash)}` : url
}

function normalizeManifestMeshPath(meshPath: string): string {
  return meshPath.trim().replace(/\\/g, '/')
}

function getManifestMeshPathCandidates(meshPath: string): string[] {
  const normalized = normalizeManifestMeshPath(meshPath)
  const candidates = [normalized]
  const lastSlash = normalized.lastIndexOf('/')
  const baseName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized

  if (baseName && !candidates.includes(baseName)) {
    candidates.push(baseName)
  }

  if (baseName && !baseName.toLowerCase().endsWith('.glb')) {
    candidates.push(`${baseName}.glb`)
  }

  return candidates
}

function buildLiteTextureManifestKey(meshPath: string, textureName: string): string {
  return `${normalizeManifestMeshPath(meshPath)}::${textureName.trim()}`
}

function normalizeCombinationColorPresets(
  memberCount: number,
  rawPresets: RawFurnitureCombinationColorPreset[] | null
): FurnitureCombinationColorPreset[] | undefined {
  if (!rawPresets) return undefined

  const presets: FurnitureCombinationColorPreset[] = []
  const presetIds = new Set<number>()
  for (const [id, iconId, rawMemberColors] of rawPresets) {
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      presetIds.has(id) ||
      !Number.isSafeInteger(iconId) ||
      iconId < 0 ||
      !Array.isArray(rawMemberColors)
    ) {
      continue
    }

    const colorMaps = Array.from({ length: memberCount }, () => ({}) as Record<string, number>)
    const memberIndexes = new Set<number>()
    let valid = true
    for (const [memberIndex, rawColors] of rawMemberColors) {
      if (
        !Number.isSafeInteger(memberIndex) ||
        memberIndex < 0 ||
        memberIndex >= memberCount ||
        memberIndexes.has(memberIndex) ||
        !Array.isArray(rawColors)
      ) {
        valid = false
        break
      }

      const colorMap: Record<string, number> = {}
      for (const [area, schemeId] of rawColors) {
        if (
          !Number.isSafeInteger(area) ||
          area < 0 ||
          !Number.isSafeInteger(schemeId) ||
          schemeId < 0 ||
          Math.trunc(schemeId / 10) !== area ||
          String(area) in colorMap
        ) {
          valid = false
          break
        }
        colorMap[String(area)] = schemeId
      }
      if (!valid) break
      memberIndexes.add(memberIndex)
      colorMaps[memberIndex] = colorMap
    }

    if (!valid) continue
    presetIds.add(id)
    presets.push({ id, iconId, colorMaps })
  }

  return presets.length ? presets.sort((a, b) => a.id - b.id) : undefined
}

export const useGameDataStore = defineStore('gameData', () => {
  // ========== 状态 (Furniture) ==========
  const furnitureData = ref<Record<string, FurnitureItem>>({})
  const furnitureCategories = ref<Record<number, FurnitureCategory>>({})
  const isFurnitureInitialized = ref(false)

  // ========== 状态 (Buildable Areas) ==========
  const buildableAreas = shallowRef<Record<string, number[][]> | null>(null)
  const isBuildableAreaLoaded = ref(false)

  // ========== 状态 (Furniture DB) ==========
  const furnitureDB = ref<Map<number, FurnitureModelConfig>>(new Map())
  const isFurnitureDBLoaded = ref(false)
  const liteTextureManifestMeta = ref<FurnitureLiteTextureManifestMeta | null>(null)
  const liteTextureManifest = shallowRef<Map<string, string> | null>(null)
  const isLiteTextureManifestLoaded = ref(false)

  // ========== 数据加载 (Furniture) ==========

  // 从远程获取数据并转换为内部结构
  async function fetchFurnitureData(): Promise<{
    furniture: Record<string, FurnitureItem>
    categories: Record<number, FurnitureCategory>
  }> {
    const response = await fetch(FURNITURE_DATA_URL)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const json: BuildingMomoFurniture = await response.json()
    const furniture: Record<string, FurnitureItem> = {}
    const categories: Record<number, FurnitureCategory> = {}

    for (const [categoryKey, [nameZh, nameEn, iconId, parentId]] of Object.entries(json.c)) {
      const id = Number(categoryKey)
      categories[id] = {
        id,
        name_cn: nameZh,
        name_en: nameEn,
        iconId,
        parentId: parentId ?? null,
      }
    }

    for (const [
      itemId,
      [
        nameZh,
        nameEn,
        iconId,
        dim,
        scaleRange,
        rot,
        categoryId,
        colors,
        rawCombination,
        rawCombinationColors,
      ],
    ] of json.d) {
      const size: [number, number, number] =
        Array.isArray(dim) && dim.length === 3 ? (dim as [number, number, number]) : [100, 100, 150]

      const parsedScaleRange: [number, number] =
        Array.isArray(scaleRange) && scaleRange.length === 2
          ? (scaleRange as [number, number])
          : [1, 1]

      const parsedRot: [boolean, boolean] =
        Array.isArray(rot) && rot.length === 2 ? (rot as [boolean, boolean]) : [true, true]

      if (!categories[categoryId]) {
        throw new Error(`Furniture ${itemId} references unknown category ${categoryId}`)
      }

      const combination = rawCombination?.map(([memberItemId, position, rotation, scale]) => ({
        itemId: memberItemId,
        position,
        rotation,
        scale,
      }))
      furniture[itemId.toString()] = {
        name_cn: String(nameZh ?? ''),
        name_en: String(nameEn ?? ''),
        icon: String(iconId ?? ''),
        size,
        scaleRange: parsedScaleRange,
        rotationAllowed: {
          x: parsedRot[0],
          y: parsedRot[1],
          z: true,
        },
        categoryId,
        colors: colors ?? undefined,
        combination,
        combinationColorPresets: combination
          ? normalizeCombinationColorPresets(combination.length, rawCombinationColors)
          : undefined,
      }
    }

    return { furniture, categories }
  }

  async function updateFurnitureData(): Promise<void> {
    if (isFurnitureInitialized.value) return

    const data = await fetchFurnitureData()
    console.log('[GameDataStore] Fetched', Object.keys(data.furniture).length, 'items')
    furnitureData.value = data.furniture
    furnitureCategories.value = data.categories
    isFurnitureInitialized.value = true
  }

  // 可建造区域数据加载
  async function loadBuildableAreaData() {
    if (isBuildableAreaLoaded.value) return

    try {
      const response = await fetch(BUILDABLE_AREA_URL)
      if (!response.ok) throw new Error('Failed to load buildable area data')
      const data = await response.json()
      buildableAreas.value = data.polygons
      isBuildableAreaLoaded.value = true
      console.log('[GameDataStore] Buildable area data loaded')
    } catch (error) {
      console.error('[GameDataStore] Failed to load buildable area data:', error)
    }
  }

  async function loadFurnitureDB() {
    if (isFurnitureDBLoaded.value) return

    try {
      const response = await fetch(FURNITURE_DB_URL)
      if (!response.ok) throw new Error('Failed to load furniture database')

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        isFurnitureDBLoaded.value = true
        return
      }

      const data: FurnitureDB = await response.json()

      const map = new Map<number, FurnitureModelConfig>()
      for (const config of data.furniture) {
        const gameId = config.id + 1170000000
        map.set(gameId, config)
      }

      furnitureDB.value = map
      liteTextureManifestMeta.value = data.liteTextureManifest ?? null
      liteTextureManifest.value = null
      isLiteTextureManifestLoaded.value = false
      isFurnitureDBLoaded.value = true
    } catch (error) {
      if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true') {
        console.error('[GameDataStore] Failed to load furniture database:', error)
      }
    }
  }

  async function loadLiteTextureManifest(force = false): Promise<Map<string, string> | null> {
    if (isLiteTextureManifestLoaded.value && !force) {
      return liteTextureManifest.value
    }

    const manifestMeta = liteTextureManifestMeta.value
    if (!manifestMeta?.path) {
      liteTextureManifest.value = null
      isLiteTextureManifestLoaded.value = true
      return null
    }

    try {
      const response = await fetch(buildPublicAssetUrl(manifestMeta.path, manifestMeta.hash))
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data: FurnitureLiteTextureManifestFile = await response.json()
      const nextManifest = new Map<string, string>()
      for (const [key, value] of Object.entries(data.textures ?? {})) {
        const trimmedValue = value.trim()
        if (trimmedValue) nextManifest.set(key, trimmedValue)
      }

      liteTextureManifest.value = nextManifest
      isLiteTextureManifestLoaded.value = true
      console.log(`[GameDataStore] Lite texture manifest loaded: ${nextManifest.size} entries`)
      return nextManifest
    } catch (error) {
      liteTextureManifest.value = null
      isLiteTextureManifestLoaded.value = true
      console.warn('[GameDataStore] Failed to load lite texture manifest:', error)
      return null
    }
  }

  function getLiteTexturePath(meshPath: string, textureName: string): string | null {
    const manifest = liteTextureManifest.value
    if (!manifest || !meshPath || !textureName) return null

    const normalizedTextureName = textureName.trim()
    for (const candidate of getManifestMeshPathCandidates(meshPath)) {
      const path = manifest.get(buildLiteTextureManifestKey(candidate, normalizedTextureName))
      if (path) return path
    }

    return null
  }

  function getLiteTextureUrl(meshPath: string, textureName: string): string | null {
    const fileName = getLiteTexturePath(meshPath, textureName)
    return fileName ? buildPublicAssetUrl(`${LITE_TEXTURE_BASE_PATH}${fileName}`) : null
  }

  // ========== 全局初始化 ==========

  async function initialize(): Promise<void> {
    await Promise.all([updateFurnitureData(), loadBuildableAreaData(), loadFurnitureDB()])
  }

  // ========== 公共方法 (Furniture) ==========

  // 根据 ItemID 获取家具信息
  function getFurniture(itemId: number): FurnitureItem | null {
    return furnitureData.value[itemId.toString()] || null
  }

  // 获取家具尺寸（游戏坐标系：[X, Y, Z] = [长, 宽, 高]）
  function getFurnitureSize(itemId: number): [number, number, number] | null {
    const furniture = getFurniture(itemId)
    return furniture?.size ?? null
  }

  // 获取图标 URL（导出为 webp 格式）
  function getIconUrl(itemId: number): string {
    const furniture = getFurniture(itemId)
    if (!furniture || !furniture.icon) return ''
    return ICON_BASE_URL + furniture.icon + '.webp'
  }

  function getCategoryIconUrl(categoryId: number): string {
    const category = furnitureCategories.value[categoryId]
    return category ? CATEGORY_ICON_BASE_URL + category.iconId + '.png' : ''
  }

  // ========== 公共方法 (Furniture DB) ==========

  /**
   * 根据 ItemID 获取家具模型配置
   * @param itemId 家具 ItemID
   * @returns 模型配置，如果不存在返回 null
   */
  function getFurnitureModelConfig(itemId: number): FurnitureModelConfig | null {
    return furnitureDB.value.get(itemId) ?? null
  }

  /**
   * 获取所有家具的约束信息映射（用于 Worker 验证）
   * @returns Map<gameId, {scaleRange, rotationAllowed, colorSchemes}>
   */
  function getFurnitureConstraintsMap(): Map<
    string,
    {
      scaleRange: [number, number]
      rotationAllowed: { x: boolean; y: boolean; z: boolean }
      colorSchemes: number[]
    }
  > {
    const map = new Map()

    for (const [gameId, furniture] of Object.entries(furnitureData.value)) {
      map.set(gameId, {
        scaleRange: toRaw(furniture.scaleRange),
        rotationAllowed: toRaw(furniture.rotationAllowed),
        colorSchemes: Object.entries(furniture.colors ?? {}).flatMap(([area, colors]) =>
          Object.keys(colors).map((slot) => Number(area) * 10 + Number(slot))
        ),
      })
    }

    return map
  }

  function clearCache(): void {
    furnitureData.value = {}
    furnitureCategories.value = {}
    isFurnitureInitialized.value = false
    buildableAreas.value = null
    isBuildableAreaLoaded.value = false
    furnitureDB.value.clear()
    liteTextureManifestMeta.value = null
    liteTextureManifest.value = null
    isLiteTextureManifestLoaded.value = false
    isFurnitureDBLoaded.value = false
  }

  return {
    // 状态
    furnitureData,
    furnitureCategories,
    isInitialized: isFurnitureInitialized,

    // 状态 (Buildable Areas)
    buildableAreas,
    isBuildableAreaLoaded,

    // 状态 (Furniture DB)
    furnitureDB,
    isFurnitureDBLoaded,
    liteTextureManifestMeta,
    isLiteTextureManifestLoaded,

    // 方法
    initialize,
    getFurniture,
    getFurnitureSize,
    getIconUrl,
    getCategoryIconUrl,
    getFurnitureModelConfig,
    getFurnitureConstraintsMap,
    loadLiteTextureManifest,
    getLiteTexturePath,
    getLiteTextureUrl,
    clearCache,
  }
})

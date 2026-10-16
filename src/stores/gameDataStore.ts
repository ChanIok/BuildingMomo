import { defineStore } from 'pinia'
import { computed, ref, shallowRef, toRaw } from 'vue'
import {
  loadFurnitureModels,
  type FurnitureModelConfig,
  type ModelAssetProfile,
} from '@nuan5-pro/render/furniture'
import { getSafeScaleRange } from '../lib/scaleLimits'
import type {
  FurnitureItem,
  FurnitureCategory,
  BuildingMomoFurniture,
  RawFurnitureCombinationColorPreset,
  FurnitureCombinationColorPreset,
} from '../types/furniture'

// 远程数据源 (Build time fetched)
const FURNITURE_DATA_URL = import.meta.env.BASE_URL + 'assets/data/building-momo-furniture.json'
// 可建造区域数据
const BUILDABLE_AREA_URL = import.meta.env.BASE_URL + 'assets/data/home-buildable-area.json'
// 家具模型数据库
const FURNITURE_ROOT_URL = import.meta.env.BASE_URL + 'assets/furniture-v2/'
// 本地图标路径
const ICON_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-icon/'
const CATEGORY_ICON_BASE_URL = import.meta.env.BASE_URL + 'assets/category-icon/'

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
  const furnitureDBRevision = ref(0)
  const furnitureDBError = ref<string | null>(null)
  const availableModelProfiles = computed<ModelAssetProfile[]>(() => {
    const meshes = [...furnitureDB.value.values()].flatMap((item) => item.meshes)
    return meshes.length && meshes.every((mesh) => mesh.models.lite) ? ['full', 'lite'] : ['full']
  })

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

  async function loadFurnitureDB(force = false) {
    if (isFurnitureDBLoaded.value && !force) return

    try {
      const decoded = await loadFurnitureModels(FURNITURE_ROOT_URL)

      const map = new Map<number, FurnitureModelConfig>()
      for (const config of decoded) {
        map.set(config.id, config)
      }

      furnitureDB.value = map
      furnitureDBRevision.value++
      furnitureDBError.value = null
      isFurnitureDBLoaded.value = true
    } catch (error) {
      furnitureDBError.value = error instanceof Error ? error.message : String(error)
      console.error('[GameDataStore] Failed to load furniture v2 catalog:', error)
    }
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

  function getFurnitureScaleRange(itemId: number): [number, number] | null {
    const furniture = getFurniture(itemId)
    return furniture ? getSafeScaleRange(furniture.scaleRange) : null
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
    furnitureDBRevision.value++
    furnitureDBError.value = null
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
    furnitureDBRevision,
    furnitureDBError,
    availableModelProfiles,

    // 方法
    initialize,
    getFurniture,
    getFurnitureScaleRange,
    getFurnitureSize,
    getIconUrl,
    getCategoryIconUrl,
    getFurnitureModelConfig,
    loadFurnitureDB,
    getFurnitureConstraintsMap,
    clearCache,
  }
})

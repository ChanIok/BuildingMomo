import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type {
  FurnitureItem,
  BuildingMomoFurniture,
  RawFurnitureEntry,
  FurnitureDB,
  FurnitureModelConfig,
} from '../types/furniture'

// 远程数据源 (Build time fetched)
const FURNITURE_DATA_URL = import.meta.env.BASE_URL + 'assets/data/building-momo-furniture.json'
// 可建造区域数据
const BUILDABLE_AREA_URL = import.meta.env.BASE_URL + 'assets/data/home-buildable-area.json'
// 家具模型数据库（替代 id_to_model.json）
const FURNITURE_DB_URL = import.meta.env.BASE_URL + 'assets/data/furniture_db.json'
// 本地图标路径
const ICON_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-icon/'

export const useGameDataStore = defineStore('gameData', () => {
  // ========== 状态 (Furniture) ==========
  const furnitureData = ref<Record<string, FurnitureItem>>({})
  const lastFetchTime = ref<number>(0)
  const isFurnitureInitialized = ref(false)

  // ========== 状态 (Buildable Areas) ==========
  const buildableAreas = shallowRef<Record<string, number[][]> | null>(null)
  const isBuildableAreaLoaded = ref(false)

  // ========== 状态 (Furniture DB) ==========
  const furnitureDB = ref<Map<number, FurnitureModelConfig>>(new Map())
  const isFurnitureDBLoaded = ref(false)

  // ========== 数据加载 (Furniture) ==========

  // 从远程获取数据并转换为内部结构
  async function fetchFurnitureData(): Promise<Record<string, FurnitureItem>> {
    const response = await fetch(FURNITURE_DATA_URL)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const json: BuildingMomoFurniture = await response.json()

    // 使用 Map 处理原始条目，然后归一化为 Record<string, FurnitureItem>
    const rawMap = new Map<number, RawFurnitureEntry[1]>(json.d)
    const result: Record<string, FurnitureItem> = {}

    for (const [itemId, value] of rawMap.entries()) {
      const [nameZh, nameEn, iconId, dim] = value

      // 基本校验：尺寸应为长度为3的数组
      const validSize =
        Array.isArray(dim) &&
        dim.length === 3 &&
        dim.every((n) => typeof n === 'number' && Number.isFinite(n))

      const size: [number, number, number] = validSize
        ? (dim as [number, number, number])
        : [100, 100, 150]

      result[itemId.toString()] = {
        name_cn: String(nameZh ?? ''),
        name_en: String(nameEn ?? ''),
        // 这里存储的是 icon_id，实际 URL 在 getIconUrl 中统一拼接 .webp
        icon: String(iconId ?? ''),
        size,
      }
    }

    return result
  }

  // 更新家具数据
  async function updateFurnitureData(): Promise<void> {
    try {
      const remoteData = await fetchFurnitureData()

      console.log('[GameDataStore] Fetched', Object.keys(remoteData).length, 'items')

      // 更新状态
      furnitureData.value = remoteData
      lastFetchTime.value = Date.now()
      isFurnitureInitialized.value = true
    } catch (error) {
      console.error('[GameDataStore] Update failed:', error)
      throw error
    }
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

  // 家具数据库加载
  async function loadFurnitureDB() {
    if (isFurnitureDBLoaded.value) return

    try {
      const response = await fetch(FURNITURE_DB_URL)
      if (!response.ok) throw new Error('Failed to load furniture database')
      const data: FurnitureDB = await response.json()

      // 构建 Map：原始ID + 1170000000 → 配置
      const map = new Map<number, FurnitureModelConfig>()
      for (const config of data.furniture) {
        const gameId = config.id + 1170000000
        map.set(gameId, config)
      }

      furnitureDB.value = map
      isFurnitureDBLoaded.value = true
      console.log('[GameDataStore] Furniture database loaded:', map.size, 'entries')
    } catch (error) {
      console.error('[GameDataStore] Failed to load furniture database:', error)
    }
  }

  // ========== 全局初始化 ==========

  // 初始化（应用启动时调用）
  async function initialize(): Promise<void> {
    if (isFurnitureInitialized.value && isBuildableAreaLoaded.value && isFurnitureDBLoaded.value) {
      return
    }

    // 并行加载
    await Promise.all([
      !isFurnitureInitialized.value ? updateFurnitureData() : Promise.resolve(),
      !isBuildableAreaLoaded.value ? loadBuildableAreaData() : Promise.resolve(),
      !isFurnitureDBLoaded.value ? loadFurnitureDB() : Promise.resolve(),
    ])
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

  // ========== 公共方法 (Furniture DB) ==========

  /**
   * 根据 ItemID 获取家具模型配置
   * @param itemId 家具 ItemID
   * @returns 模型配置，如果不存在返回 null
   */
  function getFurnitureModelConfig(itemId: number): FurnitureModelConfig | null {
    return furnitureDB.value.get(itemId) || null
  }

  // 清除缓存 (仅重置状态)
  async function clearCache(): Promise<void> {
    console.log('[GameDataStore] Clearing state...')
    furnitureData.value = {}
    lastFetchTime.value = 0
    isFurnitureInitialized.value = false
    buildableAreas.value = null
    isBuildableAreaLoaded.value = false
    furnitureDB.value.clear()
    isFurnitureDBLoaded.value = false
    console.log('[GameDataStore] State cleared')
  }

  return {
    // 状态
    furnitureData,
    lastFetchTime,
    isInitialized: isFurnitureInitialized, // Compatible alias

    // 状态 (Buildable Areas)
    buildableAreas,
    isBuildableAreaLoaded,

    // 状态 (Furniture DB)
    furnitureDB,
    isFurnitureDBLoaded,

    // 方法
    initialize,
    getFurniture,
    getFurnitureSize,
    getIconUrl,
    getFurnitureModelConfig,
    clearCache,
  }
})

import { defineStore } from 'pinia'
import { ref, shallowRef, toRaw } from 'vue'
import type {
  FurnitureItem,
  BuildingMomoFurniture,
  RawFurnitureEntry,
  FurnitureDB,
  FurnitureModelConfig,
  DyePresetsData,
  DyePreset,
} from '../types/furniture'

// 远程数据源 (Build time fetched)
const FURNITURE_DATA_URL = import.meta.env.BASE_URL + 'assets/data/building-momo-furniture.json'
// 可建造区域数据
const BUILDABLE_AREA_URL = import.meta.env.BASE_URL + 'assets/data/home-buildable-area.json'
// 家具模型数据库（替代 id_to_model.json）
const FURNITURE_DB_URL = import.meta.env.BASE_URL + 'assets/data/furniture_db.json'
// 家具染色变体映射表（单槽染色，旧系统）
const VARIANT_MAP_URL =
  import.meta.env.BASE_URL + 'assets/furniture-model/material_variant_map.json'
// 家具染色预设表（多槽染色，新系统）
const DYE_PRESETS_URL =
  import.meta.env.BASE_URL + 'assets/furniture-model/furniture_dye_presets.json'
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

  // ========== 状态 (Variant Map) ==========
  // 材质实例名 → Array 贴图文件名列表
  const variantMap = ref<Record<string, string[]>>({})
  const isVariantMapLoaded = ref(false)

  // ========== 状态 (Dye Presets) ==========
  // 多槽染色预设数据
  const dyePresetsData = ref<DyePresetsData | null>(null)
  const isDyePresetsLoaded = ref(false)

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
      const [nameZh, nameEn, iconId, dim, scaleRange, rot] = value

      // 基本校验：尺寸应为长度为3的数组
      const validSize =
        Array.isArray(dim) &&
        dim.length === 3 &&
        dim.every((n) => typeof n === 'number' && Number.isFinite(n))

      const size: [number, number, number] = validSize
        ? (dim as [number, number, number])
        : [100, 100, 150]

      // 校验缩放范围：应为长度为2的数组
      const validScaleRange =
        Array.isArray(scaleRange) &&
        scaleRange.length === 2 &&
        scaleRange.every((n) => typeof n === 'number' && Number.isFinite(n))

      const parsedScaleRange: [number, number] = validScaleRange
        ? (scaleRange as [number, number])
        : [1, 1] // 默认不可缩放

      // 校验旋转限制：应为长度为2的布尔数组
      const validRot = Array.isArray(rot) && rot.length === 2
      const parsedRot = validRot ? rot : [true, true] // 默认允许所有旋转

      result[itemId.toString()] = {
        name_cn: String(nameZh ?? ''),
        name_en: String(nameEn ?? ''),
        // 这里存储的是 icon_id，实际 URL 在 getIconUrl 中统一拼接 .webp
        icon: String(iconId ?? ''),
        size,
        scaleRange: parsedScaleRange,
        rotationAllowed: {
          x: parsedRot[0] ?? true,
          y: parsedRot[1] ?? true,
          z: true, // Z 轴总是允许旋转
        },
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
      isFurnitureDBLoaded.value = true
    } catch (error) {
      if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true') {
        console.error('[GameDataStore] Failed to load furniture database:', error)
      }
    }
  }

  // ========== 数据加载 (Variant Map) ==========

  async function loadVariantMap() {
    if (isVariantMapLoaded.value) return

    try {
      const response = await fetch(VARIANT_MAP_URL)
      if (!response.ok) throw new Error('Failed to load variant map')
      variantMap.value = await response.json()
      isVariantMapLoaded.value = true
      console.log(
        '[GameDataStore] Variant map loaded:',
        Object.keys(variantMap.value).length,
        'materials'
      )
    } catch (error) {
      console.error('[GameDataStore] Failed to load variant map:', error)
      isVariantMapLoaded.value = true // 标记为已加载，避免重试阻塞
    }
  }

  // ========== 数据加载 (Dye Presets) ==========

  async function loadDyePresets() {
    if (isDyePresetsLoaded.value) return

    try {
      const response = await fetch(DYE_PRESETS_URL)
      if (!response.ok) throw new Error('Failed to load dye presets')
      dyePresetsData.value = await response.json()
      isDyePresetsLoaded.value = true
      console.log(
        '[GameDataStore] Dye presets loaded:',
        dyePresetsData.value?.presets.length ?? 0,
        'presets,',
        Object.keys(dyePresetsData.value?.items ?? {}).length,
        'items'
      )
    } catch (error) {
      console.error('[GameDataStore] Failed to load dye presets:', error)
      isDyePresetsLoaded.value = true // 标记为已加载，避免重试阻塞
    }
  }

  // ========== 全局初始化 ==========

  // 初始化（应用启动时调用）
  async function initialize(): Promise<void> {
    if (
      isFurnitureInitialized.value &&
      isBuildableAreaLoaded.value &&
      isFurnitureDBLoaded.value &&
      isVariantMapLoaded.value &&
      isDyePresetsLoaded.value
    ) {
      return
    }

    // 并行加载
    await Promise.all([
      !isFurnitureInitialized.value ? updateFurnitureData() : Promise.resolve(),
      !isBuildableAreaLoaded.value ? loadBuildableAreaData() : Promise.resolve(),
      !isFurnitureDBLoaded.value ? loadFurnitureDB() : Promise.resolve(),
      !isVariantMapLoaded.value ? loadVariantMap() : Promise.resolve(),
      !isDyePresetsLoaded.value ? loadDyePresets() : Promise.resolve(),
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
    const config = furnitureDB.value.get(itemId) || null

    return config
  }

  /**
   * 获取所有家具的约束信息映射（用于 Worker 验证）
   * @returns Map<gameId, {scaleRange, rotationAllowed}>
   */
  function getFurnitureConstraintsMap(): Map<
    string,
    {
      scaleRange?: [number, number]
      rotationAllowed?: { x: boolean; y: boolean; z: boolean }
    }
  > {
    const map = new Map()

    for (const [gameId, furniture] of Object.entries(furnitureData.value)) {
      // 只包含有约束的家具
      if (furniture.scaleRange || furniture.rotationAllowed) {
        map.set(gameId, {
          scaleRange: furniture.scaleRange ? toRaw(furniture.scaleRange) : undefined,
          rotationAllowed: furniture.rotationAllowed ? toRaw(furniture.rotationAllowed) : undefined,
        })
      }
    }

    return map
  }

  /**
   * 根据材质实例名获取染色变体贴图列表（旧系统，单槽染色）
   * @param materialName 材质实例名（如 "MI_NHFurn_Chair_07"）
   * @returns Array 贴图文件名列表，如果不存在返回 null
   */
  function getVariantTextures(materialName: string): string[] | null {
    return variantMap.value[materialName] ?? null
  }

  /**
   * 根据家具 ID 获取染色预设（新系统，多槽染色）
   * @param gameId 家具 ItemID
   * @returns { preset, slotIds } 染色预设配置和色盘组编号列表，如果不存在返回 null
   *          slotIds: 从 furniture_db.colors 的 keys 排序得到，与 preset.slots 数组一一对应
   */
  function getDyePreset(gameId: number): { preset: DyePreset; slotIds: number[] } | null {
    if (!dyePresetsData.value) return null
    const itemRef = dyePresetsData.value.items[gameId.toString()]
    if (!itemRef) return null
    const preset = dyePresetsData.value.presets[itemRef.presets]
    if (!preset) return null

    // 从 furniture_db 的 colors 字段获取色盘组编号列表
    const config = furnitureDB.value.get(gameId)
    let slotIds: number[] = []
    if (config?.colors) {
      // colors 的 keys 是色盘组编号（字符串），转为数字并排序
      slotIds = Object.keys(config.colors)
        .map(Number)
        .sort((a, b) => a - b)
    }

    // 如果 colors 缺失，回退到 0-based 索引
    if (slotIds.length === 0) {
      slotIds = preset.slots.map((_, i) => i)
    }

    return { preset, slotIds }
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
    variantMap.value = {}
    isVariantMapLoaded.value = false
    dyePresetsData.value = null
    isDyePresetsLoaded.value = false
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

    // 状态 (Dye Presets)
    dyePresetsData,
    isDyePresetsLoaded,

    // 方法
    initialize,
    getFurniture,
    getFurnitureSize,
    getIconUrl,
    getFurnitureModelConfig,
    getVariantTextures,
    getDyePreset,
    getFurnitureConstraintsMap,
    clearCache,
  }
})

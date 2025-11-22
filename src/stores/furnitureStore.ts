import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  FurnitureItem,
  BuildingMomoFurniture,
  RawFurnitureEntry,
} from '../types/furniture'

// 远程数据源 (Build time fetched)
const FURNITURE_DATA_URL = '/assets/data/building-momo-furniture.json'
// 本地图标路径
const ICON_BASE_URL = '/assets/furniture-icon/'

export const useFurnitureStore = defineStore('furniture', () => {
  // ========== 状态 ==========
  const data = ref<Record<string, FurnitureItem>>({})
  const lastFetchTime = ref<number>(0)
  const isLoading = ref(false)
  const isInitialized = ref(false)

  // ========== 计算属性 ==========
  const totalCount = computed(() => Object.keys(data.value).length)

  // ========== 数据加载 ==========

  // 从远程获取数据并转换为内部结构
  async function fetchRemoteData(): Promise<Record<string, FurnitureItem>> {
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

  // 初始化（应用启动时调用）
  async function initialize(): Promise<void> {
    if (isInitialized.value) return

    console.log('[FurnitureStore] Initializing...')
    await updateData(false)
  }

  // 更新数据（从远程获取）
  async function updateData(silent: boolean = false): Promise<void> {
    if (!silent) {
      isLoading.value = true
    }

    try {
      console.log('[FurnitureStore] Fetching data...')
      const remoteData = await fetchRemoteData()

      console.log('[FurnitureStore] Fetched', Object.keys(remoteData).length, 'items')

      // 更新状态
      data.value = remoteData
      lastFetchTime.value = Date.now()
      isInitialized.value = true

      console.log('[FurnitureStore] Data updated')
    } catch (error) {
      console.error('[FurnitureStore] Update failed:', error)
      throw error
    } finally {
      if (!silent) {
        isLoading.value = false
      }
    }
  }

  // ========== 公共方法 ==========

  // 根据 ItemID 获取家具信息
  function getFurniture(itemId: number): FurnitureItem | null {
    return data.value[itemId.toString()] || null
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

  // 强制更新（用户手动触发）
  async function forceUpdate(): Promise<void> {
    console.log('[FurnitureStore] Force update triggered')
    await updateData(false)
  }

  // 清除缓存 (仅重置状态)
  async function clearCache(): Promise<void> {
    console.log('[FurnitureStore] Clearing state...')
    data.value = {}
    lastFetchTime.value = 0
    isInitialized.value = false
    console.log('[FurnitureStore] State cleared')
  }

  return {
    // 状态
    data,
    lastFetchTime,
    isLoading,
    isInitialized,

    // 计算属性
    totalCount,

    // 方法
    initialize,
    getFurniture,
    getFurnitureSize,
    getIconUrl,
    forceUpdate,
    clearCache,
  }
})

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  FurnitureItem,
  FurnitureCache,
  BuildingMomoFurniture,
  RawFurnitureEntry,
} from '../types/furniture'

// IndexedDB 配置
const DB_NAME = 'BuildingMomoFurnitureDB'
const DB_VERSION = 1
const STORE_NAME = 'furnitureCache'
const CACHE_KEY = 'furniture_data'

// 远程数据源
const FURNITURE_DATA_URL = 'https://nuan5.pro/assets/data/building-momo-furniture.json'
const ICON_BASE_URL = 'https://nuan5.pro/assets/furniture-icon/'

// 24小时（毫秒）
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000

export const useFurnitureStore = defineStore('furniture', () => {
  // ========== 状态 ==========
  const data = ref<Record<string, FurnitureItem>>({})
  const lastFetchTime = ref<number>(0)
  const isLoading = ref(false)
  const isInitialized = ref(false)

  // ========== 计算属性 ==========
  const totalCount = computed(() => Object.keys(data.value).length)

  const needsUpdate = computed(() => {
    if (lastFetchTime.value === 0) return true
    return Date.now() - lastFetchTime.value > UPDATE_INTERVAL
  })

  // ========== IndexedDB 操作 ==========

  // 打开 IndexedDB
  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
    })
  }

  // 从 IndexedDB 读取缓存
  async function loadFromCache(): Promise<FurnitureCache | null> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(CACHE_KEY)

        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[FurnitureStore] Failed to load from cache:', error)
      return null
    }
  }

  // 保存到 IndexedDB
  async function saveToCache(cache: FurnitureCache): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.put(cache, CACHE_KEY)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[FurnitureStore] Failed to save to cache:', error)
      throw error
    }
  }

  // 清除 IndexedDB 缓存
  async function clearCacheDB(): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.delete(CACHE_KEY)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[FurnitureStore] Failed to clear cache:', error)
      throw error
    }
  }

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

    try {
      // 1. 尝试从缓存加载
      const cache = await loadFromCache()

      if (cache) {
        console.log('[FurnitureStore] Loaded from cache:', {
          count: Object.keys(cache.data).length,
          lastFetchTime: new Date(cache.lastFetchTime).toLocaleString(),
        })

        data.value = cache.data
        lastFetchTime.value = cache.lastFetchTime
        isInitialized.value = true

        // 2. 检查是否需要更新
        if (needsUpdate.value) {
          console.log('[FurnitureStore] Cache expired, updating in background...')
          // 后台静默更新
          updateData(true).catch((error) => {
            console.error('[FurnitureStore] Background update failed:', error)
          })
        }
      } else {
        // 3. 无缓存，首次加载
        console.log('[FurnitureStore] No cache found, fetching data...')
        await updateData(false)
      }
    } catch (error) {
      console.error('[FurnitureStore] Initialization failed:', error)
      throw error
    }
  }

  // 更新数据（从远程获取并保存）
  async function updateData(silent: boolean = false): Promise<void> {
    if (!silent) {
      isLoading.value = true
    }

    try {
      console.log('[FurnitureStore] Fetching remote data...')
      const remoteData = await fetchRemoteData()

      console.log('[FurnitureStore] Fetched', Object.keys(remoteData).length, 'items')

      // 更新状态
      data.value = remoteData
      lastFetchTime.value = Date.now()
      isInitialized.value = true

      // 保存到缓存
      await saveToCache({
        lastFetchTime: lastFetchTime.value,
        data: remoteData,
      })

      console.log('[FurnitureStore] Data updated and cached')
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

  // 清除缓存
  async function clearCache(): Promise<void> {
    console.log('[FurnitureStore] Clearing cache...')
    await clearCacheDB()
    data.value = {}
    lastFetchTime.value = 0
    isInitialized.value = false
    console.log('[FurnitureStore] Cache cleared')
  }

  // 预加载图标（可选，暂不实现）
  async function preloadIcons(itemIds: number[]): Promise<void> {
    // TODO: 实现图标预加载逻辑
    console.log('[FurnitureStore] Preload icons:', itemIds.length)
  }

  return {
    // 状态
    data,
    lastFetchTime,
    isLoading,
    isInitialized,

    // 计算属性
    totalCount,
    needsUpdate,

    // 方法
    initialize,
    getFurniture,
    getFurnitureSize,
    getIconUrl,
    forceUpdate,
    clearCache,
    preloadIcons,
  }
})

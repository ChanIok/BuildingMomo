import { useFurnitureStore } from '../stores/furnitureStore'

/**
 * 图标加载管理器
 * 负责加载、缓存和管理家具图标
 */
export function useIconLoader() {
  // 图标缓存 Map: ItemID -> HTMLImageElement
  const iconCache = new Map<number, HTMLImageElement | null>()

  // 正在加载的图标 Promise，避免重复请求
  const loadingPromises = new Map<number, Promise<HTMLImageElement | null>>()

  const furnitureStore = useFurnitureStore()

  /**
   * 加载单个图标
   * @param itemId 家具 ItemID
   * @returns Promise<HTMLImageElement | null>
   */
  function loadIcon(itemId: number): Promise<HTMLImageElement | null> {
    // 1. 检查缓存
    if (iconCache.has(itemId)) {
      return Promise.resolve(iconCache.get(itemId) ?? null)
    }

    // 2. 检查是否正在加载
    if (loadingPromises.has(itemId)) {
      return loadingPromises.get(itemId)!
    }

    // 3. 开始加载
    const promise = new Promise<HTMLImageElement | null>((resolve) => {
      const iconUrl = furnitureStore.getIconUrl(itemId)

      // 没有图标 URL，返回 null
      if (!iconUrl) {
        iconCache.set(itemId, null)
        resolve(null)
        return
      }

      const img = new Image()

      img.onload = () => {
        iconCache.set(itemId, img)
        loadingPromises.delete(itemId)
        resolve(img)
      }

      img.onerror = () => {
        console.warn(`[IconLoader] Failed to load icon for ItemID ${itemId}`)
        iconCache.set(itemId, null)
        loadingPromises.delete(itemId)
        resolve(null)
      }

      // 设置 crossOrigin 属性，支持跨域图片加载
      img.crossOrigin = 'anonymous'
      img.src = iconUrl
    })

    loadingPromises.set(itemId, promise)
    return promise
  }

  /**
   * 批量预加载图标
   * @param itemIds 家具 ItemID 列表
   */
  async function preloadIcons(itemIds: number[]): Promise<void> {
    const promises = itemIds.map((id) => loadIcon(id))
    await Promise.allSettled(promises)
  }

  /**
   * 同步获取图标（仅返回已缓存的）
   * @param itemId 家具 ItemID
   * @returns HTMLImageElement | null
   */
  function getIcon(itemId: number): HTMLImageElement | null {
    return iconCache.get(itemId) ?? null
  }

  /**
   * 检查图标是否已加载
   * @param itemId 家具 ItemID
   */
  function isIconLoaded(itemId: number): boolean {
    const icon = iconCache.get(itemId)
    return icon !== undefined && icon !== null && icon.complete
  }

  /**
   * 清除缓存
   */
  function clearCache(): void {
    iconCache.clear()
    loadingPromises.clear()
  }

  /**
   * 获取缓存统计信息
   */
  function getCacheStats() {
    return {
      cachedCount: iconCache.size,
      loadingCount: loadingPromises.size,
    }
  }

  return {
    loadIcon,
    preloadIcons,
    getIcon,
    isIconLoaded,
    clearCache,
    getCacheStats,
  }
}

// 创建单例实例
let iconLoaderInstance: ReturnType<typeof useIconLoader> | null = null

/**
 * 获取图标加载器单例
 */
export function getIconLoader(): ReturnType<typeof useIconLoader> {
  if (!iconLoaderInstance) {
    iconLoaderInstance = useIconLoader()
  }
  return iconLoaderInstance
}

import { Data3DTexture, RGBAFormat, LinearFilter, ClampToEdgeWrapping } from 'three'
import { getIconLoader } from './useIconLoader'

/**
 * Three.js 图标管理器 (Instanced Rendering & Texture Array)
 *
 * 职责：
 * 1. 管理 Data3DTexture（纹理数组）
 * 2. 负责图标的加载、缩放和写入
 * 3. 提供默认的占位符纹理数据
 *
 * 特性：
 * - 动态扩容
 * - 自动生成 Mipmap 占位符（虽然 Data3DTexture Mipmap 支持有限，但我们提供基础的高质量占位符）
 * - 单例模式管理
 */
export function useThreeIconManager() {
  const iconLoader = getIconLoader()

  // 配置
  const ICON_SIZE = 256 // 统一图标尺寸
  const INITIAL_CAPACITY = 32 // 初始容量（层数）
  const BLOCK_SIZE = 32 // 扩容步长（块大小）
  const MAX_CAPACITY = 1024 // 最大容量限制

  // 纹理数组（3D 纹理）
  let textureArray: Data3DTexture | null = null

  // 映射：itemId -> 纹理数组索引
  const textureIndexMap = new Map<number, number>()

  // 下一个可用的索引
  let nextIndex = 0

  // 纹理数据缓冲区（动态分配）
  let textureData: Uint8Array | null = null

  // 当前容量（层数）
  let currentCapacity = 0

  /**
   * 生成占位符像素数据（Canvas绘制）
   * 用于填充未加载或加载失败的层
   */
  function getPlaceholderPixelData(): Uint8ClampedArray {
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    const ctx = canvas.getContext('2d')

    if (ctx) {
      // 1. 绘制渐变背景 (Slate-400 -> Slate-500)
      const gradient = ctx.createLinearGradient(0, 0, ICON_SIZE, ICON_SIZE)
      gradient.addColorStop(0, '#94a3b8') // slate-400
      gradient.addColorStop(1, '#64748b') // slate-500
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE)

      // 2. 绘制边框
      ctx.strokeStyle = '#475569' // slate-600
      const lineWidth = Math.max(4, ICON_SIZE / 32)
      ctx.lineWidth = lineWidth
      const offset = lineWidth / 2
      ctx.strokeRect(offset, offset, ICON_SIZE - lineWidth, ICON_SIZE - lineWidth)

      // 3. 绘制问号（表示未知图标）
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${ICON_SIZE / 2}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', ICON_SIZE / 2, ICON_SIZE / 2)

      return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data
    }

    // 降级方案：纯色填充
    const size = ICON_SIZE * ICON_SIZE * 4
    const data = new Uint8ClampedArray(size)
    for (let i = 0; i < size; i += 4) {
      data[i] = 148 // R
      data[i + 1] = 163 // G
      data[i + 2] = 184 // B
      data[i + 3] = 255 // A
    }
    return data
  }

  // 缓存占位符数据，避免重复创建 Canvas
  let cachedPlaceholderData: Uint8ClampedArray | null = null
  function getCachedPlaceholderData() {
    if (!cachedPlaceholderData) {
      cachedPlaceholderData = getPlaceholderPixelData()
    }
    return cachedPlaceholderData
  }

  /**
   * 初始化纹理数组（按指定容量创建）
   */
  function initTextureArray(capacity: number = INITIAL_CAPACITY): Data3DTexture {
    if (textureArray && currentCapacity >= capacity) {
      return textureArray
    }

    // 释放旧纹理
    if (textureArray) {
      textureArray.dispose()
      textureArray = null
    }

    // 采用块状扩容策略（32的倍数），而非2的幂次，以节省显存
    const alignedCapacity = Math.ceil(capacity / BLOCK_SIZE) * BLOCK_SIZE
    currentCapacity = Math.min(alignedCapacity, MAX_CAPACITY)

    // 分配 3D 纹理数据：width × height × depth × 4 (RGBA)
    const size = ICON_SIZE * ICON_SIZE * currentCapacity * 4
    textureData = new Uint8Array(size)

    // 填充占位符图案到所有层
    const placeholderData = getCachedPlaceholderData()
    const layerSize = ICON_SIZE * ICON_SIZE * 4

    // 使用 set 方法快速批量填充
    for (let i = 0; i < currentCapacity; i++) {
      textureData.set(placeholderData, i * layerSize)
    }

    // 创建 Data3DTexture（真正的 3D 纹理）
    textureArray = new Data3DTexture(textureData, ICON_SIZE, ICON_SIZE, currentCapacity)
    textureArray.format = RGBAFormat
    textureArray.minFilter = LinearFilter
    textureArray.magFilter = LinearFilter
    textureArray.wrapS = ClampToEdgeWrapping
    textureArray.wrapT = ClampToEdgeWrapping
    textureArray.wrapR = ClampToEdgeWrapping
    textureArray.needsUpdate = true

    const memoryMB = (size / (1024 * 1024)).toFixed(2)
    console.log(
      `[IconManager] 初始化完成，纹理尺寸: ${ICON_SIZE}x${ICON_SIZE}x${currentCapacity}，内存占用: ${memoryMB}MB`
    )

    return textureArray
  }

  /**
   * 扩展纹理数组容量
   */
  function expandCapacity(newCapacity: number): boolean {
    if (!textureData || !textureArray) {
      console.error('[IconManager] 纹理数组未初始化')
      return false
    }

    if (newCapacity <= currentCapacity) {
      return true // 无需扩展
    }

    if (newCapacity > MAX_CAPACITY) {
      console.warn(`[IconManager] 请求容量 ${newCapacity} 超过最大限制 ${MAX_CAPACITY}`)
      newCapacity = MAX_CAPACITY
      if (currentCapacity >= MAX_CAPACITY) {
        return false
      }
    }

    // 采用块状扩容策略
    const alignedCapacity = Math.ceil(newCapacity / BLOCK_SIZE) * BLOCK_SIZE
    const targetCapacity = Math.min(alignedCapacity, MAX_CAPACITY)

    console.log(`[IconManager] 扩容: ${currentCapacity} -> ${targetCapacity} 层`)

    // 保存旧数据
    const oldData = textureData
    const oldCapacity = currentCapacity

    // 创建新数组
    const newSize = ICON_SIZE * ICON_SIZE * targetCapacity * 4
    textureData = new Uint8Array(newSize)

    // 复制旧数据
    const oldSize = ICON_SIZE * ICON_SIZE * oldCapacity * 4
    textureData.set(oldData.subarray(0, oldSize))

    // 填充新增部分的默认占位符
    const placeholderData = getCachedPlaceholderData()
    const layerSize = ICON_SIZE * ICON_SIZE * 4

    for (let i = oldCapacity; i < targetCapacity; i++) {
      textureData.set(placeholderData, i * layerSize)
    }

    // 释放旧纹理
    textureArray.dispose()

    // 创建新纹理
    textureArray = new Data3DTexture(textureData, ICON_SIZE, ICON_SIZE, targetCapacity)
    textureArray.format = RGBAFormat
    textureArray.minFilter = LinearFilter
    textureArray.magFilter = LinearFilter
    textureArray.wrapS = ClampToEdgeWrapping
    textureArray.wrapT = ClampToEdgeWrapping
    textureArray.wrapR = ClampToEdgeWrapping
    textureArray.needsUpdate = true

    currentCapacity = targetCapacity

    const memoryMB = (newSize / (1024 * 1024)).toFixed(2)
    console.log(`[IconManager] 扩容完成，内存占用: ${memoryMB}MB`)

    return true
  }

  /**
   * 确保有足够的容量
   */
  function ensureCapacity(requiredCapacity: number): boolean {
    if (currentCapacity >= requiredCapacity) {
      return true
    }

    // 直接请求所需容量，由 expandCapacity 负责对齐
    return expandCapacity(requiredCapacity)
  }

  /**
   * 将图标添加到纹理数组
   * @param itemId 家具 ItemID
   * @returns Promise<boolean> 成功返回 true
   */
  async function addIconToArray(itemId: number): Promise<boolean> {
    if (!textureData || !textureArray) {
      console.error('[IconManager] 纹理数组未初始化')
      return false
    }

    // 如果已存在，直接返回
    if (textureIndexMap.has(itemId)) {
      return true
    }

    // 确保有足够容量
    if (nextIndex >= currentCapacity) {
      const success = ensureCapacity(nextIndex + 1)
      if (!success) {
        console.warn(
          `[IconManager] 无法扩容，已达最大容量 ${MAX_CAPACITY}，无法添加 ItemID ${itemId}`
        )
        return false
      }
    }

    // 记录当前的索引
    const targetIndex = nextIndex
    // 预先占用索引（防止并发时同一个位置被写入两次）
    textureIndexMap.set(itemId, targetIndex)
    nextIndex++

    try {
      // 加载图标
      const icon = await iconLoader.loadIcon(itemId)

      // 检查纹理数组是否还在（可能在异步过程中被 dispose）
      if (!textureData || !textureArray) return false

      if (!icon || !icon.complete) {
        console.warn(`[IconManager] 图标加载失败: ItemID ${itemId}，保留占位符`)
        // 即使失败，我们也已经占用了索引，默认显示占位符
        return false
      }

      // 创建临时 Canvas 读取像素数据
      const canvas = document.createElement('canvas')
      canvas.width = ICON_SIZE
      canvas.height = ICON_SIZE
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        console.error('[IconManager] 无法创建 Canvas 上下文')
        return false
      }

      // 绘制并调整尺寸到统一大小
      ctx.drawImage(icon, 0, 0, ICON_SIZE, ICON_SIZE)

      // 读取像素数据
      const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE)
      const pixels = imageData.data

      // 将像素写入纹理数组的对应层
      const layerOffset = targetIndex * ICON_SIZE * ICON_SIZE * 4

      // 直接 set
      textureData.set(pixels, layerOffset)

      // 标记纹理需要更新
      textureArray.needsUpdate = true
      return true
    } catch (error) {
      console.error(`[IconManager] 处理图标 ItemID ${itemId} 时出错`, error)
      return false
    }
  }

  /**
   * 批量预加载图标到纹理数组
   * @param itemIds 家具 ItemID 列表
   */
  async function preloadIcons(itemIds: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(itemIds)) // 去重

    // 过滤出未加载的图标
    const unloadedIds = uniqueIds.filter((id) => !textureIndexMap.has(id))

    if (unloadedIds.length === 0) {
      return // 所有图标已加载
    }

    // 确保有足够容量（一次性扩容，避免多次扩容）
    const requiredCapacity = textureIndexMap.size + unloadedIds.length
    if (!ensureCapacity(requiredCapacity)) {
      console.warn(`[IconManager] 容量不足，部分图标可能无法加载`)
    }

    const promises = unloadedIds.map((id) => addIconToArray(id))
    const results = await Promise.allSettled(promises)

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length
    console.log(`[IconManager] 预加载完成: ${successCount}/${unloadedIds.length} 个图标`)
  }

  /**
   * 获取图标的纹理索引
   * @param itemId 家具 ItemID
   * @returns 纹理数组索引，如果不存在返回 0（默认层）
   */
  function getTextureIndex(itemId: number): number {
    return textureIndexMap.get(itemId) ?? 0
  }

  /**
   * 获取当前纹理数组
   */
  function getTextureArray(): Data3DTexture | null {
    return textureArray
  }

  /**
   * 获取当前容量
   */
  function getCurrentCapacity(): number {
    return currentCapacity
  }

  /**
   * 获取统计信息
   */
  function getStats() {
    const memoryMB =
      currentCapacity > 0 ? (ICON_SIZE * ICON_SIZE * currentCapacity * 4) / (1024 * 1024) : 0
    return {
      currentCapacity,
      maxCapacity: MAX_CAPACITY,
      usedTextures: nextIndex,
      loadedIcons: textureIndexMap.size,
      iconSize: ICON_SIZE,
      memoryMB: memoryMB.toFixed(2),
    }
  }

  /**
   * 清理资源
   */
  function dispose() {
    if (textureArray) {
      textureArray.dispose()
      // 防御性措施：显式清空 Data3DTexture 内部的数据引用
      if (textureArray.image) {
        textureArray.image.data = null
      }
      textureArray = null
    }
    textureData = null
    textureIndexMap.clear()
    cachedPlaceholderData = null
    nextIndex = 0
    console.log('[IconManager] 资源已清理')
  }

  return {
    initTextureArray,
    addIconToArray,
    preloadIcons,
    getTextureIndex,
    getTextureArray,
    getCurrentCapacity,
    getStats,
    dispose,
  }
}

// 创建单例实例（带引用计数）
let managerInstance: ReturnType<typeof useThreeIconManager> | null = null
let refCount = 0

/**
 * 获取图标管理器单例（增加引用计数）
 * 每次调用都会增加引用计数，使用完毕后必须调用 releaseThreeIconManager() 释放
 */
export function getThreeIconManager(): ReturnType<typeof useThreeIconManager> {
  if (!managerInstance) {
    managerInstance = useThreeIconManager()
    console.log('[IconManager] 创建新实例')
  }
  refCount++
  console.log(`[IconManager] 引用计数: ${refCount}`)
  return managerInstance
}

/**
 * 释放图标管理器单例的引用（减少引用计数）
 * 当引用计数归零时，自动清理资源
 */
export function releaseThreeIconManager(): void {
  if (refCount <= 0) {
    console.warn('[IconManager] 引用计数已为0，无需释放')
    return
  }

  refCount--
  console.log(`[IconManager] 引用计数: ${refCount}`)

  // 当引用计数归零时，清理实例
  if (refCount === 0 && managerInstance) {
    console.log('[IconManager] 引用计数归零，清理资源')
    managerInstance.dispose()
    managerInstance = null
  }
}

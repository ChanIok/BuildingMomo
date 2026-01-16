import { ref, onUnmounted } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { GameDataFile, GameItem, FileWatchState } from '../types/editor'
import { useNotification } from './useNotification'
import { useSettingsStore } from '../stores/settingsStore'
import type { AlertDetailItem } from '../stores/notificationStore'
import { storeToRefs } from 'pinia'
import { useValidationStore } from '../stores/validationStore'
import { useGameDataStore } from '../stores/gameDataStore'
import { getIconLoader } from './useIconLoader'
import { getThreeModelManager } from './useThreeModelManager'
import { useI18n } from './useI18n'
import backgroundUrl from '@/assets/home.webp'
import { WatchHistoryDB } from '../lib/watchHistoryStore'

const MAX_WATCH_HISTORY = 30

// 检查浏览器是否支持 File System Access API
const isFileSystemAccessSupported = 'showDirectoryPicker' in window

// 模块级变量：是否不再提醒保存警告（本次访问有效）
const suppressSaveWarning = ref(false)

// 辅助函数：从文件名提取 UID
function extractUidFromFilename(filename: string): string | null {
  const match = filename.match(/BUILD_SAVEDATA_(\d+)\.json/)
  return match?.[1] ?? null
}

// 辅助函数：判断文件名是否符合 BUILD_SAVEDATA 格式
function isBuildSaveDataFile(name: string): boolean {
  return /^BUILD_SAVEDATA_\d+\.json$/.test(name)
}

// 辅助函数：按路径查找子目录
async function resolvePath(
  startHandle: FileSystemDirectoryHandle,
  pathParts: string[]
): Promise<FileSystemDirectoryHandle | null> {
  let currentHandle = startHandle
  for (const part of pathParts) {
    try {
      currentHandle = await currentHandle.getDirectoryHandle(part)
    } catch {
      return null
    }
  }
  return currentHandle
}

// 辅助函数：查找 BuildData 目录
async function findBuildDataDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  // 1. 当前目录就是 BuildData
  if (dirHandle.name === 'BuildData') {
    return dirHandle
  }

  // 2. 尝试直接找 BuildData 子目录 (对应选中 SavedData 的情况)
  try {
    return await dirHandle.getDirectoryHandle('BuildData')
  } catch {
    // 继续查找
  }

  // 3. 尝试探测 X6Game (对应选中游戏根目录的情况，如 InfinityNikkiGlobal)
  try {
    const x6Game = await dirHandle.getDirectoryHandle('X6Game')
    const result = await resolvePath(x6Game, ['Saved', 'SavedData', 'BuildData'])
    if (result) return result
  } catch {
    // 继续查找
  }

  // 4. 尝试探测 Saved (对应选中 X6Game 的情况)
  try {
    const saved = await dirHandle.getDirectoryHandle('Saved')
    const result = await resolvePath(saved, ['SavedData', 'BuildData'])
    if (result) return result
  } catch {
    // 继续查找
  }

  // 5. 尝试探测 SavedData (对应选中 Saved 的情况)
  try {
    const savedData = await dirHandle.getDirectoryHandle('SavedData')
    const result = await resolvePath(savedData, ['BuildData'])
    if (result) return result
  } catch {
    // 继续查找
  }

  return null
}

// 辅助函数：从文件内容提取物品数量
function getItemCountFromContent(content: string): number {
  try {
    const jsonData = JSON.parse(content)
    return Array.isArray(jsonData?.PlaceInfo) ? jsonData.PlaceInfo.length : 0
  } catch {
    return 0
  }
}

// 辅助函数：在 BuildData 目录中查找最新的 BUILD_SAVEDATA 文件
async function findLatestBuildSaveData(
  buildDataDir: FileSystemDirectoryHandle
): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  const buildFiles: Array<{ file: File; handle: FileSystemFileHandle }> = []

  try {
    for await (const entry of (buildDataDir as any).values()) {
      if (
        entry.kind === 'file' &&
        entry.name.startsWith('BUILD_SAVEDATA_') &&
        entry.name.endsWith('.json')
      ) {
        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        buildFiles.push({ file, handle: fileHandle })
      }
    }
  } catch (e) {
    console.error('Failed to scan BuildData directory:', e)
    return null
  }

  if (buildFiles.length === 0) {
    return null
  }

  // 按修改时间排序，取最新的
  buildFiles.sort((a, b) => b.file.lastModified - a.file.lastModified)
  return buildFiles[0] ?? null
}

export function useFileOperations(editorStore: ReturnType<typeof useEditorStore>) {
  // 1. Store 依赖
  const notification = useNotification()
  const { t } = useI18n()
  const settingsStore = useSettingsStore()
  const gameDataStore = useGameDataStore()
  const validationStore = useValidationStore()
  const { hasDuplicate, duplicateItemCount, hasLimitIssues, limitIssues } =
    storeToRefs(validationStore)

  // 2. 辅助函数：预加载图片
  function preloadImage(url: string) {
    const img = new Image()
    img.src = url
  }

  // 辅助函数：预加载当前方案的资源（图标和模型）
  function preloadActiveSchemeResources() {
    if (editorStore.activeScheme) {
      // items 是 ShallowRef，需要访问 .value
      const uniqueIds = [...new Set(editorStore.activeScheme.items.value.map((i) => i.gameId))]

      // 预加载图标（无论当前什么模式）
      getIconLoader().preloadIcons(uniqueIds)

      // 预加载模型（仅在私有部署模式下，后台并发加载，错误不阻塞）
      if (import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' && settingsStore.isAuthenticated) {
        getThreeModelManager()
          .preloadModels(uniqueIds)
          .catch((err) => {
            console.warn('[FileOps] 模型预加载失败:', err)
          })
      }
    }
  }

  // 辅助函数：确保资源已就绪（游戏数据和背景图）
  function ensureResourcesReady() {
    gameDataStore.initialize()
    preloadImage(backgroundUrl)
  }

  // 3. 本地状态
  const watchState = ref<FileWatchState>({
    isActive: false,
    dirHandle: null,
    dirPath: '',
    lastCheckedTime: 0,
    fileIndex: new Map(),
    updateHistory: [],
    lastImportedFileHandle: null,
    lastImportedFileName: '',
  })

  // 轮询定时器
  let pollTimer: number | null = null

  // 轮询间隔配置
  const POLL_INTERVAL_ACTIVE = 3000 // 页面活跃时：3秒
  const POLL_INTERVAL_HIDDEN = 10000 // 页面隐藏时：10秒（降低频率）

  // 辅助函数：添加到监控历史
  async function addToWatchHistory(
    fileName: string,
    content: string,
    itemCount: number,
    lastModified: number
  ): Promise<void> {
    const historyId = `${fileName}_${lastModified}`
    const size = new Blob([content]).size

    try {
      // 保存到 IndexedDB
      await WatchHistoryDB.save({
        id: historyId,
        fileName,
        content,
        itemCount,
        lastModified,
        detectedAt: Date.now(),
        size,
      })
      console.log(`[FileWatch] Saved to history DB: ${historyId}`)
    } catch (error) {
      console.error('[FileWatch] Failed to save to history DB:', error)
    }

    // 更新内存历史
    const history = watchState.value.updateHistory
    if (!history.some((h) => h.id === historyId)) {
      history.unshift({
        id: historyId,
        name: fileName,
        lastModified,
        itemCount,
        detectedAt: Date.now(),
        size,
      })
      if (history.length > MAX_WATCH_HISTORY) {
        history.pop()
      }
    }

    // 清理 IndexedDB 中的旧记录
    WatchHistoryDB.clearOld(MAX_WATCH_HISTORY).catch((err) =>
      console.error('[FileWatch] Failed to clean old history:', err)
    )
  }

  // 准备保存数据（处理限制）
  async function prepareDataForSave(): Promise<GameItem[] | null> {
    const details: AlertDetailItem[] = []

    // 1. 检查重复物品
    if (settingsStore.settings.enableDuplicateDetection && hasDuplicate.value) {
      details.push({
        type: 'warning',
        title: t('fileOps.duplicate.title'),
        text: `${t('fileOps.duplicate.desc', { n: duplicateItemCount.value })}\n${t('fileOps.duplicate.detail')}`,
      })
    }

    // 2. 检查限制问题
    if (hasLimitIssues.value) {
      const { outOfBoundsItemIds, oversizedGroups, invalidScaleItemIds, invalidRotationItemIds } =
        limitIssues.value
      const limitMsgs: string[] = []

      if (outOfBoundsItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.outOfBounds', { n: outOfBoundsItemIds.length }))
      }
      if (oversizedGroups.length > 0) {
        limitMsgs.push(t('fileOps.limit.oversized', { n: oversizedGroups.length }))
      }
      if (invalidScaleItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.invalidScale', { n: invalidScaleItemIds.length }))
      }
      if (invalidRotationItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.invalidRotation', { n: invalidRotationItemIds.length }))
      }

      if (limitMsgs.length > 0) {
        details.push({
          type: 'info',
          title: t('fileOps.limit.title'),
          text: t('fileOps.limit.desc'),
          list: limitMsgs,
        })
      }
    }

    // 3. 如果有问题，统一弹窗
    if (details.length > 0) {
      // 如果用户之前勾选了"不再提醒"，则跳过弹窗直接保存
      if (!suppressSaveWarning.value) {
        const { confirmed, checked } = await notification.confirmWithCheckbox({
          title: t('fileOps.save.confirmTitle'),
          description: t('fileOps.save.confirmDesc'),
          details: details,
          confirmText: t('fileOps.save.continue'),
          cancelText: t('common.cancel'),
          checkboxLabel: t('fileOps.save.dontShowAgain'),
        })

        if (!confirmed) {
          return null
        }

        // 如果用户勾选了不再提醒，更新状态
        if (checked) {
          suppressSaveWarning.value = true
        }
      }
    }

    // 4. 处理数据
    const outOfBoundsIds = new Set(limitIssues.value.outOfBoundsItemIds)
    const oversizedGroupIds = new Set(limitIssues.value.oversizedGroups)
    const invalidScaleIds = new Set(limitIssues.value.invalidScaleItemIds)
    const invalidRotationIds = new Set(limitIssues.value.invalidRotationItemIds)

    // editorStore.items 已经是一个 computed 属性，返回的是 items.value，所以这里不需要改
    const gameItems: GameItem[] = (editorStore.activeScheme?.items.value ?? [])
      .filter((item) => !outOfBoundsIds.has(item.internalId)) // 移除越界物品
      .map((item) => {
        const originalGroupId = item.groupId
        let newGroupId = originalGroupId

        // 解组超大组
        if (originalGroupId > 0 && oversizedGroupIds.has(originalGroupId)) {
          newGroupId = 0
        }

        // 处理缩放超限：截断到允许范围（参考 SidebarTransform.vue 的处理方式）
        let finalScale = { ...item.extra.Scale }
        if (invalidScaleIds.has(item.internalId)) {
          const furniture = gameDataStore.getFurniture(item.gameId)
          if (furniture?.scaleRange) {
            const [min, max] = furniture.scaleRange
            // 直接截断，不舍入（与 SidebarTransform.vue 第314-315行保持一致）
            finalScale.X = Math.max(min, Math.min(max, finalScale.X))
            finalScale.Y = Math.max(min, Math.min(max, finalScale.Y))
            finalScale.Z = Math.max(min, Math.min(max, finalScale.Z))
          }
        }

        // 处理旋转违规：禁止的轴置零
        let finalRotation = { ...item.rotation }
        if (invalidRotationIds.has(item.internalId)) {
          const furniture = gameDataStore.getFurniture(item.gameId)
          if (furniture?.rotationAllowed) {
            // 禁止的轴置零（Z轴通常都允许，不处理）
            if (!furniture.rotationAllowed.x) finalRotation.x = 0
            if (!furniture.rotationAllowed.y) finalRotation.y = 0
          }
        }

        return {
          ...item.extra,
          ItemID: item.gameId,
          InstanceID: item.instanceId,
          GroupID: newGroupId,
          Location: {
            X: item.x,
            Y: item.y,
            Z: item.z,
          },
          Rotation: {
            Roll: finalRotation.x,
            Pitch: finalRotation.y,
            Yaw: finalRotation.z,
          },
          Scale: finalScale, // 使用修正后的缩放值
        }
      })

    return gameItems
  }

  // 4. 核心业务函数
  // 导入 JSON 文件
  async function importJSON(): Promise<void> {
    ensureResourcesReady()

    return new Promise((resolve) => {
      // 创建临时的文件选择器
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'

      input.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement
        const file = target.files?.[0]

        if (!file) {
          resolve()
          return
        }

        const reader = new FileReader()
        reader.onload = async (e) => {
          const content = e.target?.result as string
          // 使用多方案导入API
          const result = await editorStore.importJSONAsScheme(content, file.name, file.lastModified)

          if (result.success) {
            console.log(`[FileOps] Successfully imported scheme: ${file.name}`)
            notification.success(t('fileOps.import.success'))
            // 预加载图标和模型
            preloadActiveSchemeResources()
          } else {
            notification.error(
              t('fileOps.import.failed', { reason: result.error || 'Unknown error' })
            )
          }

          resolve()
        }

        reader.onerror = () => {
          notification.error(t('fileOps.import.readFailed'))
          resolve()
        }

        reader.readAsText(file)
      }

      // 触发文件选择
      input.click()
    })
  }

  // 导出 JSON 文件
  async function exportJSON(filename?: string): Promise<void> {
    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      notification.warning(t('fileOps.export.noData'))
      return
    }

    // 准备数据
    const gameItems = await prepareDataForSave()
    if (!gameItems) return

    // 构造导出数据
    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    // 生成 JSON 字符串（紧凑格式）
    const jsonString = JSON.stringify(exportData)

    // 创建 Blob 并下载
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    // 确定文件名：优先使用传入文件名 > 原文件名 > 默认生成
    let downloadName = filename
    if (!downloadName) {
      if (editorStore.activeScheme?.filePath.value) {
        downloadName = editorStore.activeScheme.filePath.value
      } else {
        downloadName = `BUILD_SAVEDATA_${Date.now()}.json`
      }
    }
    link.download = downloadName
    link.click()

    // 清理
    URL.revokeObjectURL(url)

    console.log(`[FileOps] Exported ${gameItems.length} items to ${link.download}`)
  }

  // 保存到游戎
  async function saveToGame(): Promise<void> {
    // 检查全局游戎连接状态
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.saveToGame.noDir'))
      return
    }

    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      notification.warning(t('fileOps.saveToGame.noData'))
      return
    }

    // 准备数据
    const gameItems = await prepareDataForSave()
    if (!gameItems) return

    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    // 1. 确定目标文件句柄
    let handle: FileSystemFileHandle | null = null
    let finalFileName = ''

    const currentFileName = editorStore.activeScheme?.filePath.value
    // 正则：BUILD_SAVEDATA_数字.json
    const match = currentFileName?.match(/^BUILD_SAVEDATA_(\d+)\.json$/)

    // 判定是否为有效文件名（符合格式且不是13位时间戳）
    let isValidName = false
    if (match && match[1]) {
      const idPart = match[1]
      // 简单判断：如果是13位数字，视为时间戳，不作为有效UID
      if (idPart.length !== 13) {
        isValidName = true
      }
    }

    try {
      if (isValidName && currentFileName) {
        // 策略 A: 文件名合法，尝试直接使用（允许创建）
        handle = await watchState.value.dirHandle.getFileHandle(currentFileName, {
          create: true,
        })
        finalFileName = currentFileName
      } else {
        // 策略 B: 文件名无效（乱码或时间戳），回退到上次导入的文件
        if (watchState.value.lastImportedFileHandle) {
          handle = watchState.value.lastImportedFileHandle
          finalFileName = watchState.value.lastImportedFileName
        } else {
          // 如果没有导入记录，尝试查找目录中最新的
          const latest = await findLatestBuildSaveData(watchState.value.dirHandle)
          if (latest) {
            handle = latest.handle
            finalFileName = latest.file.name
          }
        }
      }

      if (!handle) {
        notification.error(t('fileOps.saveToGame.noData'))
        return
      }

      const jsonString = JSON.stringify(exportData)

      // 2. 请求写入权限（如果需要）
      const permission = await verifyPermission(handle, true)

      if (!permission) {
        notification.error(t('fileOps.saveToGame.noPermission'))
        return
      }

      // 3. 写入文件
      const writable = await handle.createWritable()
      await writable.write(jsonString)
      await writable.close()

      // 4. 更新监控状态和文件索引
      const updatedFile = await handle.getFile()
      const cached = watchState.value.fileIndex.get(finalFileName)
      watchState.value.lastImportedFileHandle = handle
      watchState.value.lastImportedFileName = finalFileName
      // 更新文件索引
      watchState.value.fileIndex.set(finalFileName, {
        lastModified: updatedFile.lastModified + 1000, // +1秒缓冲，避免触发自己的保存
        lastContent: jsonString,
        itemCount: gameItems.length,
        firstDetectedAt: cached?.firstDetectedAt ?? updatedFile.lastModified,
      })

      console.log(`[FileOps] Successfully saved to game: ${finalFileName}`)
      notification.success(t('fileOps.saveToGame.success'))
    } catch (error: any) {
      console.error('[FileOps] Failed to save to game:', error)
      notification.error(
        t('fileOps.saveToGame.failed', { reason: error.message || 'Unknown error' })
      )
    }
  }

  // 辅助函数：验证文件权限
  async function verifyPermission(
    fileHandle: FileSystemFileHandle,
    readWrite: boolean
  ): Promise<boolean> {
    const options: any = {}
    if (readWrite) {
      options.mode = 'readwrite'
    }

    // 检查是否已有权限
    if ((await (fileHandle as any).queryPermission(options)) === 'granted') {
      return true
    }

    // 请求权限
    if ((await (fileHandle as any).requestPermission(options)) === 'granted') {
      return true
    }

    return false
  }

  // 检查文件更新（目录级扫描）
  async function checkFileUpdate(): Promise<boolean> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      return false
    }

    try {
      watchState.value.lastCheckedTime = Date.now()

      // 第一阶段：扫描目录，收集有更新的文件
      const updates: Array<{ name: string; file: File; handle: FileSystemFileHandle }> = []

      for await (const entry of (watchState.value.dirHandle as any).values()) {
        if (entry.kind !== 'file' || !isBuildSaveDataFile(entry.name)) continue

        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        const cached = watchState.value.fileIndex.get(entry.name)

        // 只比较时间戳（快速操作）
        if (!cached || file.lastModified > cached.lastModified) {
          updates.push({ name: entry.name, file, handle: fileHandle })
        }
      }

      if (updates.length === 0) {
        return false
      }

      // 第二阶段：读取内容，找出真正需要提示的文件
      let latestFile: {
        name: string
        file: File
        handle: FileSystemFileHandle
        content: string
        itemCount: number
      } | null = null
      let latestModified = 0

      for (const { name, file, handle } of updates) {
        const content = await file.text()
        const cached = watchState.value.fileIndex.get(name)

        // 内容去重
        if (content === cached?.lastContent) {
          console.log(`[FileWatch] File touched but content identical: ${name}`)
          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: cached.lastContent,
            itemCount: cached.itemCount ?? 0,
            firstDetectedAt: cached.firstDetectedAt ?? file.lastModified,
          })
          continue
        }

        // 检查 NeedRestore
        try {
          const jsonData = JSON.parse(content)
          const itemCount = Array.isArray(jsonData?.PlaceInfo) ? jsonData.PlaceInfo.length : 0
          if (jsonData.NeedRestore === true) {
            // 找出最新的文件
            if (file.lastModified > latestModified) {
              latestModified = file.lastModified
              latestFile = { name, file, handle, content, itemCount }
            }
          }
          // 更新索引
          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: content,
            itemCount,
            firstDetectedAt: cached?.firstDetectedAt ?? file.lastModified,
          })
        } catch (parseError) {
          console.error(`[FileWatch] Failed to parse JSON for ${name}:`, parseError)
          // 解析失败也视为需要提示
          if (file.lastModified > latestModified) {
            latestModified = file.lastModified
            latestFile = { name, file, handle, content, itemCount: 0 }
          }
          // 更新索引（解析失败时物品数量为0）
          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: content,
            itemCount: 0,
            firstDetectedAt: cached?.firstDetectedAt ?? file.lastModified,
          })
        }
      }

      // 第三阶段：只提示最新的文件
      if (latestFile) {
        // 添加到监控历史
        await addToWatchHistory(
          latestFile.name,
          latestFile.content,
          latestFile.itemCount,
          latestFile.file.lastModified
        )

        console.log(
          `[FileWatch] File updated: ${latestFile.name}, lastModified: ${new Date(latestFile.file.lastModified).toLocaleString()}`
        )
        if (settingsStore.settings.enableWatchNotification) {
          // 🔑 不使用 await，避免阻塞轮询
          // 弹窗异步显示，用户确认后再导入
          notification
            .fileUpdate(latestFile.name, latestFile.file.lastModified)
            .then((confirmed) => {
              if (confirmed) {
                // 使用预读取的内容导入，避免在用户确认期间文件被再次修改
                importFromContent(
                  latestFile.content,
                  latestFile.name,
                  latestFile.handle,
                  latestFile.file.lastModified
                ).catch((err) => {
                  console.error('[FileWatch] Failed to import from content:', err)
                })
              }
            })
            .catch((err) => {
              console.error('[FileWatch] File update notification error:', err)
            })
        }
        return true
      }

      return false
    } catch (error) {
      console.error('[FileWatch] Failed to check file update:', error)
      return false
    }
  }

  // Page Visibility API 处理
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && watchState.value.isActive) {
      console.log('[FileWatch] Page visible, checking for updates...')
      checkFileUpdate()
    }
  }

  // 启动文件监控
  function startPolling() {
    if (pollTimer !== null) {
      return // 已经在轮询中
    }

    // 添加可见性监听
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    const poll = async () => {
      await checkFileUpdate()

      // 根据页面可见性调整轮询间隔
      const interval = document.hidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_ACTIVE
      pollTimer = window.setTimeout(poll, interval)
    }

    poll()
  }

  // 停止文件监控
  function stopPolling() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }

    // 移除可见性监听
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  // 启动监控模式
  async function startWatchMode(): Promise<void> {
    if (!isFileSystemAccessSupported) {
      notification.error(t('fileOps.watch.notSupported'))
      return
    }

    ensureResourcesReady()

    try {
      // 1. 让用户选择目录
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      })

      console.log('[FileWatch] Selected directory for monitoring:', dirHandle.name)

      // 2. 查找 BuildData 目录
      const buildDataDir = await findBuildDataDirectory(dirHandle)
      if (!buildDataDir) {
        notification.error(t('fileOps.watch.noBuildData'))
        return
      }

      console.log('[FileWatch] Found BuildData directory:', buildDataDir.name)

      // 3. 查找最新的 BUILD_SAVEDATA 文件（可能为空）
      const result = await findLatestBuildSaveData(buildDataDir)

      let fileHandle: FileSystemFileHandle | null = null
      let fileName = ''
      let lastModified = 0

      if (result) {
        fileHandle = result.handle
        fileName = result.file.name
        lastModified = result.file.lastModified
        console.log(`[FileWatch] Found existing file: ${fileName}`)
      } else {
        console.log('[FileWatch] No existing file found, will monitor for new files')
      }

      // 4. 建立文件索引
      const fileIndex = new Map<
        string,
        { lastModified: number; lastContent: string; itemCount: number; firstDetectedAt: number }
      >()

      for await (const entry of (buildDataDir as any).values()) {
        if (entry.kind === 'file' && isBuildSaveDataFile(entry.name)) {
          const fileHandle = entry as FileSystemFileHandle
          const file = await fileHandle.getFile()
          const content = await file.text()
          fileIndex.set(entry.name, {
            lastModified: file.lastModified,
            lastContent: content,
            itemCount: getItemCountFromContent(content),
            firstDetectedAt: file.lastModified,
          })
        }
      }

      // 5. 从 IndexedDB 恢复历史记录
      let restoredHistory: typeof watchState.value.updateHistory = []
      try {
        const allMetadata = await WatchHistoryDB.getAllMetadata()
        // 保留最新的 MAX_WATCH_HISTORY 条
        restoredHistory = allMetadata.slice(0, MAX_WATCH_HISTORY)
        console.log(`[FileWatch] Restored ${restoredHistory.length} history records from IndexedDB`)
      } catch (error) {
        console.error('[FileWatch] Failed to restore history from IndexedDB:', error)
        // 如果恢复失败，使用当前会话的历史
        restoredHistory = watchState.value.updateHistory
      }

      // 6. 设置监控状态
      watchState.value = {
        isActive: true,
        dirHandle: buildDataDir,
        dirPath: buildDataDir.name,
        lastCheckedTime: Date.now(),
        fileIndex: fileIndex,
        updateHistory: restoredHistory,
        lastImportedFileHandle: fileHandle,
        lastImportedFileName: fileName,
      }

      // 7. 启动轮询
      startPolling()

      // 8. 如果有现有文件，检查 NeedRestore 再决定是否提示导入
      if (result) {
        try {
          const content = await result.file.text()

          const jsonData = JSON.parse(content)

          // 只有 NeedRestore 为 true 时才提示导入
          if (jsonData.NeedRestore === true) {
            const shouldImport = await notification.confirm({
              title: t('fileOps.watch.foundTitle'),
              description: t('fileOps.watch.foundDesc', {
                name: fileName,
                time: new Date(lastModified).toLocaleString(),
              }),
              confirmText: t('fileOps.watch.importNow'),
              cancelText: t('fileOps.watch.later'),
            })

            if (shouldImport) {
              await importFromWatchedFile()

              // 将首次导入的文件添加到历史记录
              const itemCount = getItemCountFromContent(content)
              await addToWatchHistory(fileName, content, itemCount, lastModified)
            }
          } else {
            // NeedRestore 为 false，说明暂无建造数据
            notification.success(t('fileOps.watch.started'))
          }
        } catch (error) {
          console.error('[FileWatch] Failed to parse JSON:', error)
          // 解析失败时也提示用户
          notification.warning(t('fileOps.watch.parseFailed'))
        }
      } else {
        notification.success(t('fileOps.watch.started'))
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[FileWatch] User cancelled directory picker')
        return
      }
      console.error('[FileWatch] Failed to start watch mode:', error)
      notification.error(
        t('fileOps.watch.startFailed', { reason: error.message || 'Unknown error' })
      )
    }
  }

  // 停止监控模式
  function stopWatchMode() {
    stopPolling()
    const existingHistory = watchState.value.updateHistory
    watchState.value = {
      isActive: false,
      dirHandle: null,
      dirPath: '',
      lastCheckedTime: 0,
      fileIndex: new Map(),
      updateHistory: existingHistory,
      lastImportedFileHandle: null,
      lastImportedFileName: '',
    }
    console.log('[FileWatch] Watch mode stopped')
  }

  // 从预读取的内容导入（避免二次读取导致的时间窗口问题）
  async function importFromContent(
    content: string,
    fileName: string,
    handle: FileSystemFileHandle,
    lastModified: number,
    itemCount?: number // 如果调用方已解析，可直接传入
  ): Promise<void> {
    if (!watchState.value.isActive) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      const uid = extractUidFromFilename(fileName) || 'unknown'
      console.log(`[FileWatch] Importing content: ${fileName} (UID: ${uid})`)

      // 使用 editorStore 的导入方法
      const importResult = await editorStore.importJSONAsScheme(content, fileName, lastModified)

      if (importResult.success) {
        console.log(`[FileWatch] Successfully imported: ${fileName}`)

        // 更新监控状态：记录上次导入的文件句柄
        watchState.value.lastImportedFileHandle = handle
        watchState.value.lastImportedFileName = fileName

        // 更新文件索引
        const cached = watchState.value.fileIndex.get(fileName)
        const finalItemCount = itemCount ?? getItemCountFromContent(content)
        watchState.value.fileIndex.set(fileName, {
          lastModified: lastModified,
          lastContent: content,
          itemCount: finalItemCount,
          firstDetectedAt: cached?.firstDetectedAt ?? lastModified,
        })

        notification.success(t('fileOps.import.success'))
        // 预加载图标和模型
        preloadActiveSchemeResources()
      } else {
        notification.error(
          t('fileOps.import.failed', { reason: importResult.error || 'Unknown error' })
        )
      }
    } catch (error: any) {
      console.error('[FileWatch] Failed to import:', error)
      notification.error(t('fileOps.import.failed', { reason: error.message || 'Unknown error' }))
    }
  }

  // 从监控的文件导入（重新查找最新文件，用于手动触发的导入操作）
  async function importFromWatchedFile(): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      // 重新查找最新文件（可能用户在游戏中保存了新文件）
      const result = await findLatestBuildSaveData(watchState.value.dirHandle)
      if (!result) {
        notification.warning(t('fileOps.importWatched.notFound'))
        return
      }

      // 读取文件内容并复用 importFromContent
      const content = await result.file.text()
      await importFromContent(content, result.file.name, result.handle, result.file.lastModified)
    } catch (error: any) {
      console.error('[FileWatch] Failed to import from watched file:', error)
      notification.error(t('fileOps.import.failed', { reason: error.message || 'Unknown error' }))
    }
  }

  // 获取监控历史（按时间倒序）
  function getWatchHistory() {
    return watchState.value.updateHistory
  }

  // 清空监控历史（仅会话内）
  function clearWatchHistory() {
    watchState.value.updateHistory = []
  }

  // 删除单条历史记录
  async function deleteHistoryRecord(historyId: string): Promise<void> {
    try {
      // 从 IndexedDB 删除
      await WatchHistoryDB.delete(historyId)

      // 从内存中的历史列表删除
      const index = watchState.value.updateHistory.findIndex((h) => h.id === historyId)
      if (index !== -1) {
        watchState.value.updateHistory.splice(index, 1)
      }

      console.log(`[FileWatch] Deleted history record: ${historyId}`)
    } catch (error) {
      console.error('[FileWatch] Failed to delete history record:', error)
      throw error
    }
  }

  // 从监控历史导入
  async function importFromHistory(historyId: string): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      // 从 IndexedDB 读取历史快照
      const snapshot = await WatchHistoryDB.get(historyId)

      if (!snapshot) {
        notification.warning(t('fileOps.importWatched.notFound'))
        return
      }

      // 获取文件句柄（用于后续保存）
      const handle = await watchState.value.dirHandle.getFileHandle(snapshot.fileName)

      // 导入内容（传入已知的 itemCount 避免重复解析）
      await importFromContent(
        snapshot.content,
        snapshot.fileName,
        handle,
        snapshot.lastModified,
        snapshot.itemCount
      )

      console.log(`[FileWatch] Imported from history: ${historyId}`)
    } catch (error: any) {
      console.error('[FileWatch] Failed to import from history:', error)
      notification.error(t('fileOps.import.failed', { reason: error.message || 'Unknown error' }))
    }
  }

  // 从方案码导入
  async function importFromCode(code: string): Promise<void> {
    try {
      ensureResourcesReady()

      // 构建API URL
      const apiUrl = `https://nuan5.pro/api/home/code/${encodeURIComponent(code)}?export=save-data`

      // 调用API获取数据
      const response = await fetch(apiUrl)

      if (!response.ok) {
        if (response.status === 404) {
          notification.error(t('fileOps.importCode.notFound'))
        } else {
          notification.error(t('fileOps.importCode.networkError', { reason: response.statusText }))
        }
        return
      }

      // 解析JSON
      const jsonData = await response.json()

      // 验证数据格式：API返回格式为 { data: [...] }
      if (!jsonData || !jsonData.data || !Array.isArray(jsonData.data)) {
        notification.error(t('fileOps.importCode.parseError'))
        return
      }

      // 包装成完整的 GameDataFile 格式
      const gameDataFile: GameDataFile = {
        NeedRestore: true,
        PlaceInfo: jsonData.data,
      }

      // 使用多方案导入API
      const result = await editorStore.importJSONAsScheme(
        JSON.stringify(gameDataFile),
        `Scheme_${code}`,
        Date.now()
      )

      if (result.success) {
        console.log(`[FileOps] Successfully imported scheme from code: ${code}`)
        notification.success(t('fileOps.importCode.success'))
        // 预加载图标和模型
        preloadActiveSchemeResources()
      } else {
        notification.error(t('fileOps.import.failed', { reason: result.error || 'Unknown error' }))
      }
    } catch (error: any) {
      console.error('[FileOps] Failed to import from code:', error)
      notification.error(
        t('fileOps.importCode.networkError', { reason: error.message || 'Unknown error' })
      )
    }
  }

  // 组件卸载时清理
  onUnmounted(() => {
    stopPolling()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  return {
    importJSON,
    importFromCode,
    exportJSON,
    saveToGame,
    isFileSystemAccessSupported,
    // 监控相关
    watchState,
    startWatchMode,
    stopWatchMode,
    importFromWatchedFile,
    checkFileUpdate,
    getWatchHistory,
    clearWatchHistory,
    deleteHistoryRecord,
    importFromHistory,
  }
}

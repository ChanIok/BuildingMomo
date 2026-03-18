import { ref } from 'vue'
import type { useEditorStore } from '@/stores/editorStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import type { useNotification } from '@/composables/useNotification'
import type { FileWatchState, GameDataFile, GameItem } from '@/types/editor'
import { WatchHistoryDB } from '@/lib/watchHistoryStore'
import { WatchHandleStore } from '@/lib/watchHandleStore'
import {
  SAVE_DATA_FILENAME_REGEX,
  extractUidFromSaveDataFilename,
  findBuildDataDirectory,
  findBuildRecordDirectory,
  findLatestBuildRecord,
  findLatestBuildSaveData,
  isBuildSaveDataFile,
} from './watchMode.fs'
import { buildRecordPayloadFromGameItems, parseBuildRecordToGameData } from './watchMode.record'

// 监听历史最多保留 30 条
const MAX_WATCH_HISTORY = 30
// 页面可见时的轮询间隔（3 秒）
const POLL_INTERVAL_ACTIVE = 3000
// 页面隐藏时降低轮询频率以节省资源（10 秒）
const POLL_INTERVAL_HIDDEN = 10000
// 目录选择器 ID：让浏览器记住上次打开位置
const WATCH_DIRECTORY_PICKER_ID = 'momo-watch-root'

type TranslateFn = (key: string, params?: Record<string, string | number>) => string

interface CreateWatchModeOpsParams {
  editorStore: ReturnType<typeof useEditorStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  notification: ReturnType<typeof useNotification>
  t: TranslateFn
  ensureResourcesReady: () => void
  preloadActiveSchemeResources: () => void
  prepareDataForSave: () => Promise<GameItem[] | null>
}

interface DirectoryResolveResult {
  rootDirHandle: FileSystemDirectoryHandle
  buildDataDir: FileSystemDirectoryHandle
  buildRecordDirHandle: FileSystemDirectoryHandle | null
}

type ActivateWatchMode = 'silent' | 'interactive'

/** 从 JSON 字符串中快速读取 PlaceInfo 条目数量，解析失败返回 0 */
function getItemCountFromContent(content: string): number {
  try {
    const jsonData = JSON.parse(content)
    return Array.isArray(jsonData?.PlaceInfo) ? jsonData.PlaceInfo.length : 0
  } catch {
    return 0
  }
}

export function createWatchModeOps(params: CreateWatchModeOpsParams) {
  const {
    editorStore,
    settingsStore,
    notification,
    t,
    ensureResourcesReady,
    preloadActiveSchemeResources,
    prepareDataForSave,
  } = params

  // 监听模式的全局响应式状态
  const watchState = ref<FileWatchState>({
    isActive: false,
    dirHandle: null,
    dirPath: '',
    lastCheckedTime: 0,
    fileIndex: new Map(), // 文件名 → 上次已知内容快照，用于变更检测
    updateHistory: [],
    lastImportedFileHandle: null,
    lastImportedFileName: '',
  })

  // setTimeout 返回的计时器 ID，null 表示轮询未启动
  let pollTimer: number | null = null
  // 根目录句柄，用于在游戏运行后懒加载发现 BuildRecord 目录
  let rootDirHandle: FileSystemDirectoryHandle | null = null
  // BuildRecord 目录句柄（懒加载缓存），首次使用时自动查找
  let buildRecordDirHandle: FileSystemDirectoryHandle | null = null

  /**
   * 懒加载获取 BuildRecord 目录句柄。
   * 首次调用时尝试从 rootDirHandle 中查找并缓存，之后直接复用。
   * 支持游戏启动后 BuildRecord 目录动态出现的场景。
   */
  async function getOrFindBuildRecordDir(): Promise<FileSystemDirectoryHandle | null> {
    if (buildRecordDirHandle) return buildRecordDirHandle
    if (!rootDirHandle) return null
    buildRecordDirHandle = await findBuildRecordDirectory(rootDirHandle)
    return buildRecordDirHandle
  }

  /**
   * 将一次文件更新记录持久化到 IndexedDB，并同步更新内存中的 updateHistory。
   * 若同一 id 已存在于内存历史中则跳过插入，超出上限时移除最旧一条。
   */
  async function addToWatchHistory(
    fileName: string,
    content: string,
    itemCount: number,
    lastModified: number
  ): Promise<void> {
    const historyId = `${fileName}_${lastModified}`
    const detectedAt = Date.now()
    const size = new Blob([content]).size

    try {
      await WatchHistoryDB.save({
        id: historyId,
        fileName,
        content,
        itemCount,
        lastModified,
        detectedAt,
        size,
      })
      console.log(`[FileWatch] Saved to history DB: ${historyId}`)
    } catch (error) {
      console.error('[FileWatch] Failed to save to history DB:', error)
    }

    const history = watchState.value.updateHistory
    if (!history.some((h) => h.id === historyId)) {
      history.unshift({
        id: historyId,
        name: fileName,
        lastModified,
        itemCount,
        detectedAt,
        size,
      })
      if (history.length > MAX_WATCH_HISTORY) {
        history.pop()
      }
    }

    // 异步清理 IndexedDB 中超出上限的旧记录
    WatchHistoryDB.clearOld(MAX_WATCH_HISTORY).catch((err) =>
      console.error('[FileWatch] Failed to clean old history:', err)
    )
  }

  /**
   * 检查并申请句柄的读写权限。
   * 已授权时直接返回 true；未授权时弹出浏览器权限请求对话框。
   */
  async function queryPermissionState(handle: FileSystemHandle): Promise<PermissionState> {
    const options = { mode: 'readwrite' as const }
    return (await (handle as any).queryPermission(options)) as PermissionState
  }

  async function verifyPermission(handle: FileSystemHandle): Promise<boolean> {
    const options = { mode: 'readwrite' as const }
    if ((await queryPermissionState(handle)) === 'granted') return true
    if ((await (handle as any).requestPermission(options)) === 'granted') return true
    return false
  }

  async function tryRestoreWatchDirectories(): Promise<DirectoryResolveResult | null> {
    const rootDirHandle = await WatchHandleStore.getRootHandle()
    if (!rootDirHandle) return null

    try {
      const hasPermission = (await queryPermissionState(rootDirHandle)) === 'granted'
      if (!hasPermission) {
        console.log('[FileWatch] Stored directory handle exists but permission was not granted')
        return null
      }

      const buildDataDir = await findBuildDataDirectory(rootDirHandle)
      if (!buildDataDir) {
        console.warn(
          '[FileWatch] Stored directory handle no longer contains BuildData, clearing cache'
        )
        await WatchHandleStore.clearRootHandle()
        return null
      }

      const restoredBuildRecordDirHandle = await findBuildRecordDirectory(rootDirHandle)
      console.log('[FileWatch] Restored directory handle from IndexedDB:', rootDirHandle.name)
      return {
        rootDirHandle,
        buildDataDir,
        buildRecordDirHandle: restoredBuildRecordDirHandle,
      }
    } catch (error) {
      console.warn('[FileWatch] Failed to restore stored directory handle:', error)
      await WatchHandleStore.clearRootHandle()
      return null
    }
  }

  async function pickWatchDirectories(): Promise<DirectoryResolveResult | null> {
    const rootDirHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      id: WATCH_DIRECTORY_PICKER_ID,
    })

    console.log('[FileWatch] Selected directory for monitoring:', rootDirHandle.name)

    const buildDataDir = await findBuildDataDirectory(rootDirHandle)
    if (!buildDataDir) {
      notification.error(t('fileOps.watch.noBuildData'))
      return null
    }

    const pickedBuildRecordDirHandle = await findBuildRecordDirectory(rootDirHandle)
    await WatchHandleStore.saveRootHandle(rootDirHandle)
    return {
      rootDirHandle,
      buildDataDir,
      buildRecordDirHandle: pickedBuildRecordDirHandle,
    }
  }

  async function activateWatchModeFromDirectories(
    resolved: DirectoryResolveResult,
    mode: ActivateWatchMode
  ): Promise<void> {
    const { buildDataDir } = resolved
    rootDirHandle = resolved.rootDirHandle
    buildRecordDirHandle = resolved.buildRecordDirHandle

    // BuildRecord 目录可选，首次未找到时后续操作仍会懒加载重试
    if (buildRecordDirHandle) {
      console.log('[FileWatch] Found BuildRecord directory:', buildRecordDirHandle.name)
    } else {
      console.log('[FileWatch] BuildRecord directory not found, will retry lazily on use')
    }

    console.log('[FileWatch] Found BuildData directory:', buildDataDir.name)

    // 找到最新存档文件（用于初始导入询问）
    const result = await findLatestBuildSaveData(buildDataDir)

    const fileHandle = result?.handle ?? null
    const fileName = result?.file.name ?? ''
    const lastModified = result?.file.lastModified ?? 0

    if (result) {
      console.log(`[FileWatch] Found existing file: ${fileName}`)
    } else {
      console.log('[FileWatch] No existing file found, will monitor for new files')
    }

    // 为 BuildData 中所有现有存档建立 fileIndex 快照，作为变更检测基线
    const fileIndex = new Map<
      string,
      { lastModified: number; lastContent: string; itemCount: number; firstDetectedAt: number }
    >()

    for await (const entry of (buildDataDir as any).values()) {
      if (entry.kind === 'file' && isBuildSaveDataFile(entry.name)) {
        const entryHandle = entry as FileSystemFileHandle
        const file = await entryHandle.getFile()
        const content = await file.text()
        fileIndex.set(entry.name, {
          lastModified: file.lastModified,
          lastContent: content,
          itemCount: getItemCountFromContent(content),
          firstDetectedAt: file.lastModified,
        })
      }
    }

    // fileIndex 扫描已读取了所有文件内容，直接取缓存，避免再次读取磁盘
    const latestContent = fileName ? fileIndex.get(fileName)?.lastContent : undefined

    // 从 IndexedDB 恢复历史记录（按时间倒序，最多 MAX_WATCH_HISTORY 条）
    let restoredHistory: typeof watchState.value.updateHistory = []
    try {
      const allMetadata = await WatchHistoryDB.getAllMetadata()
      restoredHistory = allMetadata.slice(0, MAX_WATCH_HISTORY)
      console.log(`[FileWatch] Restored ${restoredHistory.length} history records from IndexedDB`)
    } catch (error) {
      console.error('[FileWatch] Failed to restore history from IndexedDB:', error)
      restoredHistory = watchState.value.updateHistory
    }

    // 激活监听状态
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

    console.log('[FileWatch] Activated monitoring root:', rootDirHandle.name)

    // 启动轮询
    startPolling()

    if (mode === 'silent') {
      return
    }

    // 若最新存档 NeedRestore 为 true，询问用户是否立即导入
    if (result && latestContent !== undefined) {
      try {
        const jsonData = JSON.parse(latestContent)

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
            const itemCount = getItemCountFromContent(latestContent)
            await addToWatchHistory(fileName, latestContent, itemCount, lastModified)
          }
        } else {
          notification.success(t('fileOps.watch.started'))
        }
      } catch (error) {
        console.error('[FileWatch] Failed to parse JSON:', error)
        notification.warning(t('fileOps.watch.parseFailed'))
      }
    } else {
      notification.success(t('fileOps.watch.started'))
    }
  }

  /**
   * 将已读取的文件内容导入为 scheme 的核心实现。
   *
   * @param updateWatchState 为 true 时更新 fileIndex 与 lastImportedFile*，
   *   从 BuildRecord 导入时传 false 以避免污染 BuildData 的文件索引。
   */
  async function importFromContentInternal(
    content: string,
    fileName: string,
    handle: FileSystemFileHandle,
    lastModified: number,
    itemCount?: number,
    updateWatchState: boolean = true
  ): Promise<void> {
    if (!watchState.value.isActive) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      const uid = extractUidFromSaveDataFilename(fileName) || 'unknown'
      console.log(`[FileWatch] Importing content: ${fileName} (UID: ${uid})`)

      // 调用 editorStore 解析 JSON 并创建/更新对应的 scheme tab
      const importResult = await editorStore.importJSONAsScheme(content, fileName, lastModified)

      if (importResult.success) {
        console.log(`[FileWatch] Successfully imported: ${fileName}`)
        if (updateWatchState) {
          // 记录最后一次导入的文件，供 saveToGame 用作写回目标
          watchState.value.lastImportedFileHandle = handle
          watchState.value.lastImportedFileName = fileName

          const cached = watchState.value.fileIndex.get(fileName)
          const finalItemCount = itemCount ?? getItemCountFromContent(content)
          watchState.value.fileIndex.set(fileName, {
            lastModified: lastModified,
            lastContent: content,
            itemCount: finalItemCount,
            firstDetectedAt: cached?.firstDetectedAt ?? lastModified,
          })
        }

        notification.success(t('fileOps.import.success'))
        // 提前预加载当前 scheme 所需的 3D 资源
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

  /** 从 BuildData JSON 文件内容导入（更新 fileIndex） */
  async function importFromContent(
    content: string,
    fileName: string,
    handle: FileSystemFileHandle,
    lastModified: number,
    itemCount?: number
  ): Promise<void> {
    await importFromContentInternal(content, fileName, handle, lastModified, itemCount, true)
  }

  /** 从 BuildRecord 文件内容导入（不更新 fileIndex，避免污染 BuildData 索引） */
  async function importFromRecordContent(
    content: string,
    fileName: string,
    handle: FileSystemFileHandle,
    lastModified: number,
    itemCount?: number
  ): Promise<void> {
    await importFromContentInternal(content, fileName, handle, lastModified, itemCount, false)
  }

  /**
   * 将当前活跃 scheme 的数据写回游戏存档文件。
   *
   * 写入目标文件的优先级：
   *   1. scheme 的 filePath 对应的合法存档文件（UID 不是 13 位时视为普通 ID）
   *   2. 上一次导入的文件（lastImportedFileHandle）
   *   3. BuildData 目录中最新的存档文件
   *
   * 写入存档后，若找到了 BuildRecord 目录，还会同步更新最新的 .record 文件。
   */
  async function saveToGame(): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.saveToGame.noDir'))
      return
    }

    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      notification.warning(t('fileOps.saveToGame.noData'))
      return
    }

    // 准备经过验证、修正后的导出数据
    const gameItems = await prepareDataForSave()
    if (!gameItems) return

    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    let handle: FileSystemFileHandle | null = null
    let finalFileName = ''

    const currentFileName = editorStore.activeScheme?.filePath.value
    const match = currentFileName?.match(SAVE_DATA_FILENAME_REGEX)

    // UID 恰好为 13 位时通常是游戏自动生成的临时 ID，不作为写入目标
    const isValidName = !!(match?.[2] && match[2].length !== 13)

    try {
      // 按优先级确定写入目标文件句柄
      if (isValidName && currentFileName) {
        handle = await watchState.value.dirHandle.getFileHandle(currentFileName, {
          create: true,
        })
        finalFileName = currentFileName
      } else {
        if (watchState.value.lastImportedFileHandle) {
          handle = watchState.value.lastImportedFileHandle
          finalFileName = watchState.value.lastImportedFileName
        } else {
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

      // 写入前确保拥有写权限
      const permission = await verifyPermission(handle)
      if (!permission) {
        notification.error(t('fileOps.saveToGame.noPermission'))
        return
      }

      // 写入存档 JSON
      const writable = await handle.createWritable()
      await writable.write(jsonString)
      await writable.close()

      // 读取写入后的实际 lastModified，加 1000ms 偏移量防止轮询误判为外部变更
      const updatedFile = await handle.getFile()
      const cached = watchState.value.fileIndex.get(finalFileName)
      watchState.value.lastImportedFileHandle = handle
      watchState.value.lastImportedFileName = finalFileName
      watchState.value.fileIndex.set(finalFileName, {
        lastModified: updatedFile.lastModified + 1000,
        lastContent: jsonString,
        itemCount: gameItems.length,
        firstDetectedAt: cached?.firstDetectedAt ?? updatedFile.lastModified,
      })

      // 如果有 BuildRecord 目录，同步写入最新的 .record 文件（懒加载，游戏运行后自动发现）
      const recordDir = await getOrFindBuildRecordDir()
      if (recordDir) {
        try {
          const latestRecord = await findLatestBuildRecord(recordDir)
          if (latestRecord) {
            const recordPermission = await verifyPermission(latestRecord.handle)
            if (recordPermission) {
              const recordPayload = buildRecordPayloadFromGameItems(gameItems)
              const recordWritable = await latestRecord.handle.createWritable()
              await recordWritable.write(JSON.stringify(recordPayload))
              await recordWritable.close()
              console.log(`[FileOps] Synced save to latest BuildRecord: ${latestRecord.file.name}`)
            } else {
              console.warn('[FileOps] No write permission for latest BuildRecord file')
            }
          }
        } catch (recordError) {
          console.warn('[FileOps] Failed to sync latest BuildRecord file:', recordError)
        }
      }

      console.log(`[FileOps] Successfully saved to game: ${finalFileName}`)
      notification.success(t('fileOps.saveToGame.success'))
    } catch (error: any) {
      console.error('[FileOps] Failed to save to game:', error)
      notification.error(
        t('fileOps.saveToGame.failed', { reason: error.message || 'Unknown error' })
      )
    }
  }

  /**
   * 单次文件变更检测。
   * 遍历 BuildData 目录中所有存档文件，与 fileIndex 中的缓存比较 lastModified。
   * 有变更时读取内容，过滤掉内容未实际改变的情况（时间戳更新但内容相同）。
   * 多个文件同时更新时只取 lastModified 最新的一个触发导入通知。
   * 返回 true 表示本次检测检到了真实内容变更。
   */
  async function checkFileUpdate(): Promise<boolean> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      return false
    }

    try {
      watchState.value.lastCheckedTime = Date.now()

      // 第一轮：找出所有 lastModified 有变化的文件
      const updates: Array<{ name: string; file: File; handle: FileSystemFileHandle }> = []

      for await (const entry of (watchState.value.dirHandle as any).values()) {
        if (entry.kind !== 'file' || !isBuildSaveDataFile(entry.name)) continue

        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        const cached = watchState.value.fileIndex.get(entry.name)

        if (!cached || file.lastModified > cached.lastModified) {
          updates.push({ name: entry.name, file, handle: fileHandle })
        }
      }

      if (updates.length === 0) {
        return false
      }

      // 第二轮：读取内容，过滤内容不变的情况，找出真正更新的最新文件
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

        if (content === cached?.lastContent) {
          // 文件被触碰（如 saveToGame 写入后），但内容相同，仅更新时间戳缓存
          console.log(`[FileWatch] File touched but content identical: ${name}`)
          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: cached.lastContent,
            itemCount: cached.itemCount ?? 0,
            firstDetectedAt: cached.firstDetectedAt ?? file.lastModified,
          })
          continue
        }

        try {
          const jsonData = JSON.parse(content)
          const itemCount = Array.isArray(jsonData?.PlaceInfo) ? jsonData.PlaceInfo.length : 0
          // 只有 NeedRestore === true 的文件才视为有效的游戏存档变更
          if (jsonData.NeedRestore === true) {
            if (file.lastModified > latestModified) {
              latestModified = file.lastModified
              latestFile = { name, file, handle, content, itemCount }
            }
          }

          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: content,
            itemCount,
            firstDetectedAt: cached?.firstDetectedAt ?? file.lastModified,
          })
        } catch (parseError) {
          console.error(`[FileWatch] Failed to parse JSON for ${name}:`, parseError)
          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: content,
            itemCount: 0,
            firstDetectedAt: cached?.firstDetectedAt ?? file.lastModified,
          })
        }
      }

      if (latestFile) {
        // 持久化到历史记录
        await addToWatchHistory(
          latestFile.name,
          latestFile.content,
          latestFile.itemCount,
          latestFile.file.lastModified
        )

        console.log(
          `[FileWatch] File updated: ${latestFile.name}, lastModified: ${new Date(latestFile.file.lastModified).toLocaleString()}`
        )
        // 若启用了更新通知，弹出确认对话框；用户确认后导入
        if (settingsStore.settings.enableWatchNotification) {
          notification
            .fileUpdate(latestFile.name, latestFile.file.lastModified)
            .then((confirmed) => {
              if (confirmed) {
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

  /** 页面从后台切回前台时立即触发一次检测，避免等待下一个轮询周期 */
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && watchState.value.isActive) {
      console.log('[FileWatch] Page visible, checking for updates...')
      checkFileUpdate()
    }
  }

  /**
   * 启动轮询循环。
   * 采用自适应间隔：页面可见时 3s，隐藏时 10s。
   * 重复调用不会创建多个计时器。
   */
  function startPolling() {
    if (pollTimer !== null) {
      return
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    const poll = async () => {
      await checkFileUpdate()
      const interval = document.hidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_ACTIVE
      pollTimer = window.setTimeout(poll, interval)
    }

    poll()
  }

  /** 停止轮询并移除 visibilitychange 监听器 */
  function stopPolling() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  /**
   * 启动监听模式的完整流程：
   *   1. 优先从 IndexedDB 恢复已授权目录，非 granted 时直接弹目录选择器
   *   2. 在目录中定位 BuildData（必须）和 BuildRecord（可选）子目录
   *   3. 扫描并缓存 BuildData 中所有现有存档文件的快照（fileIndex）
   *   4. 从 IndexedDB 恢复历史监听记录
   *   5. 启动轮询
   *   6. 若存在最新存档且 NeedRestore 为 true，询问用户是否立即导入
   */
  async function startWatchMode(): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      notification.error(t('fileOps.watch.notSupported'))
      return
    }

    if (watchState.value.isActive) {
      return
    }

    ensureResourcesReady()

    try {
      // 步骤 1：优先恢复已授权目录；非 granted 时回退到目录选择器
      const restored = await tryRestoreWatchDirectories()
      const resolved = restored ?? (await pickWatchDirectories())
      if (!resolved) return

      if (!restored) {
        console.log('[FileWatch] Directory authorization persisted:', resolved.rootDirHandle.name)
      }
      await activateWatchModeFromDirectories(resolved, 'interactive')
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 用户主动取消目录选择，不报错
        console.log('[FileWatch] User cancelled directory picker')
        return
      }
      console.error('[FileWatch] Failed to start watch mode:', error)
      notification.error(
        t('fileOps.watch.startFailed', { reason: error.message || 'Unknown error' })
      )
    }
  }

  async function restoreWatchModeSilently(): Promise<boolean> {
    if (!('showDirectoryPicker' in window)) {
      return false
    }

    if (watchState.value.isActive) {
      return true
    }

    ensureResourcesReady()

    try {
      const restored = await tryRestoreWatchDirectories()
      if (!restored) return false

      await activateWatchModeFromDirectories(restored, 'silent')
      console.log('[FileWatch] Silently restored watch mode')
      return true
    } catch (error) {
      console.warn('[FileWatch] Silent restore failed:', error)
      return false
    }
  }

  /** 停止监听模式，清理状态（保留历史记录列表供 UI 继续显示） */
  function stopWatchMode() {
    stopPolling()
    rootDirHandle = null
    buildRecordDirHandle = null
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

  /**
   * 手动触发"从监听目录导入最新文件"。
   *
   * 优先尝试从 BuildRecord（.record 文件）导入，因为它包含更完整的游戏状态；
   * 若 BuildRecord 不存在或解析失败，则回退到 BuildData 中的最新 JSON 存档。
   */
  async function importFromWatchedFile(): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      // 优先路径：尝试从 BuildRecord 中读取最新的 .record 文件（懒加载，游戏运行后自动发现）
      const recordDir = await getOrFindBuildRecordDir()
      if (recordDir) {
        const latestRecord = await findLatestBuildRecord(recordDir)
        if (latestRecord) {
          try {
            console.log('[FileWatch] Found latest BuildRecord:', latestRecord.file.name)
            const recordContent = await latestRecord.file.text()
            // 将 .record 格式转换为标准 GameDataFile 后导入
            const parsed = parseBuildRecordToGameData(recordContent)
            const content = JSON.stringify(parsed)
            await importFromRecordContent(
              content,
              latestRecord.file.name,
              latestRecord.handle,
              latestRecord.file.lastModified,
              parsed.PlaceInfo.length
            )
            return
          } catch (recordParseError) {
            console.warn(
              '[FileWatch] Failed to parse latest BuildRecord, fallback to BuildData:',
              recordParseError
            )
          }
        }
      }

      // 回退路径：直接读取 BuildData 中最新的存档 JSON
      const result = await findLatestBuildSaveData(watchState.value.dirHandle)
      if (!result) {
        notification.warning(t('fileOps.importWatched.notFound'))
        return
      }

      const content = await result.file.text()
      await importFromContent(content, result.file.name, result.handle, result.file.lastModified)
    } catch (error: any) {
      console.error('[FileWatch] Failed to import from watched file:', error)
      notification.error(t('fileOps.import.failed', { reason: error.message || 'Unknown error' }))
    }
  }

  /** 返回内存中的监听历史列表（响应式数组引用） */
  function getWatchHistory() {
    return watchState.value.updateHistory
  }

  /** 清空内存中的监听历史列表（不影响 IndexedDB） */
  function clearWatchHistory() {
    watchState.value.updateHistory = []
  }

  /** 删除指定历史记录（同时从 IndexedDB 和内存列表中移除） */
  async function deleteHistoryRecord(historyId: string): Promise<void> {
    try {
      await WatchHistoryDB.delete(historyId)
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

  /**
   * 从历史记录中导入指定快照。
   * 从 IndexedDB 读取完整内容后走正常的 importFromContent 流程。
   */
  async function importFromHistory(historyId: string): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      const snapshot = await WatchHistoryDB.get(historyId)

      if (!snapshot) {
        notification.warning(t('fileOps.importWatched.notFound'))
        return
      }

      // 通过目录句柄获取对应文件的 handle（用于后续写回）
      const handle = await watchState.value.dirHandle.getFileHandle(snapshot.fileName)
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

  return {
    watchState,
    startWatchMode,
    restoreWatchModeSilently,
    stopWatchMode,
    importFromWatchedFile,
    checkFileUpdate,
    getWatchHistory,
    clearWatchHistory,
    deleteHistoryRecord,
    importFromHistory,
    saveToGame,
    cleanup: stopPolling,
  }
}

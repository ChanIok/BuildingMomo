import { ref } from 'vue'
import type { useEditorStore } from '@/stores/editorStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import type { useNotification } from '@/composables/useNotification'
import type { FileWatchState, GameDataFile, GameItem } from '@/types/editor'
import { WatchHistoryDB } from '@/lib/watchHistoryStore'

const MAX_WATCH_HISTORY = 30
const POLL_INTERVAL_ACTIVE = 3000
const POLL_INTERVAL_HIDDEN = 10000

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

function extractUidFromFilename(filename: string): string | null {
  const match = filename.match(/BUILD_SAVEDATA_(\d+)\.json/)
  return match?.[1] ?? null
}

function isBuildSaveDataFile(name: string): boolean {
  return /^BUILD_SAVEDATA_\d+\.json$/.test(name)
}

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

async function findBuildDataDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  if (dirHandle.name === 'BuildData') {
    return dirHandle
  }

  try {
    return await dirHandle.getDirectoryHandle('BuildData')
  } catch {
    // continue
  }

  try {
    const x6Game = await dirHandle.getDirectoryHandle('X6Game')
    const result = await resolvePath(x6Game, ['Saved', 'SavedData', 'BuildData'])
    if (result) return result
  } catch {
    // continue
  }

  try {
    const saved = await dirHandle.getDirectoryHandle('Saved')
    const result = await resolvePath(saved, ['SavedData', 'BuildData'])
    if (result) return result
  } catch {
    // continue
  }

  try {
    const savedData = await dirHandle.getDirectoryHandle('SavedData')
    const result = await resolvePath(savedData, ['BuildData'])
    if (result) return result
  } catch {
    // continue
  }

  return null
}

function getItemCountFromContent(content: string): number {
  try {
    const jsonData = JSON.parse(content)
    return Array.isArray(jsonData?.PlaceInfo) ? jsonData.PlaceInfo.length : 0
  } catch {
    return 0
  }
}

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

  buildFiles.sort((a, b) => b.file.lastModified - a.file.lastModified)
  return buildFiles[0] ?? null
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

  let pollTimer: number | null = null

  async function addToWatchHistory(
    fileName: string,
    content: string,
    itemCount: number,
    lastModified: number
  ): Promise<void> {
    const historyId = `${fileName}_${lastModified}`
    const size = new Blob([content]).size

    try {
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

    WatchHistoryDB.clearOld(MAX_WATCH_HISTORY).catch((err) =>
      console.error('[FileWatch] Failed to clean old history:', err)
    )
  }

  async function verifyPermission(
    fileHandle: FileSystemFileHandle,
    readWrite: boolean
  ): Promise<boolean> {
    const options: any = {}
    if (readWrite) {
      options.mode = 'readwrite'
    }

    if ((await (fileHandle as any).queryPermission(options)) === 'granted') {
      return true
    }

    if ((await (fileHandle as any).requestPermission(options)) === 'granted') {
      return true
    }

    return false
  }

  async function importFromContent(
    content: string,
    fileName: string,
    handle: FileSystemFileHandle,
    lastModified: number,
    itemCount?: number
  ): Promise<void> {
    if (!watchState.value.isActive) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
      const uid = extractUidFromFilename(fileName) || 'unknown'
      console.log(`[FileWatch] Importing content: ${fileName} (UID: ${uid})`)

      const importResult = await editorStore.importJSONAsScheme(content, fileName, lastModified)

      if (importResult.success) {
        console.log(`[FileWatch] Successfully imported: ${fileName}`)

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

        notification.success(t('fileOps.import.success'))
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

  async function saveToGame(): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.saveToGame.noDir'))
      return
    }

    if ((editorStore.activeScheme?.items.value.length ?? 0) === 0) {
      notification.warning(t('fileOps.saveToGame.noData'))
      return
    }

    const gameItems = await prepareDataForSave()
    if (!gameItems) return

    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    let handle: FileSystemFileHandle | null = null
    let finalFileName = ''

    const currentFileName = editorStore.activeScheme?.filePath.value
    const match = currentFileName?.match(/^BUILD_SAVEDATA_(\d+)\.json$/)

    let isValidName = false
    if (match && match[1]) {
      const idPart = match[1]
      if (idPart.length !== 13) {
        isValidName = true
      }
    }

    try {
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

      const permission = await verifyPermission(handle, true)
      if (!permission) {
        notification.error(t('fileOps.saveToGame.noPermission'))
        return
      }

      const writable = await handle.createWritable()
      await writable.write(jsonString)
      await writable.close()

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

      console.log(`[FileOps] Successfully saved to game: ${finalFileName}`)
      notification.success(t('fileOps.saveToGame.success'))
    } catch (error: any) {
      console.error('[FileOps] Failed to save to game:', error)
      notification.error(
        t('fileOps.saveToGame.failed', { reason: error.message || 'Unknown error' })
      )
    }
  }

  async function checkFileUpdate(): Promise<boolean> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      return false
    }

    try {
      watchState.value.lastCheckedTime = Date.now()

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
          if (file.lastModified > latestModified) {
            latestModified = file.lastModified
            latestFile = { name, file, handle, content, itemCount: 0 }
          }

          watchState.value.fileIndex.set(name, {
            lastModified: file.lastModified,
            lastContent: content,
            itemCount: 0,
            firstDetectedAt: cached?.firstDetectedAt ?? file.lastModified,
          })
        }
      }

      if (latestFile) {
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

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && watchState.value.isActive) {
      console.log('[FileWatch] Page visible, checking for updates...')
      checkFileUpdate()
    }
  }

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

  function stopPolling() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  async function startWatchMode(): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      notification.error(t('fileOps.watch.notSupported'))
      return
    }

    ensureResourcesReady()

    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      })

      console.log('[FileWatch] Selected directory for monitoring:', dirHandle.name)

      const buildDataDir = await findBuildDataDirectory(dirHandle)
      if (!buildDataDir) {
        notification.error(t('fileOps.watch.noBuildData'))
        return
      }

      console.log('[FileWatch] Found BuildData directory:', buildDataDir.name)

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

      let restoredHistory: typeof watchState.value.updateHistory = []
      try {
        const allMetadata = await WatchHistoryDB.getAllMetadata()
        restoredHistory = allMetadata.slice(0, MAX_WATCH_HISTORY)
        console.log(`[FileWatch] Restored ${restoredHistory.length} history records from IndexedDB`)
      } catch (error) {
        console.error('[FileWatch] Failed to restore history from IndexedDB:', error)
        restoredHistory = watchState.value.updateHistory
      }

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

      startPolling()

      if (result) {
        try {
          const content = await result.file.text()
          const jsonData = JSON.parse(content)

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
              const itemCount = getItemCountFromContent(content)
              await addToWatchHistory(fileName, content, itemCount, lastModified)
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

  async function importFromWatchedFile(): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning(t('fileOps.importWatched.notStarted'))
      return
    }

    try {
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

  function getWatchHistory() {
    return watchState.value.updateHistory
  }

  function clearWatchHistory() {
    watchState.value.updateHistory = []
  }

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

  function cleanup() {
    stopPolling()
  }

  return {
    watchState,
    startWatchMode,
    stopWatchMode,
    importFromWatchedFile,
    checkFileUpdate,
    getWatchHistory,
    clearWatchHistory,
    deleteHistoryRecord,
    importFromHistory,
    saveToGame,
    cleanup,
  }
}

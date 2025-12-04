import { ref, onUnmounted } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { GameDataFile, GameItem, FileWatchState } from '../types/editor'
import { useNotification } from './useNotification'
import { useSettingsStore } from '../stores/settingsStore'
import type { AlertDetailItem } from '../stores/notificationStore'
import { storeToRefs } from 'pinia'
import { useValidationStore } from '../stores/validationStore'
import { getIconLoader } from './useIconLoader'
import { useI18n } from './useI18n'
import backgroundUrl from '@/assets/home.webp'

// 检查浏览器是否支持 File System Access API
const isFileSystemAccessSupported = 'showDirectoryPicker' in window

// 辅助函数：从文件名提取 UID
function extractUidFromFilename(filename: string): string | null {
  const match = filename.match(/BUILD_SAVEDATA_(\d+)\.json/)
  return match?.[1] ?? null
}

// 辅助函数：查找 BuildData 目录
async function findBuildDataDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  // 1. 当前目录就是 BuildData
  if (dirHandle.name === 'BuildData') {
    return dirHandle
  }

  // 2. 尝试直接找 BuildData 子目录
  try {
    const buildData = await dirHandle.getDirectoryHandle('BuildData')
    return buildData
  } catch {
    // BuildData 不是直接子目录，继续其他方式查找
  }

  // 3. 定义完整路径链
  const fullPath = ['InfinityNikki', 'X6Game', 'Saved', 'SavedData', 'BuildData']
  const startIndex = fullPath.indexOf(dirHandle.name)

  if (startIndex !== -1) {
    // 当前目录在路径链上，从下一个节点开始查找
    const remainingPath = fullPath.slice(startIndex + 1)
    let currentHandle = dirHandle

    for (const folderName of remainingPath) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(folderName)
        if (currentHandle.name === 'BuildData') {
          return currentHandle
        }
      } catch {
        break // 路径不存在，跳出
      }
    }
  } else {
    // 当前目录不在路径链上，尝试完整路径
    let currentHandle = dirHandle

    for (const folderName of fullPath) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(folderName)
        if (currentHandle.name === 'BuildData') {
          return currentHandle
        }
      } catch {
        break // 路径不存在，跳出
      }
    }
  }

  return null
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
  const notification = useNotification()
  const { t } = useI18n()
  const fileInputRef = ref<HTMLInputElement | null>(null)

  // 辅助函数：预加载图片
  function preloadImage(url: string) {
    const img = new Image()
    img.src = url
  }

  // 辅助函数：预加载当前方案的图标
  function preloadActiveSchemeIcons() {
    if (editorStore.activeScheme) {
      // items 是 ShallowRef，需要访问 .value
      const uniqueIds = [...new Set(editorStore.activeScheme.items.value.map((i) => i.gameId))]
      getIconLoader().preloadIcons(uniqueIds)
    }
  }

  const settingsStore = useSettingsStore()
  const validationStore = useValidationStore()
  const { hasDuplicate, duplicateItemCount, hasLimitIssues, limitIssues } =
    storeToRefs(validationStore)

  // 文件监控状态
  const watchState = ref<FileWatchState>({
    isActive: false,
    dirHandle: null,
    dirPath: '',
    lastCheckedTime: 0,
    lastModifiedTime: 0,
    fileHandle: null,
    fileName: '',
    lastContent: undefined,
  })

  // 轮询定时器
  let pollTimer: number | null = null

  // 轮询间隔配置
  const POLL_INTERVAL_ACTIVE = 3000 // 页面活跃时：3秒
  const POLL_INTERVAL_HIDDEN = 10000 // 页面隐藏时：10秒（降低频率）

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
      const { outOfBoundsItemIds, oversizedGroups } = limitIssues.value
      const limitMsgs: string[] = []

      if (outOfBoundsItemIds.length > 0) {
        limitMsgs.push(t('fileOps.limit.outOfBounds', { n: outOfBoundsItemIds.length }))
      }
      if (oversizedGroups.length > 0) {
        limitMsgs.push(t('fileOps.limit.oversized', { n: oversizedGroups.length }))
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
      const confirmed = await notification.confirm({
        title: t('fileOps.save.confirmTitle'),
        description: t('fileOps.save.confirmDesc'),
        details: details,
        confirmText: t('fileOps.save.continue'),
        cancelText: t('common.cancel'),
      })

      if (!confirmed) {
        return null
      }
    }

    // 4. 处理数据
    const outOfBoundsIds = new Set(limitIssues.value.outOfBoundsItemIds)
    const oversizedGroupIds = new Set(limitIssues.value.oversizedGroups)

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
            Roll: item.rotation.x,
            Pitch: item.rotation.y,
            Yaw: item.rotation.z,
          },
        }
      })

    return gameItems
  }

  // 导入 JSON 文件
  async function importJSON(): Promise<void> {
    return new Promise((resolve) => {
      // 触发背景图预加载
      preloadImage(backgroundUrl)

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
            // 预加载图标
            preloadActiveSchemeIcons()
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
    if (!watchState.value.isActive || !watchState.value.fileHandle) {
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

    try {
      const exportData: GameDataFile = {
        NeedRestore: true,
        PlaceInfo: gameItems,
      }

      const jsonString = JSON.stringify(exportData)

      // 2. 请求写入权限（如果需要）
      const handle = watchState.value.fileHandle!
      const permission = await verifyPermission(handle, true)

      if (!permission) {
        notification.error(t('fileOps.saveToGame.noPermission'))
        return
      }

      // 3. 写入文件
      const writable = await handle.createWritable()
      await writable.write(jsonString)
      await writable.close()

      // 4. 更新监控状态，避免触发文件更新通知
      watchState.value.lastModifiedTime = Date.now()
      watchState.value.lastContent = jsonString

      console.log(`[FileOps] Successfully saved to game: ${watchState.value.fileName}`)
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

  // 检查文件更新
  async function checkFileUpdate(): Promise<boolean> {
    if (!watchState.value.isActive || !watchState.value.fileHandle) {
      return false
    }

    try {
      const file = await watchState.value.fileHandle.getFile()
      watchState.value.lastCheckedTime = Date.now()

      // 检查文件是否有更新
      if (file.lastModified > watchState.value.lastModifiedTime) {
        console.log(
          `[FileWatch] File updated: ${file.name}, lastModified: ${new Date(file.lastModified).toLocaleString()}`
        )

        // 更新最后修改时间
        watchState.value.lastModifiedTime = file.lastModified

        // 读取文件内容检查 NeedRestore
        try {
          const content = await file.text()

          // 内容比对：如果内容未变，仅更新时间戳，不进行后续处理
          if (content === watchState.value.lastContent) {
            console.log('[FileWatch] File touched but content identical, skipping notification')
            watchState.value.lastModifiedTime = file.lastModified
            return true
          }

          // 更新已知内容
          watchState.value.lastContent = content

          const jsonData = JSON.parse(content)

          // 只有 NeedRestore 为 true 时才提示导入
          if (jsonData.NeedRestore === true) {
            const confirmed = await notification.fileUpdate(file.name, file.lastModified)
            if (confirmed) {
              await importFromWatchedFile()
            }
          } else {
            // NeedRestore 为 false，静默忽略（不打扰用户）
            console.log(`[FileWatch] File updated but NeedRestore is false, skipping notification`)
          }
        } catch (parseError) {
          console.error('[FileWatch] Failed to parse JSON, will still notify user:', parseError)
          // 解析失败时仍然提示用户，让用户决定是否导入
          const confirmed = await notification.fileUpdate(file.name, file.lastModified)
          if (confirmed) {
            await importFromWatchedFile()
          }
        }

        return true
      }

      return false
    } catch (error) {
      console.error('[FileWatch] Failed to check file update:', error)
      return false
    }
  }

  // 启动文件监控
  function startPolling() {
    if (pollTimer !== null) {
      return // 已经在轮询中
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
  }

  // 启动监控模式
  async function startWatchMode(): Promise<void> {
    if (!isFileSystemAccessSupported) {
      notification.error(t('fileOps.watch.notSupported'))
      return
    }

    try {
      // 触发背景图预加载
      preloadImage(backgroundUrl)

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

      // 4. 设置监控状态
      watchState.value = {
        isActive: true,
        dirHandle: buildDataDir,
        dirPath: buildDataDir.name,
        lastCheckedTime: Date.now(),
        lastModifiedTime: lastModified,
        fileHandle: fileHandle,
        fileName: fileName,
        lastContent: undefined,
      }

      // 5. 启动轮询
      startPolling()

      // 6. 如果有现有文件，检查 NeedRestore 再决定是否提示导入
      if (result) {
        try {
          const content = await result.file.text()
          watchState.value.lastContent = content // 初始化内容缓存

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
    watchState.value = {
      isActive: false,
      dirHandle: null,
      dirPath: '',
      lastCheckedTime: 0,
      lastModifiedTime: 0,
      fileHandle: null,
      fileName: '',
      lastContent: undefined,
    }
    console.log('[FileWatch] Watch mode stopped')
  }

  // 从监控的文件导入
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

      const { file, handle } = result
      const uid = extractUidFromFilename(file.name) || 'unknown'

      console.log(`[FileWatch] Importing from watched file: ${file.name} (UID: ${uid})`)

      // 读取文件内容
      const content = await file.text()

      // 更新最后一次已知内容
      watchState.value.lastContent = content

      // 使用 editorStore 的导入方法
      const importResult = await editorStore.importJSONAsScheme(
        content,
        file.name,
        file.lastModified
      )

      if (importResult.success) {
        console.log(`[FileWatch] Successfully imported from watched file: ${file.name}`)

        // 更新监控状态
        watchState.value.fileHandle = handle
        watchState.value.fileName = file.name
        watchState.value.lastModifiedTime = file.lastModified

        notification.success(t('fileOps.import.success'))
        // 预加载图标
        preloadActiveSchemeIcons()
      } else {
        notification.error(
          t('fileOps.import.failed', { reason: importResult.error || 'Unknown error' })
        )
      }
    } catch (error: any) {
      console.error('[FileWatch] Failed to import from watched file:', error)
      notification.error(t('fileOps.import.failed', { reason: error.message || 'Unknown error' }))
    }
  }

  // Page Visibility API 处理
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && watchState.value.isActive) {
      console.log('[FileWatch] Page visible, checking for updates...')
      checkFileUpdate()
    }
  }

  // 监听页面可见性变化
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  // 组件卸载时清理
  onUnmounted(() => {
    stopPolling()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  return {
    fileInputRef,
    importJSON,
    exportJSON,
    saveToGame,
    isFileSystemAccessSupported,
    // 监控相关
    watchState,
    startWatchMode,
    stopWatchMode,
    importFromWatchedFile,
    checkFileUpdate,
  }
}

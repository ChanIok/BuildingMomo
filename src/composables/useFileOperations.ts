import { ref, onUnmounted } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { GameDataFile, GameItem, FileWatchState } from '../types/editor'
import { useNotification } from './useNotification'
import { useSettingsStore } from '../stores/settingsStore'

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
  const fileInputRef = ref<HTMLInputElement | null>(null)

  // 文件监控状态
  const watchState = ref<FileWatchState>({
    isActive: false,
    dirHandle: null,
    dirPath: '',
    lastCheckedTime: 0,
    lastModifiedTime: 0,
    fileHandle: null,
    fileName: '',
  })

  // 轮询定时器
  let pollTimer: number | null = null

  // 轮询间隔配置
  const POLL_INTERVAL_ACTIVE = 3000 // 页面活跃时：3秒
  const POLL_INTERVAL_HIDDEN = 10000 // 页面隐藏时：10秒（降低频率）

  // 检查重复物品（辅助函数）
  async function checkDuplicateItems(): Promise<boolean> {
    const settingsStore = useSettingsStore()

    // 如果启用了重复物品检测且存在重复物品
    if (settingsStore.settings.enableDuplicateDetection && editorStore.hasDuplicate) {
      const confirmed = await notification.confirm({
        title: '检测到重复物品',
        description: `当前方案中检测到 ${editorStore.duplicateItemCount} 个重复物品。\n\n这些物品的位置、旋转和缩放完全相同，会在游戏中完全重叠，可能不是您期望的摆放效果。\n\n是否继续？`,
        confirmText: '继续',
        cancelText: '取消',
      })

      if (!confirmed) {
        console.log('[FileOps] 用户取消操作（存在重复物品）')
        return false
      }
    }

    return true
  }

  // 导入 JSON 文件
  async function importJSON(): Promise<void> {
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
          const result = await editorStore.importJSONAsScheme(
            content,
            file.name,
            file.lastModified
          )

          if (result.success) {
            console.log(`[FileOps] Successfully imported scheme: ${file.name}`)
            notification.success('导入成功')
          } else {
            notification.error(`导入失败: ${result.error}`)
          }

          resolve()
        }

        reader.onerror = () => {
          notification.error('文件读取失败')
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
    if (editorStore.items.length === 0) {
      notification.warning('没有可导出的数据')
      return
    }

    // 检查重复物品
    const canProceed = await checkDuplicateItems()
    if (!canProceed) {
      return
    }

    // 将 AppItem[] 转换回 GameItem[]
    const gameItems: GameItem[] = editorStore.items.map((item) => ({
      ...item.originalData,
      Location: {
        X: item.x,
        Y: item.y,
        Z: item.z,
      },
    }))

    // 构造导出数据
    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    // 生成 JSON 字符串
    const jsonString = JSON.stringify(exportData, null, 2)

    // 创建 Blob 并下载
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = filename || `edited_${Date.now()}.json`
    link.click()

    // 清理
    URL.revokeObjectURL(url)

    console.log(`[FileOps] Exported ${gameItems.length} items to ${link.download}`)
  }

  // 保存到游戎
  async function saveToGame(): Promise<void> {
    // 检查全局游戎连接状态
    if (!watchState.value.isActive || !watchState.value.fileHandle) {
      notification.warning('请先连接游戏目录')
      return
    }

    if (editorStore.items.length === 0) {
      notification.warning('没有可保存的数据')
      return
    }

    // 检查重复物品
    const canProceed = await checkDuplicateItems()
    if (!canProceed) {
      return
    }

    try {
      // 1. 构造导出数据
      const gameItems: GameItem[] = editorStore.items.map((item) => ({
        ...item.originalData,
        Location: {
          X: item.x,
          Y: item.y,
          Z: item.z,
        },
      }))

      const exportData: GameDataFile = {
        NeedRestore: true,
        PlaceInfo: gameItems,
      }

      const jsonString = JSON.stringify(exportData, null, 2)

      // 2. 请求写入权限（如果需要）
      const handle = watchState.value.fileHandle!
      const permission = await verifyPermission(handle, true)

      if (!permission) {
        notification.error('没有文件写入权限')
        return
      }

      // 3. 写入文件
      const writable = await handle.createWritable()
      await writable.write(jsonString)
      await writable.close()

      // 4. 更新监控状态，避免触发文件更新通知
      watchState.value.lastModifiedTime = Date.now()

      console.log(`[FileOps] Successfully saved to game: ${watchState.value.fileName}`)
      notification.success('保存成功！')
    } catch (error: any) {
      console.error('[FileOps] Failed to save to game:', error)
      notification.error(`保存失败: ${error.message || '未知错误'}`)
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
      notification.error('您的浏览器不支持文件系统访问功能，请使用最新版本的 Chrome 或 Edge 浏览器')
      return
    }

    try {
      // 1. 让用户选择目录
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      })

      console.log('[FileWatch] Selected directory for monitoring:', dirHandle.name)

      // 2. 查找 BuildData 目录
      const buildDataDir = await findBuildDataDirectory(dirHandle)
      if (!buildDataDir) {
        notification.error(
          '未找到 BuildData 目录，请确保选择的是游戏目录的任意位置（InfinityNikki\\X6Game\\Saved\\SavedData\\BuildData）'
        )
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
      }

      // 5. 启动轮询
      startPolling()

      // 6. 如果有现有文件，检查 NeedRestore 再决定是否提示导入
      if (result) {
        try {
          const content = await result.file.text()
          const jsonData = JSON.parse(content)

          // 只有 NeedRestore 为 true 时才提示导入
          if (jsonData.NeedRestore === true) {
            const shouldImport = await notification.confirm({
              title: '找到存档文件',
              description: `文件：${fileName}\n最后修改时间：${new Date(lastModified).toLocaleString()}\n\n是否立即导入？`,
              confirmText: '立即导入',
              cancelText: '稍后',
            })

            if (shouldImport) {
              await importFromWatchedFile()
            }
          } else {
            // NeedRestore 为 false，说明暂无建造数据
            notification.success('监控已启动，等待游戏导出建造数据')
          }
        } catch (error) {
          console.error('[FileWatch] Failed to parse JSON:', error)
          // 解析失败时也提示用户
          notification.warning('监控已启动，找到存档文件但无法解析')
        }
      } else {
        notification.success('监控已启动，等待游戏导出建造数据')
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[FileWatch] User cancelled directory picker')
        return
      }
      console.error('[FileWatch] Failed to start watch mode:', error)
      notification.error(`启动监控失败: ${error.message || '未知错误'}`)
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
    }
    console.log('[FileWatch] Watch mode stopped')
  }

  // 从监控的文件导入
  async function importFromWatchedFile(): Promise<void> {
    if (!watchState.value.isActive || !watchState.value.dirHandle) {
      notification.warning('监控模式未启动')
      return
    }

    try {
      // 重新查找最新文件（可能用户在游戏中保存了新文件）
      const result = await findLatestBuildSaveData(watchState.value.dirHandle)
      if (!result) {
        notification.warning('未找到 BUILD_SAVEDATA_*.json 文件')
        return
      }

      const { file, handle } = result
      const uid = extractUidFromFilename(file.name) || 'unknown'

      console.log(`[FileWatch] Importing from watched file: ${file.name} (UID: ${uid})`)

      // 读取文件内容
      const content = await file.text()

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

        notification.success('导入成功')
      } else {
        notification.error(`导入失败: ${importResult.error}`)
      }
    } catch (error: any) {
      console.error('[FileWatch] Failed to import from watched file:', error)
      notification.error(`导入失败: ${error.message || '未知错误'}`)
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

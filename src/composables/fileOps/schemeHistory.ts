import { ref, toRaw, watch, type WatchStopHandle } from 'vue'
import type { AppItem } from '@/types/editor'
import type { useEditorStore } from '@/stores/editorStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import type { useNotification } from '@/composables/useNotification'
import { SCHEME_HISTORY_DIR_NAME, SCHEME_HISTORY_ROOT_DIR_NAME } from '@/types/schemeHistory'
import type { SchemeHistoryEntry } from '@/types/schemeHistory'
import {
  buildSchemeHistoryFile,
  parseSchemeHistoryFile,
  schemeHistoryFileName,
  selectSchemeHistoryToPrune,
} from '@/lib/schemeHistory'

type TranslateFn = (key: string, params?: Record<string, string | number>) => string

/** 单个方案的最小写入间隔 */
const WRITE_THROTTLE_MS = 30_000
/** 后台检查脏方案的间隔 */
const FLUSH_INTERVAL_MS = 10_000
/** 历史文件条数上限 */
const MAX_HISTORY_FILES = 100
/** 历史文件保留期限 */
const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000

interface CreateSchemeHistoryOpsParams {
  editorStore: ReturnType<typeof useEditorStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  notification: ReturnType<typeof useNotification>
  t: TranslateFn
  getRootDirHandle: () => FileSystemDirectoryHandle | null
}

/**
 * 方案历史：把「被编辑过的方案」按方案为单位写入 BuildingMomo/history 目录。
 *
 * 与 IndexedDB 工作台快照的区别：这份备份在用户自己的磁盘上，且每个方案只有一份文件，
 * 编辑即覆写（受节流限制）。它只作为兜底，不追求实时性。
 *
 * 两条写入保护：
 * - 空方案不写：避免一次空状态把磁盘上唯一一份兜底冲掉。
 * - 云方案不写：云方案的权威数据在服务端。
 */
export function createSchemeHistoryOps(params: CreateSchemeHistoryOpsParams) {
  const { editorStore, settingsStore, notification, t, getRootDirHandle } = params

  const entries = ref<SchemeHistoryEntry[]>([])
  const isLoading = ref(false)
  /** 最近一次访问目录是否成功；用于面板提示「备份已暂停」 */
  const isDirectoryAvailable = ref(false)

  const dirtySchemeIds = new Set<string>()
  /** 需要绕过节流的方案：改名等低频显式操作，写完立即从本集合移除 */
  const urgentSchemeIds = new Set<string>()
  /** schemeId → 上次成功写入的内容，用于跳过无变化的重复写入 */
  const writtenState = new Map<string, { items: AppItem[]; name: string; filePath?: string }>()
  const lastWriteAt = new Map<string, number>()

  let isWriting = false
  let flushTimer: number | null = null
  let itemsWatcher: WatchStopHandle | null = null

  function getPermissionOptions() {
    return { mode: 'readwrite' as const }
  }

  /**
   * 获取历史目录句柄。
   * silent 模式只查询权限，绝不弹窗——后台自动写入不能打断编辑。
   * interactive 模式用于面板等由用户点击触发的路径，可以在权限失效时申请。
   */
  async function getHistoryDirHandle(
    mode: 'silent' | 'interactive' = 'silent'
  ): Promise<FileSystemDirectoryHandle | null> {
    const rootDirHandle = getRootDirHandle()
    if (!rootDirHandle) {
      isDirectoryAvailable.value = false
      return null
    }

    const options = getPermissionOptions()
    let granted = (await (rootDirHandle as any).queryPermission(options)) === 'granted'
    if (!granted && mode === 'interactive') {
      granted = (await (rootDirHandle as any).requestPermission(options)) === 'granted'
    }
    if (!granted) {
      isDirectoryAvailable.value = false
      return null
    }

    try {
      const backupDirHandle = await rootDirHandle.getDirectoryHandle(SCHEME_HISTORY_ROOT_DIR_NAME, {
        create: true,
      })
      const historyDirHandle = await backupDirHandle.getDirectoryHandle(SCHEME_HISTORY_DIR_NAME, {
        create: true,
      })
      isDirectoryAvailable.value = true
      return historyDirHandle
    } catch (error) {
      console.warn('[SchemeHistory] Failed to open history directory:', error)
      isDirectoryAvailable.value = false
      return null
    }
  }

  /**
   * 标记方案为待写。
   * immediate 用于改名等低频显式操作：内容没变，等 30 秒节流没有必要。
   */
  function markDirty(schemeId: string, immediate = false) {
    dirtySchemeIds.add(schemeId)
    if (!immediate) return

    urgentSchemeIds.add(schemeId)
    // 不等后台轮询的 10 秒间隔，立刻落盘；flush 内部仍会跳过未到点的节流方案
    void flush()
  }

  /**
   * 写入成功后同步内存里的面板条目，已展开的面板无需重新读盘。
   * size 只在条目确实存在于列表时才会被计算：算它需要把整份内容再复制一遍，
   * 而绝大多数写入发生时面板是关着的，没必要付这个代价。
   */
  function syncEntry(entry: Omit<SchemeHistoryEntry, 'size'>, getSize: () => number) {
    const index = entries.value.findIndex((item) => item.fileName === entry.fileName)
    // 列表尚未加载过时不追加，等面板打开时统一从磁盘读取
    if (index === -1) return

    const next = [...entries.value]
    next[index] = { ...entry, size: getSize() }
    next.sort((left, right) => right.updatedAt - left.updatedAt)
    entries.value = next
  }

  async function writeScheme(
    schemeId: string,
    historyDirHandle: FileSystemDirectoryHandle,
    now: number
  ): Promise<void> {
    dirtySchemeIds.delete(schemeId)
    urgentSchemeIds.delete(schemeId)

    const scheme = editorStore.getSchemeById(schemeId)
    if (!scheme) return
    // 云方案的权威数据在服务端，不进本地历史
    if (scheme.source.value === 'cloud') return

    const items = toRaw(scheme.items.value) as AppItem[]
    // 空方案不写：一次空状态不能把磁盘上唯一一份兜底冲掉
    if (items.length === 0) return

    const name = scheme.name.value
    const filePath = scheme.filePath.value
    const previous = writtenState.get(schemeId)
    if (
      previous &&
      previous.items === items &&
      previous.name === name &&
      previous.filePath === filePath
    ) {
      return
    }

    const fileName = schemeHistoryFileName(schemeId)
    const content = JSON.stringify(
      buildSchemeHistoryFile(
        {
          schemeId,
          source: scheme.source.value,
          name,
          filePath,
          lastModified: scheme.lastModified.value,
          items,
          currentViewConfig: toRaw(scheme.currentViewConfig.value) ?? undefined,
          viewState: toRaw(scheme.viewState.value) ?? undefined,
          groupOrigins: new Map(toRaw(scheme.groupOrigins.value)),
        },
        now
      )
    )

    try {
      const fileHandle = await historyDirHandle.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()
      writtenState.set(schemeId, { items, name, filePath })
      lastWriteAt.set(schemeId, now)
      syncEntry(
        {
          fileName,
          schemeId,
          name,
          itemCount: items.length,
          updatedAt: now,
        },
        () => new Blob([content]).size
      )
    } catch (error) {
      console.warn(`[SchemeHistory] Failed to write ${fileName}:`, error)
    }
  }

  /** 按条数与期限淘汰旧文件。用 mtime 排序，避免为淘汰去读文件内容。 */
  async function prune(historyDirHandle: FileSystemDirectoryHandle): Promise<void> {
    const candidates: Array<{ fileName: string; updatedAt: number }> = []

    try {
      for await (const dirEntry of (historyDirHandle as any).values()) {
        if (dirEntry.kind !== 'file') continue
        const fileName = String(dirEntry.name || '')
        if (!fileName.toLowerCase().endsWith('.json')) continue
        const file = await (dirEntry as FileSystemFileHandle).getFile()
        candidates.push({ fileName, updatedAt: file.lastModified })
      }

      const toDelete = selectSchemeHistoryToPrune(candidates, Date.now(), {
        maxCount: MAX_HISTORY_FILES,
        maxAgeMs: MAX_HISTORY_AGE_MS,
      })
      if (toDelete.length === 0) return

      for (const fileName of toDelete) {
        await (historyDirHandle as any).removeEntry(fileName)
      }
      console.log(`[SchemeHistory] Pruned ${toDelete.length} old files`)
    } catch (error) {
      console.warn('[SchemeHistory] Failed to prune history:', error)
    }
  }

  /**
   * 写入所有到点的脏方案。
   * force 为 true 时忽略节流，用于切标签、关页面等「最后再落一次」的时机。
   */
  async function flush(force = false): Promise<void> {
    if (isWriting) return
    if (!settingsStore.settings.enableAutoSave) return
    if (dirtySchemeIds.size === 0) return

    const now = Date.now()
    const pending = [...dirtySchemeIds].filter(
      (schemeId) =>
        force ||
        urgentSchemeIds.has(schemeId) ||
        now - (lastWriteAt.get(schemeId) ?? 0) >= WRITE_THROTTLE_MS
    )
    if (pending.length === 0) return

    const historyDirHandle = await getHistoryDirHandle('silent')
    if (!historyDirHandle) return

    isWriting = true
    try {
      for (const schemeId of pending) {
        await writeScheme(schemeId, historyDirHandle, now)
      }
      await prune(historyDirHandle)
    } finally {
      isWriting = false
    }
  }

  /** 列出历史文件，按更新时间倒序。面板打开时调用。 */
  async function loadHistoryList(): Promise<void> {
    isLoading.value = true
    try {
      const historyDirHandle = await getHistoryDirHandle('interactive')
      if (!historyDirHandle) {
        entries.value = []
        return
      }

      const handles: FileSystemFileHandle[] = []
      for await (const dirEntry of (historyDirHandle as any).values()) {
        if (dirEntry.kind !== 'file') continue
        const fileName = String(dirEntry.name || '')
        if (!fileName.toLowerCase().endsWith('.json')) continue
        handles.push(dirEntry as FileSystemFileHandle)
      }

      const parsed = await Promise.all(
        handles.map(async (handle): Promise<SchemeHistoryEntry | null> => {
          try {
            const file = await handle.getFile()
            const historyFile = parseSchemeHistoryFile(JSON.parse(await file.text()))
            if (!historyFile) return null
            return {
              fileName: handle.name,
              schemeId: historyFile.schemeId,
              name: historyFile.name,
              itemCount: historyFile.items.length,
              updatedAt: historyFile.updatedAt,
              size: file.size,
            }
          } catch (error) {
            console.warn(`[SchemeHistory] Failed to read ${handle.name}:`, error)
            return null
          }
        })
      )

      entries.value = parsed
        .filter((entry): entry is SchemeHistoryEntry => entry !== null)
        .sort((left, right) => right.updatedAt - left.updatedAt)
    } catch (error) {
      console.warn('[SchemeHistory] Failed to list history:', error)
      entries.value = []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 用历史文件打开一个新方案（新建标签）。
   * 复用文件里记录的 schemeId，让后续编辑仍然覆写同一个文件，而不是每恢复一次就多一份。
   */
  async function openHistoryFile(fileName: string): Promise<void> {
    const historyDirHandle = await getHistoryDirHandle('interactive')
    if (!historyDirHandle) {
      notification.warning(t('fileOps.schemeHistory.noPermission'))
      return
    }

    try {
      const fileHandle = await historyDirHandle.getFileHandle(fileName)
      const historyFile = parseSchemeHistoryFile(
        JSON.parse(await (await fileHandle.getFile()).text())
      )
      if (!historyFile) {
        notification.error(t('fileOps.schemeHistory.readFailed'))
        return
      }

      editorStore.openArchivedSchemeSnapshot(
        {
          name: historyFile.name,
          filePath: historyFile.filePath,
          lastModified: historyFile.lastModified,
          items: historyFile.items,
          currentViewConfig: historyFile.currentViewConfig,
          viewState: historyFile.viewState,
          groupOrigins: historyFile.groupOrigins,
        },
        { schemeId: historyFile.schemeId, archiveName: historyFile.name }
      )
    } catch (error: any) {
      console.error('[SchemeHistory] Failed to open history file:', error)
      notification.error(
        t('fileOps.schemeHistory.openFailed', { reason: error?.message || 'Unknown error' })
      )
    }
  }

  /** 删除单条历史文件（用户显式操作）。 */
  async function deleteHistoryFile(fileName: string): Promise<void> {
    const historyDirHandle = await getHistoryDirHandle('interactive')
    if (!historyDirHandle) return

    try {
      const removed = entries.value.find((entry) => entry.fileName === fileName)
      await (historyDirHandle as any).removeEntry(fileName)
      if (removed) {
        writtenState.delete(removed.schemeId)
        lastWriteAt.delete(removed.schemeId)
      }
      entries.value = entries.value.filter((entry) => entry.fileName !== fileName)
    } catch (error) {
      console.error('[SchemeHistory] Failed to delete history file:', error)
      notification.error(t('fileOps.schemeHistory.deleteFailed'))
    }
  }

  /** 清空全部历史文件。 */
  async function clearHistory(): Promise<void> {
    const historyDirHandle = await getHistoryDirHandle('interactive')
    if (!historyDirHandle) return

    try {
      for (const entry of entries.value) {
        await (historyDirHandle as any).removeEntry(entry.fileName)
      }
      writtenState.clear()
      lastWriteAt.clear()
      entries.value = []
    } catch (error) {
      console.error('[SchemeHistory] Failed to clear history:', error)
      notification.error(t('fileOps.schemeHistory.deleteFailed'))
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') void flush(true)
  }

  function handlePageHide() {
    void flush(true)
  }

  /** 启动后台落盘；重复调用无效。 */
  function start() {
    if (flushTimer !== null) return

    // 按 id 比对，避免插入/删除方案时下标错位把无关方案标脏
    itemsWatcher = watch(
      () =>
        editorStore.schemes.map((scheme) => ({
          id: scheme.id,
          items: scheme.items.value,
          name: scheme.name.value,
          filePath: scheme.filePath.value,
        })),
      (current, previous) => {
        const previousById = new Map((previous ?? []).map((entry) => [entry.id, entry]))

        for (const entry of current) {
          const before = previousById.get(entry.id)
          // 本会话新出现的方案（含从 IndexedDB 恢复的）不标脏，等它真的被编辑
          if (!before) continue

          if (before.items !== entry.items) {
            markDirty(entry.id)
          } else if (before.name !== entry.name || before.filePath !== entry.filePath) {
            markDirty(entry.id, true)
          }
        }
      }
    )

    flushTimer = window.setInterval(() => void flush(false), FLUSH_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
  }

  function stop() {
    if (flushTimer !== null) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    if (itemsWatcher) {
      itemsWatcher()
      itemsWatcher = null
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('pagehide', handlePageHide)
  }

  return {
    entries,
    isLoading,
    isDirectoryAvailable,
    start,
    stop,
    markDirty,
    flushNow: flush,
    loadHistoryList,
    openHistoryFile,
    deleteHistoryFile,
    clearHistory,
  }
}

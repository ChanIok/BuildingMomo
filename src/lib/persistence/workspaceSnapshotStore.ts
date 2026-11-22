/**
 * 工作台快照 IndexedDB 持久化。
 *
 * 设计目标：降低硬断电 / 库级损坏导致「整桌快照全丢」的风险。
 *
 * - 主库（building-momo-workspace）：单 key `latest`。
 * - 冷备份库（building-momo-workspace-fallback）：单 key `latest`，主库成功后异步镜像；
 *   与主库分属不同 IDB 文件，主库整库被 Chromium 删除时备份库通常仍可读取。
 *   fallback 仅作兜底，写入节流为最多每 30 秒一次；镜像时使用 durability: 'strict'。
 * - 主库使用浏览器默认 durability，避免频繁 autosave 的性能开销。
 *
 * 读写可在主线程（restore）与 Worker（autosave）中调用；IDB 按 origin + 库名隔离。
 */
import type { WorkspaceSnapshot } from '@/types/persistence'

/** 主库 */
const PRIMARY_DB = 'building-momo-workspace'
/** 冷备份库：与监控历史等其它 IDB 库隔离 */
const FALLBACK_DB = 'building-momo-workspace-fallback'
const STORE_NAME = 'snapshots'
const KEY_LATEST = 'latest'

/** fallback 镜像最小间隔（毫秒）；主库仍每次 autosave 都写 */
const FALLBACK_MIN_INTERVAL_MS = 30_000

/** 旧版 idb-keyval 默认库，仅用于读取迁移；新写入不再使用 */
const LEGACY_DB = 'keyval-store'
const LEGACY_STORE = 'keyval'
const LEGACY_KEY = 'workspace_snapshot'

export type WorkspaceSnapshotSource = 'primary' | 'fallback' | 'legacy'

export interface LoadedWorkspaceSnapshot {
  snapshot: WorkspaceSnapshot
  source: WorkspaceSnapshotSource
}

let primaryDbPromise: Promise<IDBDatabase> | null = null
let fallbackDbPromise: Promise<IDBDatabase> | null = null
/** 上次成功写入 fallback 库的时间；0 表示本会话尚未写过 */
let lastFallbackSavedAt = 0

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to open IndexedDB: ${dbName}`))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function getPrimaryDb(): Promise<IDBDatabase> {
  if (!primaryDbPromise) {
    primaryDbPromise = openDatabase(PRIMARY_DB)
  }
  return primaryDbPromise
}

function getFallbackDb(): Promise<IDBDatabase> {
  if (!fallbackDbPromise) {
    fallbackDbPromise = openDatabase(FALLBACK_DB)
  }
  return fallbackDbPromise
}

function getValue<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error ?? new Error(`Failed to read ${key}`))
  })
}

function putValue(
  db: IDBDatabase,
  storeName: string,
  key: string,
  value: unknown,
  durability?: IDBTransactionDurability
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = durability
      ? db.transaction(storeName, 'readwrite', { durability })
      : db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to write ${key}`))
    tx.onabort = () => reject(tx.error ?? new Error(`Failed to write ${key}`))
  })
}

async function loadFromPrimary(): Promise<WorkspaceSnapshot | undefined> {
  try {
    const db = await getPrimaryDb()
    return await getValue<WorkspaceSnapshot>(db, STORE_NAME, KEY_LATEST)
  } catch (error) {
    console.warn('[WorkspaceSnapshot] Primary load failed:', error)
    return undefined
  }
}

async function loadFromFallback(): Promise<WorkspaceSnapshot | undefined> {
  try {
    const db = await getFallbackDb()
    return await getValue<WorkspaceSnapshot>(db, STORE_NAME, KEY_LATEST)
  } catch (error) {
    console.warn('[WorkspaceSnapshot] Fallback load failed:', error)
    return undefined
  }
}

/** 兼容旧版 keyval-store 中的 workspace_snapshot 单 key */
async function loadLegacy(): Promise<WorkspaceSnapshot | undefined> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LEGACY_DB)
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to open legacy IndexedDB: ${LEGACY_DB}`))
      request.onsuccess = () => resolve(request.result)
    })

    if (!db.objectStoreNames.contains(LEGACY_STORE)) {
      return undefined
    }

    return await getValue<WorkspaceSnapshot>(db, LEGACY_STORE, LEGACY_KEY)
  } catch {
    return undefined
  }
}

async function mirrorToFallback(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await getFallbackDb()
  await putValue(db, STORE_NAME, KEY_LATEST, snapshot, 'strict')
}

async function maybeMirrorToFallback(snapshot: WorkspaceSnapshot): Promise<void> {
  const now = Date.now()
  if (lastFallbackSavedAt > 0 && now - lastFallbackSavedAt < FALLBACK_MIN_INTERVAL_MS) {
    return
  }

  await mirrorToFallback(snapshot)
  lastFallbackSavedAt = now
}

/**
 * 保存工作台快照。
 *
 * 写入顺序：主库 latest 每次写入（默认 durability）→ 异步镜像 fallback（strict，最多每 30 秒一次）。
 */
export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await getPrimaryDb()
  await putValue(db, STORE_NAME, KEY_LATEST, snapshot)

  // 不阻塞 autosave 主路径；fallback 失败不影响本次主库写入结果
  void maybeMirrorToFallback(snapshot).catch((error) => {
    console.warn('[WorkspaceSnapshot] Fallback mirror failed:', error)
  })
}

/**
 * 加载工作台快照。
 *
 * 并行读取主库、fallback 库与 legacy 单 key，取 updatedAt 最新且可读的一份。
 * 若最终来源不是主库，输出 warn 便于排查断电 / 库损坏后的恢复路径。
 */
export async function loadWorkspaceSnapshot(): Promise<LoadedWorkspaceSnapshot | undefined> {
  const [primary, fallback, legacy] = await Promise.all([
    loadFromPrimary(),
    loadFromFallback(),
    loadLegacy(),
  ])

  const candidates: Array<{ snapshot: WorkspaceSnapshot; source: WorkspaceSnapshotSource }> = []
  if (primary) candidates.push({ snapshot: primary, source: 'primary' })
  if (fallback) candidates.push({ snapshot: fallback, source: 'fallback' })
  if (legacy) candidates.push({ snapshot: legacy, source: 'legacy' })

  if (candidates.length === 0) return undefined

  const best = candidates.reduce((currentBest, candidate) =>
    candidate.snapshot.updatedAt > currentBest.snapshot.updatedAt ? candidate : currentBest
  )

  if (best.source !== 'primary') {
    console.warn(
      `[WorkspaceSnapshot] Restored from ${best.source}, last updated:`,
      new Date(best.snapshot.updatedAt).toLocaleString()
    )
  }

  return best
}

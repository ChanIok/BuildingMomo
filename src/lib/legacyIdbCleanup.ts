/**
 * 一次性清理：方案历史改为写入 BuildingMomo/history 目录后，
 * 旧的「监控导入历史」IndexedDB（building-momo-db，只装过 watch-history）不再使用，直接删库。
 */
const LEGACY_WATCH_HISTORY_DB = 'building-momo-db'

export async function removeLegacyWatchHistoryDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_WATCH_HISTORY_DB)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    // 其它标签页仍开着旧库时会被阻塞，放弃本次清理即可，不影响主流程
    request.onblocked = () => resolve()
  })
}

// 已废弃的监控导入历史库，以及未发版的 AI 开发期数据库；直接清理，不迁移。
const LEGACY_DATABASES = [
  'building-momo-db',
  'buildingmomo-ai-sessions',
  'buildingmomo-ai-v1',
  'buildingmomo-ai-workbench-v2',
  'buildingmomo-ai-workbench-v3',
]

export async function removeLegacyDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  await Promise.all(
    LEGACY_DATABASES.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name)
          request.onsuccess = () => resolve()
          request.onerror = () => resolve()
          // 其它标签页仍开着旧库时会被阻塞，不等待清理，不影响主流程。
          request.onblocked = () => resolve()
        })
    )
  )
}

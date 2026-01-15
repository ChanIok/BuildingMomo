import { createStore, get, set, del, keys } from 'idb-keyval'

// 创建独立的 IndexedDB store（独立于 workspace）
const watchHistoryStore = createStore('building-momo-db', 'watch-history')

// 历史快照接口
export interface WatchHistorySnapshot {
  id: string // 唯一标识：`${fileName}_${lastModified}`
  fileName: string // 文件名
  content: string // 完整的 JSON 内容 (500KB-1MB)
  itemCount: number // 物品数量
  lastModified: number // 文件修改时间
  detectedAt: number // 检测到的时间
  size: number // 内容大小（字节）
}

// API 封装
export const WatchHistoryDB = {
  // 保存历史快照
  async save(snapshot: WatchHistorySnapshot): Promise<void> {
    await set(snapshot.id, snapshot, watchHistoryStore)
  },

  // 获取历史快照
  async get(id: string): Promise<WatchHistorySnapshot | undefined> {
    return await get<WatchHistorySnapshot>(id, watchHistoryStore)
  },

  // 删除历史快照
  async delete(id: string): Promise<void> {
    await del(id, watchHistoryStore)
  },

  // 获取所有 key
  async getAllKeys(): Promise<IDBValidKey[]> {
    return await keys(watchHistoryStore)
  },

  // 清空旧历史（保留最新 N 条）
  async clearOld(keepLatestN: number = 30): Promise<void> {
    const allKeys = await keys(watchHistoryStore)

    if (allKeys.length <= keepLatestN) return

    // 获取所有快照的元数据（只读 id 和 detectedAt）
    const snapshots = await Promise.all(
      allKeys.map(async (key) => {
        const snapshot = await get<WatchHistorySnapshot>(key, watchHistoryStore)
        return { key, detectedAt: snapshot?.detectedAt || 0 }
      })
    )

    // 按时间排序，删除旧的
    const toDelete = snapshots.sort((a, b) => b.detectedAt - a.detectedAt).slice(keepLatestN)

    await Promise.all(toDelete.map(({ key }) => del(key, watchHistoryStore)))

    console.log(`[WatchHistoryDB] Cleaned ${toDelete.length} old records`)
  },

  // 获取所有历史记录的元数据（不包含完整内容）
  async getAllMetadata(): Promise<
    Array<{
      id: string
      name: string
      lastModified: number
      itemCount: number
      detectedAt: number
      size: number
    }>
  > {
    const allKeys = await keys(watchHistoryStore)

    // 获取所有快照的元数据
    const snapshots = await Promise.all(
      allKeys.map(async (key) => {
        const snapshot = await get<WatchHistorySnapshot>(key, watchHistoryStore)
        if (!snapshot) return null

        return {
          id: snapshot.id,
          name: snapshot.fileName,
          lastModified: snapshot.lastModified,
          itemCount: snapshot.itemCount,
          detectedAt: snapshot.detectedAt,
          size: snapshot.size,
        }
      })
    )

    // 过滤掉 null 值，按时间倒序排序
    return snapshots
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.detectedAt - a.detectedAt)
  },
}

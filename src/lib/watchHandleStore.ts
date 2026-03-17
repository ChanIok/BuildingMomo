import { createStore, del, get, set } from 'idb-keyval'

// 使用独立 DB，避免在已存在的 DB 上追加 object store 导致事务报错
const watchHandleStore = createStore('building-momo-watch-handle-db', 'watch-handles')
const WATCH_ROOT_HANDLE_KEY = 'watch.root.handle'

export const WatchHandleStore = {
  async saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    await set(WATCH_ROOT_HANDLE_KEY, handle, watchHandleStore)
  },

  async getRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
    return await get<FileSystemDirectoryHandle>(WATCH_ROOT_HANDLE_KEY, watchHandleStore)
  },

  async clearRootHandle(): Promise<void> {
    await del(WATCH_ROOT_HANDLE_KEY, watchHandleStore)
  },
}

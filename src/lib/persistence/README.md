# Persistence (`src/lib/persistence`)

浏览器本地持久化（IndexedDB / 文件句柄）底层封装。

- `workspaceSnapshotStore.ts`：工作区快照的 IndexedDB 读写（主线程与 Workspace Worker 共用）。
- `watchHandleStore.ts`：File System Access 目录句柄持久化。
- `legacyIdbCleanup.ts`：旧开发库启动清理。

边界：只负责浏览器存储原语，不包含业务调度逻辑；编排逻辑位于 `src/composables/workspace/` 与 `src/composables/fileOps/`。

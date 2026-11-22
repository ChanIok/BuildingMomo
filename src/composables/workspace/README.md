# Workspace Sync & Persistence (`src/composables/workspace`)

工作区后台持久化与云端协同编排。

- `useWorkspaceWorker.ts`：连接 `src/workers/workspace.worker.ts`，驱动自动快照保存、工作台恢复与异步校验。
- `useCloudSchemeSync.ts`：云端方案 WebSocket 同步、事务上行/下行重放与协作者在线状态。

边界：底层 IndexedDB 读写在 `src/lib/persistence/`，差异与事务结构定义在 `src/lib/scheme/editorTransactions.ts`。

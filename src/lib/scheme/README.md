# Scheme (`src/lib/scheme`)

方案领域模型、存档格式、分组/分类树、历史事务与剪贴板结构。

- `gameDataFormat.ts`：游戏存档 JSON 兼容解析与序列化（保留未知 `extra` 字段）。
- `collectionTree.ts` / `collectionTargets.ts` / `selectionReference.ts`：分类树结构、目标展开与选区/原点引用协调。
- `groupState.ts` / `groupMetadataInheritance.ts`：方案级组状态协调与元数据继承。
- `editorTransactions.ts`：基于引用比较的不可变差异提取与前后端事务重放。
- `clipboardStructure.ts`：剪贴板分类子树快照与恢复。
- `colorMap.ts` / `furnitureColorValidation.ts`：染色映射克隆、重映射与合法性校验。
- `schemeSnapshot.ts` / `schemeHistory.ts` / `cloudPresence.ts`：共享快照、磁盘历史摘要与云协同在线元数据。

边界：禁止依赖 `stores/` 和 `composables/`。注意 `collectionTree.ts`、`collectionTargets.ts`、`selectionReference.ts` 被 `functions/` 与 `cloud-sync-worker/` 直接加载，三者之间的互导必须保留同目录 `.ts` 相对路径。

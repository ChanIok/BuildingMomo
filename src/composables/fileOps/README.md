# File Operations (`src/composables/fileOps`)

方案文件的导入导出、代码导入、目录监听（Watch Mode）、游戏目录导入、存档打包与磁盘历史。

- 统一入口：`useFileOperations.ts`（UI 层统一从此进入，不直接拼装底层文件流程）
- 子流程：`archive.ts`、`codeImport.ts`、`gameImport.ts`、`schemeHistory.ts`、`watchMode.ts`、`watchMode.fs.ts`、`download.ts`

边界：游戏 JSON 兼容解析与序列化集中在 `src/lib/scheme/gameDataFormat.ts`，缩放与染色合法性校验复用 `src/lib/transform/scaleLimits.ts` 与 `src/lib/scheme/furnitureColorValidation.ts`。

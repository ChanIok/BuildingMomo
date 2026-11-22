# Panel ViewModels (`src/composables/panels`)

服务于特定编辑器 UI 面板的派生视图模型与布局交互逻辑，与核心编辑事务解耦。

- 画布浮层与变换栏：`useCanvasPanels.ts`、`useTransformSelection.ts`
- 组与分类面板：`useCollectionPanel.ts`、`useGroupPanel.ts`、`useGroupPanelSelection.ts`、`useGroupPanelResize.ts`、`useGroupVirtualList.ts`

边界：可以组合调用 `src/composables/editor/` 执行正式写入，但核心编辑命令不得反向依赖本目录。

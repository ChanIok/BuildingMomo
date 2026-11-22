# Editor Commands (`src/composables/editor`)

纯粹的编辑器业务操作层：所有修改和查询方案的事务入口，供 UI、快捷键、Gizmo 与 AI 宿主复用。

- 历史与选择：`useEditorHistory.ts`、`useEditorSelection.ts`、`useSelectionFilter.ts`
- 变换与对齐：`useEditorManipulation.ts`、`useEditorAlignment.ts`
- 增删改与剪贴板：`useEditorItemAdd.ts`、`useEditorRemoval.ts`、`useEditorSceneEdit.ts`、`useClipboard.ts`
- 编组、分类与元数据：`useEditorGroups.ts`、`useEditorCollectionOrigins.ts`、`useEditorOrganization.ts`、`useGroupMetadataImport.ts`

边界：只放方案业务命令与事务编排，不放具体 UI 面板的虚拟列表、折叠、拖拽调宽或浮层互斥状态（见 `src/composables/panels/`）。

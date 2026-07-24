# AGENTS.md

本文件用于约束在本仓库中工作的 AI Agent。代码是功能现状的事实来源；本文件只记录开发时必须遵守、且无法从局部代码轻易判断的规则。

## 第一性原理

请使用第一性原理思考。不能默认用户非常清楚自己想要什么以及如何实现。应从真实目标和问题出发；如果动机、目标或关键语义不明确，先与用户讨论。

## 方案规范

- 修改或重构必须解决根本问题，不提供兼容层、双轨逻辑或补丁式方案。
- 在完整满足需求和架构约束的前提下选择最短实现路径，避免过度设计。
- 先搜索并理解现有调用链，再决定修改位置；不要仅根据文件名猜测职责。
- 保留工作区中与当前任务无关的修改，不擅自重置、覆盖或暂存用户的改动。

## 项目概览

BuildingMomo 是一个 Vue 3、TypeScript、Pinia、Three.js/TresJS 构建的无限暖暖家园方案编辑器。核心数据是一组可导入、编辑、验证和导出的家具实例；3D 视口为大场景使用实例化渲染。

## 常用命令

- `npx vue-tsc -b`：TypeScript 类型检查。
- `npm run build`：生产构建并生成英文入口。
- `npm run fetch-data`：更新 `public/assets` 下的游戏数据和图标。

注意：

- 当前没有测试运行器或 `npm test` 脚本。
- 格式化由 Husky 的 pre-commit `lint-staged` 统一执行。不要主动运行 Prettier 或制造与任务无关的格式化 diff。
- TypeScript 使用 strict 模式，`@/` 指向 `src/`。

## 不可破坏的核心约束

### 不可变更新与历史事务

- 场景数据修改必须生成新的顶层 `AppItem` 引用，禁止原地修改已存在的 item。
- 修改 `extra`、`Scale`、`ColorMap` 等嵌套数据时，也必须为被修改的层级生成新引用。
- 未变化的 item 应保留原引用，使 `src/lib/editorTransactions.ts` 能通过引用比较快速识别差异。
- 正式编辑操作应通过 `useEditorHistory().recordTransaction()` 记录；预览过程不得污染正式历史。
- 场景或选择变化后，使用 `editorStore` 现有的 scene/selection update 入口通知渲染器、Worker 和验证流程。

### 坐标空间

项目同时使用数据空间、Three.js 世界空间和 UI 视觉空间。不要在业务组件中自行复制转换公式。

- 数据位置 → 世界位置：`{ x, y: -y, z }`。
- 世界位置 → 数据位置：同样对 Y 取反。
- 位置转换使用 `matrixTransform.dataPositionToWorld()` 和 `worldPositionToData()`。
- 数据旋转与视觉旋转使用 `matrixTransform.dataRotationToVisual()` 和 `visualRotationToData()`。
- 工作坐标系角度属于视觉空间；优先使用 `uiStore` 的 `dataToWorking()`、`workingToData()`、`workingDeltaToData()` 和 `getEffectiveCoordinateRotation()`。
- 构建工作坐标系四元数时统一使用 `ZYX` 欧拉顺序，并对视觉 Z 角取反。
- 如需修改坐标语义，必须同时检查 `matrixTransform.ts`、`coordinateTransform.ts`、`rotationTransform.ts`、Gizmo、侧栏输入和渲染矩阵。

### 缩放轴语义

所有 UI、编辑器 API 和高级粘贴均使用用户看到的视觉 `x/y/z`：

- 视觉 X → 存档 `Scale.Y`
- 视觉 Y → 存档 `Scale.X`
- 视觉 Z → 存档 `Scale.Z`

轴映射只能集中在 `src/lib/selectionScaleTransform.ts`。调用方不得提前交换 X/Y，也不得另写一套缩放计算。

缩放范围由调用方提供：开启限制检测时使用所有选中家具合法范围的交集；关闭时仅 Gizmo 使用绝对 Scale `0.01` 下限，Input 不继承该交互限制。不要把调用方策略写入共享数学。

### 选择变换架构

- `src/lib/selectionTransform.ts`
  - 创建共享的 Pivot/工作坐标系 Frame。
  - 提供不可变的批量平移。
  - 提供组合相对变换；固定顺序为 `Scale → Rotate → Translate`。
- `src/lib/selectionScaleTransform.ts`
  - 负责视觉轴映射、共同倍率约束、围绕 Pivot 的整体缩放和绝对 Scale 设置。
- `src/lib/rotationTransform.ts`
  - 负责工作坐标系中的相对旋转数学。
- `src/composables/editor/useEditorManipulation.ts`
  - 负责解析选择、Pivot、限制策略、历史事务和场景更新。
  - 对 UI 暴露含义明确的操作；不要恢复 `{ mode, position?, rotation?, scale? }` 形式的通用变换入口。
- Gizmo、Input 和高级粘贴必须复用以上纯函数，不得维护各自的近似算法。
- 绝对设置与相对组合变换是不同语义，应使用独立入口，不要塞进同一个参数对象。

相对旋转和相对缩放的选择 Pivot 优先级：

1. 自定义 Pivot。
2. 完整选中组合时的组合原点。
3. 选择几何中心。

绝对位置输入不使用自定义 Pivot：完整组合使用组合原点，其他选择使用几何中心。

### 渲染与交互

- 3D 主入口是 `src/components/ThreeEditor.vue`，复杂行为应放入对应 composable，不继续堆积到组件本体。
- 实例化渲染统一由 `src/composables/renderer/` 管理。新增显示模式必须同时考虑矩阵、选择、拾取、高亮和轮廓。
- 画布拾取和区域候选应复用 renderer 的 interaction adapter，避免为某个显示模式另建选择路径。
- Gizmo 拖拽期间优先更新实例矩阵做预览，结束时再以不可变数据和单笔事务提交。
- 与尺寸、旋转或模型边界有关的计算优先使用 `src/lib/collision.ts` 的 OBB 工具；不要用简单 AABB 冒充精确模型边界。

### Worker、持久化与文件操作

- `editorStore` 是当前编辑会话的状态中心；自动保存和验证通过 `useWorkspaceWorker` 与 `src/workers/workspace.worker.ts` 协作。
- 修改存档结构、限制规则或恢复语义时，同时检查主线程快照、Worker 类型、恢复逻辑和验证逻辑。
- 文件导入导出从 `src/composables/useFileOperations.ts` 进入，具体实现位于 `src/composables/fileOps/`；不要在 UI 组件中复制文件处理流程。
- 家具范围、旋转限制和模型信息由 `gameDataStore` 提供，不要在编辑逻辑中硬编码家具规则。

## 架构导航

- 应用入口与布局：`src/main.ts`、`src/App.vue`
- 3D 视口：`src/components/ThreeEditor.vue`
- 场景与选择状态：`src/stores/editorStore.ts`
- UI 与工作坐标系：`src/stores/uiStore.ts`
- 设置与输入绑定：`src/stores/settingsStore.ts`
- 命令和快捷键：`src/stores/commandStore.ts`
- 家具与模型数据：`src/stores/gameDataStore.ts`
- 编辑操作：`src/composables/editor/`
- Gizmo：`src/composables/useThreeTransformGizmo.ts`、`src/composables/transformGizmo/`
- 变换面板：`src/components/SidebarTransform.vue`、`src/composables/transform/`
- 共享数学与事务：`src/lib/`
- 实例化渲染：`src/composables/renderer/`
- 文件操作：`src/composables/useFileOperations.ts`、`src/composables/fileOps/`
- 持久化与验证：`src/composables/useWorkspaceWorker.ts`、`src/workers/workspace.worker.ts`
- 核心类型：`src/types/`
- 中文与英文文案：`src/locales/zh.ts`、`src/locales/en.ts`

## 修改后的最低验证

- 仅文档修改：检查 `git diff --check`。
- TypeScript/Vue 修改：运行 `npx vue-tsc -b`。
- 构建配置、资源路径、PWA、部署或产物相关修改：再运行对应的完整 build。
- 仓库没有自动化测试时，应按变更风险检查关键交互、撤销/重做、坐标转换和多选行为，并在交付时说明验证范围。

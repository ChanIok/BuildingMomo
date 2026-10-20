# AGENTS.md

本文件用于约束在本仓库中工作的 AI Agent。代码是功能现状的事实来源；本文件只记录开发时必须遵守、且无法从局部代码轻易判断的规则。

## 第一性原理

请使用第一性原理思考。不能默认用户非常清楚自己想要什么以及如何实现。应从真实目标和问题出发；如果动机、目标或关键语义不明确，先与用户讨论。

## 方案规范

- 修改或重构必须解决根本问题，不新增掩盖架构问题的兼容层或双轨实现。
- 在完整满足需求和架构约束的前提下选择最短实现路径，避免过度设计。
- 先搜索并理解现有调用链，再决定修改位置；不要仅根据文件名猜测职责。
- 保留工作区中与当前任务无关的修改，不擅自重置、覆盖或暂存用户的改动。

## 项目概览

BuildingMomo 是基于 Vue 3、TypeScript、Pinia、Three.js/TresJS 的无限暖暖家园方案编辑器，另有云协同后端和 Windows 桌面外壳。

## 常用命令

- `pnpm dev`：启动前端开发服务器。
- `pnpm exec vue-tsc -b`：TypeScript 类型检查。
- `pnpm run build` / `pnpm run build:secure`：普通 / secure 前端构建，均生成英文入口。
- `pnpm run fetch-data`：更新 `public/assets` 下的游戏数据和图标。
- `pnpm test`：运行 Vitest 测试。
- 云端开发与桌面构建命令见 `package.json`。

注意：

- 使用 Node.js 24 和 pnpm；安装须应用 `pnpm-workspace.yaml` 中的 TresJS patch，不直接修改 `node_modules`。
- 测试位于 `tests/`，使用独立 Vitest 配置，不加载 PWA 插件。
- 格式化由 Husky 的 pre-commit `lint-staged` 统一执行。不要主动运行 Prettier 或制造与任务无关的格式化 diff。

## 不可破坏的核心约束

### 场景、选择与历史事务

- 修改家具必须生成新的顶层 `AppItem` 引用；修改 `extra`、`Scale`、`ColorMap`、`TempInfo.points` 等嵌套数据时，被修改的层级也必须生成新引用。
- 未变化的 item 保留原引用；修改 `groupOrigins` 必须生成新 Map。`editorTransactions.ts` 依靠引用比较识别差异。
- 正式编辑通过 `useEditorHistory().recordTransaction()` 记录；纯选择变化使用选择历史入口，预览不得污染正式数据或历史。
- 事务同时服务撤销、增量渲染和云同步；场景或选择变化后，使用 `editorStore` 现有更新入口，不绕过通知链路。
- 云方案撤销/重做也通过事务同步；远端更新不得重新记作本地编辑或再次上行。修改事务结构或重放语义时联查前后端。
- 撤销/重做不得回退 InstanceID 和 GroupID 分配器。
- 局部编辑只限制临时工作集，不改变完整方案数据。选择、组扩展与渲染交互应遵守同一范围，避免修改范围外家具；撤销/重做仍保持全局历史顺序。

### 坐标空间

项目同时使用数据空间、Three.js 世界空间和 UI 视觉空间。不要在业务组件中自行复制转换公式。

- 数据位置与世界位置互转均对 Y 取反，使用 `matrixTransform.dataPositionToWorld()` 和 `worldPositionToData()`。
- 数据旋转与视觉旋转使用 `matrixTransform.dataRotationToVisual()` 和 `visualRotationToData()`。
- 工作坐标系角度属于视觉空间；优先使用 `uiStore` 的 `dataToWorking()`、`workingToData()`、`workingDeltaToData()` 和 `getEffectiveCoordinateRotation()`。
- 构建工作坐标系四元数时统一使用 `ZYX` 欧拉顺序，并对视觉 Z 角取反。
- 如需修改坐标语义，必须同时检查 `matrixTransform.ts`、`coordinateTransform.ts`、`rotationTransform.ts`、Gizmo、侧栏输入和渲染矩阵。

### 缩放轴语义

UI、编辑操作 API 和高级粘贴统一使用视觉 `x/y/z`：

- 视觉 X → 存档 `Scale.Y`
- 视觉 Y → 存档 `Scale.X`
- 视觉 Z → 存档 `Scale.Z`

编辑写入的轴映射集中在 `selectionScaleTransform.ts`，调用方不得提前交换 X/Y 或另写缩放算法。显示读取与渲染矩阵遵循相同对应关系，不重复转换。这不适用于位置坐标。

缩放范围由调用方提供；相对缩放对所有选中家具取共同合法倍率。关闭限制检测时，仅 Gizmo 使用绝对 Scale `0.01` 下限，Input 不继承该交互限制。不要把调用方策略写入共享数学。

### 选择变换架构

- Gizmo、Input 和高级粘贴复用 `selectionTransform.ts`、`selectionScaleTransform.ts`、`rotationTransform.ts`，不另写近似算法。组合相对变换固定为 `Scale → Rotate → Translate`。
- `useEditorManipulation.ts` 负责选择、Pivot、限制策略、历史事务和场景更新。绝对设置与相对变换使用独立入口，不恢复 `{ mode, position?, rotation?, scale? }` 式通用入口。
- 相对旋转和相对缩放的 Pivot：自定义 Pivot → 完整选中组合时的组合原点 → 选中家具轴点包围盒中心。
- 绝对位置不使用自定义 Pivot：完整组合使用组合原点，否则使用轴点包围盒中心。该中心是位置点范围的 `(min + max) / 2`，不是模型中心或位置平均值。

### 渲染与交互

- `ThreeEditor.vue` 组装视口，复杂行为放入 composable；实例化渲染由 `renderer/` 管理。拾取和区域候选复用 interaction adapter；显示模式变更须兼顾矩阵、选择、拾取、高亮和轮廓。
- `useFurnitureRender.ts` 管理 `@nuan5-pro/render` 共享上下文，业务消费者不得自行释放库拥有的资源。普通编辑复用增量更新，不销毁重建整场景。
- 切换方案、工作集、资源档位或销毁上下文后，过期异步任务不得发布结果；任务只能结束自己拥有的加载会话。
- 直接修改 Three.js 对象后调用 `invalidateScene()`；影响阴影时才请求阴影更新。
- Gizmo 拖拽用实例矩阵或专用 renderer 预览，结束时以不可变数据和单笔事务提交，提交结果与最终预览一致。
- 显示补偿复用 `scaleRenderCompensation.ts`，不得写回原始存档坐标；飞花道点位转换与不可变更新复用 `slidePath.ts`。
- 几何边界计算优先复用 `collision.ts` 的 OBB 工具；相机构图复用 `spatialBounds.ts` 的 AABB 与降级策略，不与变换 Pivot 混用。

### Worker、持久化与文件操作

- `editorStore` 是编辑会话状态中心，自动保存和验证由 Workspace Worker 协作；数据结构、限制或恢复变更须联查快照、Worker 类型、恢复与验证逻辑。
- 文件操作从 `useFileOperations.ts` 进入，不在 UI 中复制流程。游戏格式兼容解析与序列化集中在 `gameDataFormat.ts`，保留未知 extra 字段，染色按既定规则规范化。
- 家具规则由 `gameDataStore` 提供；编辑、Worker 验证和导出统一复用 `scaleLimits.ts` 的 float32 缩放合法性判断，不自行加 epsilon 或四舍五入。导出前验证实际数据，不依赖防抖中的旧结果。
- 工作台恢复、磁盘备份和撤销历史不互相替代，持久化复用现有入口。磁盘方案历史不写空方案或云方案；后台备份只查询权限，不弹权限申请。

## 架构导航

- 应用与状态：`src/App.vue`、`src/stores/`
- 编辑与变换：`src/composables/editor/`、`src/composables/transformGizmo/`、`src/lib/`
- 视口与渲染：`src/components/ThreeEditor.vue`、`src/composables/renderer/`；共享家具入口为 `src/composables/useFurnitureRender.ts`
- 文件与持久化：`src/composables/fileOps/`、`src/lib/workspaceSnapshotStore.ts`、`src/workers/workspace.worker.ts`
- 云协同：`src/composables/useCloudSchemeSync.ts`、`functions/api/cloud-schemes/`、`cloud-sync-worker/src/index.js`
- 桌面桥接：`src/stores/desktopStore.ts`、`src/types/desktop.ts`、`desktop/src/desktop_bridge.cpp`；协议变更须检查两端
- 类型与文案：`src/types/`、`src/locales/zh.ts`、`src/locales/en.ts`

## 修改后的最低验证

- 仅文档修改：检查 `git diff --check`。
- TypeScript/Vue 修改：运行 `pnpm exec vue-tsc -b`。
- 修改事务、格式、坐标/缩放、吸附/Gizmo、局部编辑、渲染生命周期或 Worker 验证等核心契约时，运行 `pnpm test` 或覆盖受影响契约的相关测试；失败先判断契约还是实现问题，不直接改断言。
- 构建、资源、PWA、部署或产物变更：再运行对应完整 build。后端或 C++ 变更检查对应运行路径或构建，前端检查不能替代。
- 未被自动测试覆盖的部分，按风险检查关键交互、撤销/重做、坐标转换和多选；渲染/UI 变更检查实际显示，交付时说明验证范围与缺口。

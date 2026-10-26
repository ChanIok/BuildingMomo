# AI 工作台维护导览

AI 工作台帮助玩家理解搭建，并整理集合与家具组。模型负责判断用途、组织方式和成员归属；宿主负责提供场景数据、校验编辑条件，并通过正式事务提交。目前没有移动、旋转、缩放或删除家具的 AI 工具。

工作台与模型相关功能共用 [settingsStore.ts](../../stores/settingsStore.ts) 的 `canUseExperimentalFeatures`，仅在 secure 模式且已鉴权时开放。权限失效时退出 AI 面板并停止任务，保留会话和配置。

## 运行链路

1. [useAiChat.ts](../../composables/ai/useAiChat.ts) 接收文字，管理会话、停止与恢复，并将记录投影到聊天界面。发送不读取选区，也允许无选区聊天。
2. [runner.ts](runner.ts) 管理任务循环：保存请求 → 流式生成 → 顺序执行工具 → 原子保存工具结果及资料 → 继续请求。只有完整生成成功的回复才进入工具执行；同一批工具最多一个 `apply`，且必须放在最后。
3. [context.ts](context.ts) 从保存的记录组装 SDK 消息，处理摘要、工具输出和图片预算。[model.ts](model.ts) 发起单次生成，由 AI SDK 处理协议序列化、流解析、参数校验、图片编码与 usage；工具执行和任务续接归 runner 管理。
4. [tools.ts](tools.ts) 提供四个工具：`inspect` 读取选区、资料与文档；`compute` 本地计算并发布结果；`render` 生成场景图或资产图册；`apply` 提交组织编辑。
5. [useAiEditorHost.ts](../../composables/ai/useAiEditorHost.ts) 连接编辑器，提供版本、快照、截图、组织事务和结果核验。场景分析基础能力位于 [sceneAnalysis](../sceneAnalysis/README.md)，不依赖 AI 会话。

## 资料引用与上下文

- `inspect({"ref":"selection"})` 捕获工具执行时的即时选区。引用固定精确成员，不随之后的选择变化；空选区保持为空，不扩展到整个方案。集合引用读取成员当前状态，不冻结坐标。
- [artifacts.ts](artifacts.ts) 管理会话内的 `R…` 引用，类型包括成员集合、报告、表格、计划和图片。[repository.ts](repository.ts) 将消息、工具记录、资料和大 payload 存入 IndexedDB，图片保存为 Blob，按需读取。配置与会话仅维护当前存储结构，不迁移开发期中间格式。
- `compute` 使用完整精度数据，输入不自动发送给模型。代码通过 `publish` 发布结果：报告直接返回内容，集合、表格和计划返回引用；完整数据可按需读取。DTO 与计算 API 见 `tools.ts` 的 `computationHelp`，模型通过 `inspect({"ref":"api"})` 获取。
- 持久化保留 SDK 原生消息内容、工具 input 和续传元数据，正文与思考是 UI 投影。推理及 provider 续传元数据只向原连接类型、地址和模型重放。编辑器状态与操作核验作为 `hostContext` 随对应回复保存，重放时保持原位置，不改写用户文字。
- 上下文压缩按容量触发，保留用户要求、任务摘要和近期完整交换；原始记录仍可回查。工具输出过大时返回标记预览和 recordId，图片按编码后的字节预算省略较早附图并留下引用。这些只改变请求投影，不修改保存的资料。
- [model.ts](model.ts) 在发送边界记录实际序列化请求体，将内嵌图片替换为本地资产引用，不记录请求头和接口查询参数。[diagnostics.ts](diagnostics.ts) 导出会话、请求、完整资料及可选图片，排查问题应使用当时的记录，而不是按当前配置重建请求。

## 编辑、版本与恢复

- 读取场景和提交编辑均经过宿主检查，成员必须存在、可见且未锁定。场景数据、保护状态或渲染条件变化会使版本更新，过期或已停止的异步任务不得发布结果；选择变化不改变已有引用的成员。
- `apply` 要求当前版本的成员引用或计划。过期成员集合可通过 `inspect` 更新引用，受场景变化影响的判断仍需重算；使用过期报告、表格或计划进行计算时，产物标为 `revision: null`，不能作为当前编辑计划。摘要本身不改变场景版本。
- 写入统一经过 [useEditorOrganization.ts](../../composables/editor/useEditorOrganization.ts) 的单笔正式事务，复用撤销/重做、增量渲染、云同步和工作台保存。宿主核验结构与保护状态；是否符合用户用途和授权范围由模型结合用户要求与场景指南判断。
- 编辑前先持久化 `prepared`；提交完成后，即使用户停止也必须保存结果。崩溃或结果未能保存而无法确认的编辑恢复为 `uncertain`，用户核对并确认前禁止后续写入，仍允许只读分析。刷新只恢复记录，不自动请求模型、执行代码或重放编辑。

## 计算与渲染边界

- [computeClient.ts](computeClient.ts) 为每次计算创建可终止的 Worker，通过 [computation.ts](computation.ts) 执行同步 JS。Worker 不接收 Key、编辑器对象或写入口，不降级到主线程；它仍有同源网络和存储能力，不是恶意代码安全沙箱。
- 分析 DTO 的位置与边界为世界空间厘米、Z 向上，旋转与缩放为视觉轴。转换复用共享函数；数据结构、几何与截图实现见 [sceneAnalysis](../sceneAnalysis/README.md)。
- 截图借用共享渲染资源，不释放库拥有的几何或材质；同步绘制和读回后，先恢复场景、相机及渲染器，再异步编码。

## 修改入口

- **工具契约**：[tools.ts](tools.ts) 放用途、执行逻辑和计算帮助；[toolInputs.ts](toolInputs.ts) 是字段结构与说明的共享 Zod 定义；[toolSchema.ts](toolSchema.ts) 整理错误并复用计划校验；[types.ts](types.ts) 定义会话记录和宿主接口。修改参数时同步检查执行逻辑与示例。
- **任务方法**：[prompts.ts](prompts.ts) 放通用授权、推进、沟通和摘要要求；[场景指南](guides/organization.md) 记录任务方法与完成标准，通过 [guides/index.ts](guides/index.ts) 登记并由 `inspect` 按需读取。新增指南应对应已开放能力，不把工具参数或指南全文复制进主提示词。
- **连接与模型设置**：[connection.ts](connection.ts) 定义连接类型和身份，[providers.ts](providers.ts) 构造适配器，[reasoning.ts](reasoning.ts) 处理统一与高级思考配置，[settingsStore.ts](../../stores/settingsStore.ts) 的 `ai` 分组统一持有配置并沿用现有存储键，连接解析与预算计算留在 AI 模块。恢复默认设置只重置偏好和预算，保留连接、凭据及模型参数。所有连接复用同一生成与工具流程；[models.ts](models.ts) 和 [useAiModels.ts](../../composables/ai/useAiModels.ts) 只负责当前连接的模型目录查询，不发起生成。
- **聊天界面**：[components/ai/](../../components/ai/) 下的 [SidebarAI.vue](../../components/ai/SidebarAI.vue)、[AiSettingsDialog.vue](../../components/ai/AiSettingsDialog.vue) 和 [AiMarkdown.vue](../../components/ai/AiMarkdown.vue)。Markdown 仅用于显示，不执行 HTML 或代码，也不加载模型给出的图片 URL；场景图片从本地 Blob 读取。
- **验证**：[tests/lib/ai/](../../../tests/lib/ai/) 覆盖模型、工具、上下文和存储；[tests/components/ai/](../../../tests/components/ai/) 覆盖聊天界面；[tests/composables/ai/](../../../tests/composables/ai/) 覆盖会话、编辑器宿主和模型查询集成；[editorOrganization.spec.ts](../../../tests/composables/editorOrganization.spec.ts) 覆盖通用组织事务。运行覆盖改动契约的定向测试；截图改动另检查实际 WebGL 画面，整理方法改动另用真实模型检查是否便于玩家查找和操作，单元测试不替代这两类验收。

测试优先覆盖数据正确性、安全边界和关键链路。同一规则在负责它的模块集中测试，上层只保留必要的集成验证；不为提示词措辞、普通文案、小交互状态或 SDK 通用行为逐项增加测试。

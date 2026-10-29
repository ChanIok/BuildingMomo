# AI 工作台维护导览

AI 是工作区级的代码助手：会话独立于方案，模型通过 JavaScript 读取、分析、截图并整理已加载方案。用户用自然语言交流，模型负责判断和编写脚本，宿主复用编辑器正式事务。当前只支持分类和编组，不支持移动、旋转、缩放或删除家具。

功能沿用 [settingsStore.ts](../../stores/settingsStore.ts) 的 `canUseExperimentalFeatures`，仅 secure 模式且已鉴权时开放。侧边栏 AI 入口不要求打开方案；切换方案、文档或关闭侧栏不中断任务。鉴权失效或连接配置变化会停止任务，保留会话和配置。

## 一条代码执行链路

1. [App.vue](../../App.vue) 持有应用级聊天服务和截图桥接。[useAiChat.ts](../../composables/ai/useAiChat.ts) 管理全局会话、恢复、停止及界面投影。
2. [runner.ts](runner.ts) 保存请求、流式回复和工具调用，完整生成成功后通过 [execution.ts](execution.ts) 顺序执行 `execute_js`；每次执行的结果、图片和新变量在同一存储事务中保存，成功后才发布到内存。
3. [scriptClient.ts](scriptClient.ts) 每次创建可终止 Worker，[aiScript.worker.ts](../../workers/aiScript.worker.ts) 通过 [scriptRuntime.ts](scriptRuntime.ts) 执行支持 `await` 的 JS 函数体。宿主 API 通过异步消息调用，局部变量不跨执行保留。
4. [tools.ts](tools.ts) 提供宿主 API、会话变量的家具引用解析，以及逐次编辑日志。[useAiEditorHost.ts](../../composables/ai/useAiEditorHost.ts) 按明确方案连接快照、截图和组织编辑，不切换界面来执行操作。
5. [context.ts](context.ts) 组装 SDK 消息和上下文压缩；[model.ts](model.ts) 负责单次生成，协议、流解析、参数校验、图片编码与 usage 交给 AI SDK。工具执行和任务续接由 runner 管理。

Worker 不接收 API Key、Pinia Store 或渲染器对象，不降级到主线程。它仍有同源网络和存储能力，不是恶意代码安全沙箱。停止或超时会终止 Worker，并禁止宿主继续执行排队操作；已完成的事务不会回滚。

## 通过桌面 MCP 使用现有工具

桌面版在 **AI → 外部 AI** 中开启本地 Streamable HTTP 服务。连接和客户端配置见 [桌面使用说明](../../../desktop/README.md#用桌面-ai-操作当前方案)。此入口仍要求现有实验功能鉴权，但不读取模型连接配置或 Key。

- [mcp.ts](mcp.ts) 只适配协议、工具说明、输入校验、文本与图片返回；支持 `2026-07-28` 及 `2025-11-25`、`2025-06-18`、`2025-03-26` 的无传输会话 HTTP 模式。新协议显式校验请求元数据与头部一致性，旧协议支持 `initialize`，不分配 `Mcp-Session-Id`。取消绑定原生 HTTP 请求编号，不按可能跨客户端重复的 JSON-RPC id 取消其他任务。
- [externalWorkbench.ts](externalWorkbench.ts) 通过 `Conversation.external` 标识外部执行上下文，复用原 IndexedDB 和正式事务。内部聊天列表不显示这些上下文。工具调用不伪造助手消息，也不产生模型请求记录；只有用户核对不确定编辑时保留确认消息。
- `execute_js({code,contextId?})` 首次省略编号时创建独立上下文；后续显式携带。默认方案在创建时固定，显式方案参数仍沿用现有宿主能力。未知、已删除或内置聊天的编号不回退到其他上下文。
- [execution.ts](execution.ts) 共用变量、图片及执行结果的保存边界。[executionGate.ts](executionGate.ts) 让内置 runner 和外部调用共用一个执行槽，不同时借用渲染器或交错执行脚本；用户手动编辑不受锁定。
- [useExternalAi.ts](../../composables/ai/useExternalAi.ts) 在应用级持有服务，关闭侧栏不终止任务。页面代际、鉴权、停止和取消通过 WebView2 专用消息与 C++ 两端联动；页面刷新或导航会停用原生服务，旧回执不进入新页面。
- [SidebarExternalAI.vue](../../components/ai/SidebarExternalAI.vue) 展示连接、上下文、脚本回执和图片，提供停止、删除及人工核对入口。客户端只需本地 MCP 地址，不使用连接令牌；端口保存在网站设置中。

相关定向测试为 `tests/lib/ai/externalWorkbench.spec.ts`、`tests/lib/ai/mcp.spec.ts` 和 `tests/composables/ai/externalAi.spec.ts`。原生服务的监听、退出和真实客户端连接仍需用桌面产物验证。

## 数据留在执行环境，按需输出

模型只有一个工具 `execute_js({ code })`，不再使用 `inspect/compute/render/apply` 工具、`publish`、`R…` 资料或持久化编辑计划。

```js
vars.selected = await api.selection()
console.log({ count: vars.selected.length })
```

完整家具数组留在执行环境；模型用 `console.log` 和 `return` 输出任务需要的结论、统计、关键字段和代表性样本。宿主另行自动提供图片回执和编辑结果。后续执行或重新打开会话后，可以直接：

```js
await api.render([{ items: vars.selected, label: '选区' }])
```

- `vars` 是每个对话独立的持久化普通对象，支持有限 JSON 数据：有限数字、字符串、布尔、null、数组和普通对象。函数、Promise、Map、undefined、循环引用等返回错误，不静默丢失。
- 临时 `const/let` 用于本次计算；值得保留的数据由模型自行命名放进 `vars`，删除用 `delete vars.name`。不恢复整个 JS 内核，不重放脚本恢复变量。
- 脚本失败、停止或最终保存失败时，保留上次成功保存的变量，包括嵌套数据。只有成功执行且存储成功才替换变量。
- 家具对象包含短 `ref`，内部 UUID 和快照版本留在宿主引用表。`filter/slice` 得到的家具数组可直接传给渲染和编组，不展开为大量 ID 参数。
- 保存的家具对象是当时的数据快照、成员名单固定。`api.refresh(items)` 重新读取原成员的当前数据，不替换成当前选区；成员缺失、隐藏或锁定时整次报错。刷新后需重新检查基于旧数据的判断。
- 上下文携带变量名、类型和数组长度，不复制变量内容；压缩保留用户目标、授权、关键判断、已完成编辑和仍需使用的变量名。需要细节时用脚本检查变量或重新读取方案。

## 小型宿主 API

通用工作原则放在系统提示，接口契约与示例放在工具说明，整理方法放在按需指南，三者各述其职。基础 API 契约与可执行示例直接由 `tools.ts` 的 `execute_js.description` 随工具声明发送，计入工具上下文预算，不再先执行帮助调用，也不在系统提示词中重复整份说明。`api.help(topic)` 只读取较长的场景指南，例如 `console.log(await api.help("guide:organization"))`。

| API                                  | 职责                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `api.schemes()`                      | 已加载方案的 `{id,name}` 目录                          |
| `api.items(schemeId?)`               | 读取可见、未锁定家具的完整快照到执行环境               |
| `api.selection(schemeId?)`           | 捕获调用时的精确选区；空选区就是空数组                 |
| `api.structure(schemeId?)`           | 现有分组元信息和分类树，包含空分类                     |
| `api.refresh(items)`                 | 保持成员及顺序，重新取得当前家具数据                   |
| `api.render(panels, layout?)`        | 多批物品、多视角或图册合成一张图；单图也使用面板数组   |
| `api.organize(groups, collections?)` | 用家具数组创建分类、重新编组，一次调用一笔正式事务     |
| `api.history({id?,offset?,limit?})`  | 当前会话的执行记录目录或完整 JSON 分段读取（字符偏移） |
| `api.showImage(imageId)`             | 重新展示本对话的历史原图                               |
| `api.math.*`                         | 共享坐标、统计和保守几何计算；其他计算使用普通 JS      |

省略方案 ID 时使用本轮用户消息开始时固定的默认方案；切换标签不改变默认目标。显式方案 ID 可读取和编辑后台方案。渲染和一次编组的成员必须来自同一方案。场景图借用目标方案已打开的模型视口，不能在后台任意加载模型；图册可直接读取后台方案，不自动切换用户视口。

读取不强制分页、不自动输出全量家具。执行输出过大时，完整结果保存在执行记录中，请求投影提供标记预览和 recordId，模型可通过 `api.history` 回查；这不截断 Worker 内的数据。历史查询不是重新执行。图片使用 Blob 附件，脚本不用处理 Base64。

## 多面板一次合图

每个面板传入 `{items,label,kind?,camera?,focus?,width?,height?,color?,labels?,layout?}`。默认为场景图，`focus` 只控制取景，必须是 `items` 的子集。所有面板来自同一方案。

分析外观、建筑结构、组合用途和空间关系时，通过图片建立认识，围绕待判断的问题组织互补的整体、局部、拆分或多视角观察。观察范围、视角和数量由任务决定，不限制面板数量；省略外层布局时由宿主自动排版。

AI 场景单面板的宽、高各默认 768px，通常使用长边 512～1024px，通过局部取景和隔离成员辨认细节。工具边界将长边超过 1024px 的场景面板等比缩小，保留更小的显式尺寸；图册、合图布局和非 AI 截图入口不受该限制。`details.panels` 返回实际 `width/height`。

例如，先按观察目的将家具范围与所需视角保存在 `vars.batches`：每批为 `{name, items, views: [{name, camera}, …]}`，各批可选择不同视角。一次生成所有面板：

```js
const panels = vars.batches.flatMap((batch) =>
  batch.views.map((view) => ({
    items: batch.items,
    label: `${batch.name} · ${view.name}`,
    camera: view.camera,
  }))
)
await api.render(panels)
```

一次调用只保存并附上最终合图，不发送或持久化中间图片。返回的 `details.panels` 按输入顺序包含编号（从 1 开始）、标题和各面板渲染信息。图片元信息与回执同时保存在附件和工具记录中，自动随工具结果的 `images` 发送，即使脚本忽略 `render` 返回值也能看到方案、视角、渲染数量和缺失情况；大输出预览保留这部分回执。`api.history`、`showImage` 和诊断导出沿用同一元信息。依据观察结果补充有助于消除疑点的图片，用 JavaScript 完成精确筛选、统计和成员划分。

- 省略外层布局（或传入 `{}`）时按图片比例自适应排版：按输入顺序分列，各列完整填充，选择更接近方形的组合。面板允许等比缩放，完整保留画面，不裁切；合图面积接近各原图与标题区的总面积，不固定缩为缩略图。三张方图可自然排成一张较大图加两张较小图，而不是留一个空格。回执 `frame: {x,y,width,height}` 给出各面板的位置和尺寸（含标题区），编号仍对应输入顺序。
- 显式外层 `layout: {columns?,cellWidth?,cellHeight?}` 使用等大网格，`cellHeight` 包含 32px 标题区，必须大于 32。省略单元格尺寸时使用原图最大宽、高加标题区；指定尺寸时按比例放入单元格。显式布局可能留空格，不自动拆页。
- `kind: "atlas"` 面板只接受 `items/label/kind/layout`，面板内的 `layout` 控制素材图册网格，与外层拼图布局独立；不能把它传给场景面板。
- 截图与图册中间面板使用无损 PNG，最终输出统一编码为 WebP q90，不额外降低分辨率。单面板保留原尺寸，不加拼图标题；已经是 WebP 的单图直接复用，其余单图只编码一次。多面板只在最终合图处进行一次有损编码。浏览器不支持 WebP 时接受其 PNG 回退，并保存实际 MIME。历史重读沿用原始 Blob，不重新编码。
- 全部面板参数与成员在首次截图前校验；同一成员范围的多个视角在本次调用内复用不可变数据和渲染快照，不建立跨任务缓存。任何面板失败、任务停止、资源代际或目标方案变化，整次合图不发布半成品。共享渲染器顺序绘制，不另建上下文。

## 编辑、版本与恢复

- 每个方案按数据与保护状态的引用维护独立版本；选区、界面焦点和相机不使数据版本失效。重新加载宿主后，保存的旧家具仍能恢复，但编辑前要 `refresh`。
- `organize` 要求当前快照，校验成员、分类结构和目标限制，经过 [useEditorOrganization.ts](../../composables/editor/useEditorOrganization.ts) 与 [useEditorHistory.ts](../../composables/editor/useEditorHistory.ts) 的正式事务。后台方案拥有自己的历史，UI 原有调用仍默认当前方案。工作区 Worker 按方案身份接收受影响内容，不仅保存激活方案；普通编辑只补发变化的后台方案，分类折叠仍走轻量通道。不可变更新、撤销/重做、ID 分配器、持久化和云同步沿用现有链路；云方案仍需现有连接。
- 每次实际编辑先持久化 `prepared`，再提交并立即保存结果。一次脚本可以有多笔编辑；即使后续 JS 报错或变量保存失败，已成功的编辑仍独立保留，模型和界面都能看到。
- 未能保存提交结果或崩溃时留下的 `prepared` 恢复为 `uncertain`；核对并确认前禁止后续写入，允许只读操作。刷新只恢复数据，不请求模型、不执行代码、不重放编辑。
- 场景截图绑定明确方案的不可变渲染快照，并检查数据版本、截图提供者生命周期和渲染策略；过期任务不发布图片。借用共享几何、材质，业务消费者不释放库资源。同步绘制读回后先恢复渲染状态，再异步编码。
- 分析 DTO 的位置和边界为世界空间厘米、Z 向上；旋转与缩放为视觉轴，复用现有转换。几何和截图基础能力位于 [sceneAnalysis](../sceneAnalysis/README.md)，与 AI 会话解耦。

## 存储、上下文和诊断

[repository.ts](repository.ts) 使用固定的 `buildingmomo-ai` IndexedDB、`records` 对象仓库和数字结构版本。版本 2 清空未发版的旧资料结构，不迁移开发期会话；不影响方案快照或 AI 连接配置。旧名称的开发库在启动时清理。

记录包括会话、消息、工具执行（含逐次编辑结果）、`vars` 及其宿主引用表、图片附件、摘要和模型请求。删除会话同时删除这些记录。

SDK 原生消息、工具 input 和续传元数据持久化，正文与思考只是 UI 投影。推理及 provider 元数据只向原连接类型、地址和模型重放；宿主事实以 `hostContext` 保持在对应回复前，不改写用户文字。上下文压缩或图片预算只影响请求投影，不修改原始记录和变量。

### 图片体积保护与输入 token 估算

图片体积保护采用批量回落：默认 Base64 编码后总量超过 32 MiB 时，从最早图片开始替换为简短引用，直到降至 15 MiB；更低的自定义触发值采用 15/32 的回落比例，目标不超过 15 MiB。两次触发之间保留相同的替换前缀，避免每新增一张图就重写历史。仅改变请求投影，原始 Blob 与回执仍在；引用只保留图片标识、省略原因和 `showImage` 入口，完整回执仍在工具结果中。历史替换可能影响替换位置及其之后的前缀缓存。没有图片移除 API、固定张数窗口或自动降分辨率。

字节保护处理请求体积，token 估算处理上下文容量，两者独立。估算优先使用上次成功请求的 SDK `inputTokens` 加本次新增内容的本地估算；历史图片的实际占用已在基线中，仅新增图片按 `ceil(width/32) × ceil(height/32)` 做尺寸相关兜底估算。这是粗估单位，不是所有模型的计费公式，也不改变上传图片的尺寸。估算定义加入投影标识，旧的固定估算基线不会混入新算法。SDK 输入总量已包含缓存输入，输出正文通过新增消息计入，均不重复加 usage 明细。配置的总窗口与 `maxTokens` 输出上限相互独立。

请求记录保存本地估算、投影标识和消息边界，跨用户轮次或重新打开会话后继续使用有效基线。新增图片不使基线失效；图片替换前缀、摘要、模型或上下文定义变化时退回本地估算，再由下次真实 usage 校准。失败请求或缺少有效 usage 不覆盖最近有效基线。过长上下文仍沿用既有容量压缩及实际溢出后的重试路径。

容量策略对齐本地 Codex `protocol/src/openai_models.rs` 的默认比例：可用窗口为总窗口的 95%，自动压缩阈值为总窗口的 90%（两者分别基于总量计算）。`maxTokens` 是输出上限，不预先从输入窗口中扣除。普通与摘要请求共用发送边界，实际 `maxOutputTokens = min(maxTokens, 可用窗口 - 向上取整的输入估算)`；没有剩余空间时不发送。摘要前缀加末尾摘要要求须低于可用窗口，生成额度同样按剩余空间计算。请求记录同时保留配置策略和实际发送额度。

例如总窗口 256,000、输出上限 128,000 时，可用窗口为 243,200，压缩阈值为 230,400；输入估算 180,000 时实际输出上限为 63,200，而非提前在 128,000 输入处压缩。原生 Codex Responses 请求未设置输出上限；这里为多 provider SDK 请求显式计算，不照搬其协议字段。

摘要请求从同一份普通请求投影截取完整前缀，再追加摘要要求；保留原系统提示、工具定义、调用配置与续传元数据。边界覆盖完整助手消息、工具结果与附件，不另行重建历史或重复复制用户要求。摘要通道仅接受文本，返回工具调用时记录协议错误并停止，不执行任何脚本。正常摘要沿用当前 usage 校准；只有真实容量不足时才缩短前缀，必要时使用不附图的恢复摘要。原始记录和图片始终保留。客户端前缀一致是缓存复用条件，不保证网关必然命中。

[model.ts](model.ts) 在发送边界记录实际序列化请求体，内嵌图片替换为本地资产引用，不记录请求头和接口查询参数。[diagnostics.ts](diagnostics.ts) 导出当时的会话、执行、变量、请求和可选原图，排障不按当前配置重建请求。

## 修改与验证入口

- **工具与执行**：`toolInputs.ts` 定义唯一工具输入，`tools.ts` 定义宿主 API 与默认工具说明，`scriptRuntime.ts` 定义执行/序列化，`types.ts` 定义持久化与宿主接口。修改接口同步检查帮助、提示词和示例。
- **模型设置**：`connection.ts`、`providers.ts`、`reasoning.ts`、`settingsStore.ts` 沿用统一配置。`models.ts` / `useAiModels.ts` 只查询模型目录，不生成对话。
- **任务方法**：`prompts.ts` 放通用授权和摘要要求；[guides](guides/index.ts) 登记按需读取的任务指南，不把指南全文塞进主提示词。
- **界面**：[SidebarAI.vue](../../components/ai/SidebarAI.vue) 展示输出、错误、逐次编辑和图片，代码折叠查看。工具输出在打开详情时才格式化，终态条目与格式化结果复用。Markdown 不执行 HTML/代码或加载模型提供的图片 URL，本地图片从 Blob 读取。
- **定向验证**：[tests/lib/ai/](../../../tests/lib/ai/) 覆盖 Worker、变量、结果日志、上下文与存储；[tests/composables/ai/](../../../tests/composables/ai/) 覆盖会话生命周期和按方案宿主；[editorOrganization.spec.ts](../../../tests/composables/editorOrganization.spec.ts) 覆盖后台方案、撤销/重做、正式事务与云队列。截图还需实际 WebGL 画面验收，整理效果还需真实模型任务验收。

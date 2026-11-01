# Windows 桌面外壳

一个 Win32 C++ + WebView2 窗口，直接加载 BuildingMomo 网页，不打包前端，也不改变 Three.js 渲染逻辑。默认不启动本地 HTTP 服务；用户开启外部 AI 后才监听本机 MCP 接口。

## 开发运行

需要 Windows 10/11 x64、Visual Studio C++ Build Tools（含 Windows SDK）、LLVM/clang-cl、xmake、vcpkg 和 [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。将 vcpkg 目录配置到 `VCPKG_ROOT`。原生构建沿用 SpinningMomo 的 xmake/clang-cl 工具链和 vcpkg 快照。

在仓库根目录启动前端：

```powershell
pnpm dev --port 5173 --strictPort
```

另开终端，在仓库根目录构建并运行 Debug：

```powershell
pnpm run build:cpp
.\desktop\build\windows\x64\debug\BuildingMomo.exe
```

Debug 固定加载 `http://localhost:5173`。云端功能仍需现有 Vite `/api` 代理对应的开发后端；桌面外壳不提供该后端。页面无法连接时使用 WebView2 默认错误页，启动开发服务器后按 Ctrl+R 重试。

## Release 构建

在仓库根目录执行：

```powershell
pnpm run build:cpp --release
```

产物为 `desktop/build/windows/x64/release/BuildingMomo.exe`，固定加载 **https://lab.infinitymomo.com**。运行时需要网络和 WebView2 Runtime；Loader 静态链接，无需随程序放置 `WebView2Loader.dll`。网页更新不需要重新构建外壳。

直接启动，无需参数：

```powershell
.\desktop\build\windows\x64\release\BuildingMomo.exe
```

## 用桌面 AI 操作当前方案

在 BuildingMomo 桌面版完成实验功能鉴权，打开 **AI → 外部 AI → 允许外部 AI 连接**。服务默认关闭，每次打开应用或刷新页面后都需要重新开启。默认地址为 `http://127.0.0.1:50725/mcp`；端口被占用时，在关闭服务的状态下修改端口后重试。

在客户端选择 Streamable HTTP，填写上方地址即可，无需认证或模型 API Key。也可以选择客户端并复制对应格式的连接配置。

### ChatGPT Desktop / Codex

将面板复制的 TOML 条目加入 `~/.codex/config.toml`（Windows 通常是 `%USERPROFILE%\.codex\config.toml`），不要替换原文件。条目形如：

```toml
[mcp_servers.buildingmomo]
url = "http://127.0.0.1:50725/mcp"
tool_timeout_sec = 75
```

在客户端重新启动 MCP 连接。也可以在 MCP 服务器设置中选择 Streamable HTTP，并填写同样的 URL，认证方式选择无认证。参见 [ChatGPT/Codex MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp)。

### DeepSeek Harness

将面板复制的 YAML 条目加入当前 Harness 配置的插件列表，再重新加载配置：

```yaml
- id: mcp-buildingmomo
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: buildingmomo
    transport: streamable-http
    url: http://127.0.0.1:50725/mcp
    toolCallTimeoutMs: 75000
```

配置位置由使用的 Harness profile 决定；参见 [官方 MCP client 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)。其他客户端可复制通用 JSON，或直接填写 MCP 地址。

连接后可以说：“读取 BuildingMomo 当前选区，截图并说明其中的家具。”使用支持图片输入的模型才能进行视觉分析。场景截图要求目标方案在当前模型视口中打开；后台方案可生成素材图册。

### 多个对话与停止行为

- 唯一工具是 `execute_js({ code, contextId? })`。新任务首次不传 `contextId`，结果会返回编号；后续调用必须携带该编号。遗漏编号会创建新上下文，不会借用最近一个任务。
- 每个上下文单独保存变量、家具引用、图片和执行记录，默认方案在创建时固定。关闭 AI 聊天窗口不会自动删除记录或撤销编辑。
- 各上下文操作实际的共享方案。旧快照提交会被拒绝，需 `api.refresh()` 后重新判断。分类和编组经过正式事务，可用编辑器正常撤销；没有移动、旋转、缩放或删除接口。
- 内置与外部 AI 同时只允许一条任务执行，其他调用返回忙碌。停止按钮或关闭连接会取消尚未完成的执行，已完成编辑保留。HTTP 请求在执行期间断开或超过 60 秒时取消对应任务；不自动重放代码。普通 HTTP 短连接结束不会清空上下文。
- 结果不确定时，在面板核对场景后确认再继续；只读查询仍可使用。执行结果也可通过同一上下文的 `api.history()` 回查。

服务只监听 `127.0.0.1`，并校验 Host 和 Origin，不使用连接认证。服务开启期间，同机其他程序也可调用接口。网页通过已有 WebView2 消息桥执行工具，不直接请求本地端口。原生层只转发专用 AI 消息，不把桌面管理命令开放给 MCP。

## GPU 选择与调度

**客户端设置 → 性能调度 → 优先使用高性能 GPU** 默认开启，启动时向 WebView2 传入 `--force-high-performance-gpu`；关闭后由系统选择。修改后重启客户端生效，与 GPU 实时调度优先级独立。

偏好通过 `%LOCALAPPDATA%\BuildingMomo\use_system_gpu` 标记文件保存（存在表示关闭）。若无法操作界面，可退出客户端后手动创建该空文件，再启动恢复系统选择。

启用 GPU 实时调度配置时，宿主识别当前 WebView2 环境的 GPU 进程，尝试将其 GPU 调度优先级设为 **Real Time**，不修改 CPU 优先级。每个 PID 在本次监视期间只尝试一次，新 GPU 进程出现时重新检查配置。关闭配置不会恢复已设置的优先级，退出时只停止监视，不恢复原值。

日志位于 `%LOCALAPPDATA%\BuildingMomo\logs\gpu-priority-<宿主PID>.log`，最多保留 5 个日志文件。`priority set to REALTIME` 表示设置调用成功；宿主不读回验证实际值。设置失败时记录 Win32 或 NTSTATUS 错误码，不单独触发提权。日志目录或文件无法创建时仍继续启动，可通过调试输出查看后续日志。

如果桌面版出现卡顿或无响应，退出后可使用普通浏览器继续编辑。

## 数据与窗口行为

- 用户数据位于 `%LOCALAPPDATA%\BuildingMomo\WebView2\`，退出或更新程序不会删除它。
- 普通浏览器已有的方案、设置和登录态不会自动迁入；需要时先在原浏览器导出，再在桌面版导入。
- Debug 与 Release 页面来源不同，各自拥有独立的网站存储和登录态。
- 原生窗口支持缩放、最小化、最大化和 Per-Monitor V2 DPI。外部 HTTP/HTTPS 链接交给系统默认浏览器。
- 文件导入导出沿用网页及 WebView2 的默认文件/下载界面。WebMessage 桥用于桌面设置及外部 AI，不提供通用原生对象或任意本地文件访问。

## 代码分工

- `main.cpp`：单实例与提权流程、COM 初始化、消息循环。
- `app_state.hpp/.cpp`：持有桌面配置、单实例锁、WebView 资源及各模块状态。
- `app.hpp/.cpp`：统一协调服务启动和退出，连接模块间的状态通知。
- `window.hpp/.cpp`：Win32 窗口与消息。
- `webview.hpp/.cpp`：WebView2、页面导航与窗口同步。
- `desktop_bridge.hpp/.cpp`：校验网页消息、调用业务入口，统一序列化并发送 JSON，不持有重复的窗口或 WebView 句柄。
- `mcp/`：本机 HTTP MCP 传输、来源检查、请求取消和 UI 线程调度；工具协议与执行由前端负责。
- `rtss/`：RTSS DLL 调用、前台事件与心跳检查、后台限帧状态。
- `gpu_priority/`：GPU 进程识别、实时优先级设置、结果日志。
- `memory_cleaner.hpp/.cpp`、`system_utils.hpp/.cpp`、`string_utils.hpp/.cpp`：内存、系统与编码转换工具。
- `vendor/`：标准库、Windows SDK 和第三方库的 include facade。
- `resources/`：应用图标（来自 `public/favicon.ico`）、版本资源和权限/DPI 清单。

## C++ 维护约定

代码风格沿用 SpinningMomo：Google 基础格式、100 字符行宽，函数使用 `auto name(...) -> ReturnType`，模块位于 `desktop` 下的子命名空间。提交时由 lint-staged 调用 LLVM 的 `clang-format`，配置位于 `desktop/.clang-format`。

- 状态由 `AppState` 持有，模块使用自由函数；桥接层不负责启动和关闭其他服务。
- 模块公共状态放在各自的 `state.hpp`，根状态通过前向声明持有它们；完整定义只在需要访问字段的实现中包含。
- `.cpp` 先包含对应头文件，再依次包含 `vendor/std.hpp`、其他 vendor 头文件、项目头文件。外部尖括号 include 只放在 `vendor/`，SDK facade 与物理头文件一一对应。项目头文件必须在不使用 PCH 时自包含。
- 内部消息和错误使用 UTF-8，Win32 边界使用 UTF-16，通过 `string_utils` 转换。JSON 统一使用 `Json` 构造，前端消息名、字段名和错误码保持既有协议。
- 注释以中文说明调用契约、线程归属、生命周期和必要原因；不逐句翻译代码，不为简单函数添加模板化说明。

MCP 的公开入口和消息发送均在 UI 线程执行。HTTP 工作线程只访问受互斥锁保护的共享数据，并通过消息队列交回 UI。页面重置和应用退出先唤醒待响应请求、等待旧服务退出，再释放或更换会话状态。

RTSS 的前台事件回调不保存全局状态指针，而是投递线程消息，由主循环使用当前 `AppState` 处理；心跳检查通过宿主窗口的 `WM_TIMER` 执行。

## 定向验证

在 `desktop/` 目录运行独立原生测试：

```powershell
xmake build desktop_tests
xmake run desktop_tests
```

该目标不参与默认构建，不启动桌面应用，不修改游戏进程、GPU 优先级或用户文件。测试使用临时本机端口，覆盖编码转换、RTSS 状态通知，以及 MCP 的来源校验、请求转发、旧页面响应隔离、立即关闭、页面重置和断连取消。

前端协议相关测试在仓库根目录运行：

```powershell
pnpm test tests/lib/ai/mcp.spec.ts tests/composables/ai/externalAi.spec.ts
pnpm test tests/stores/desktopStore.spec.ts
```

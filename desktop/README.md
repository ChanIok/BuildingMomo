# Windows 桌面外壳

一个 Win32 C++ + WebView2 窗口，直接加载 BuildingMomo 网页，不打包前端、不启动本地 HTTP 服务，也不改变 Three.js 渲染逻辑。

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

## GPU 调度

启动后自动识别当前 WebView2 环境的 GPU 进程，将其 GPU 调度优先级设为 **Real Time**，不修改 CPU 优先级。GPU 进程重建时自动重新应用；正常退出时恢复本次修改前的值，不覆盖其他工具期间设置的不同值。桌面版请单实例运行，避免共享 GPU 进程的恢复操作相互干扰。

日志位于 `%LOCALAPPDATA%\BuildingMomo\logs\gpu-priority-<宿主PID>.log`，记录设置与退出恢复结果。`verified=true` 且 `actual=5` 表示实时 GPU 优先级已成功设置并读回匹配；`already realtime` 表示进程原本已是实时级别。设置权限不足时记日志，不自动提权，网页仍可继续使用。日志文件无法创建时会提示并停止启动。

如果桌面版出现卡顿或无响应，退出后可使用普通浏览器继续编辑。

## 数据与窗口行为

- 用户数据位于 `%LOCALAPPDATA%\BuildingMomo\WebView2\`，退出或更新程序不会删除它。
- 普通浏览器已有的方案、设置和登录态不会自动迁入；需要时先在原浏览器导出，再在桌面版导入。
- Debug 与 Release 页面来源不同，各自拥有独立的网站存储和登录态。
- 原生窗口支持缩放、最小化、最大化和 Per-Monitor V2 DPI。外部 HTTP/HTTPS 链接交给系统默认浏览器。
- 文件导入导出沿用网页及 WebView2 的默认文件/下载界面，无原生 RPC、JS 桥或本地文件访问扩展。

## 代码分工

- `main.cpp`：COM 初始化、消息循环。
- `app.hpp/.cpp`：集中状态、启动和退出协调。
- `window.hpp/.cpp`：Win32 窗口与消息。
- `webview.hpp/.cpp`：WebView2、页面导航与窗口同步。
- `gpu_priority.hpp/.cpp`：GPU 进程识别、实时优先级设置与退出恢复、结果日志。
- `resources/`：应用图标（来自 `public/favicon.ico`）、版本资源和权限/DPI 清单。

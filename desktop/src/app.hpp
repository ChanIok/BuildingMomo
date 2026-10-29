#pragma once

#include "vendor/std.hpp"

#include "vendor/windows.hpp"

namespace desktop {

struct AppState;

inline constexpr UINT kWebViewErrorMessage = WM_APP + 1;

// 初始化应用生命周期：启动 GPU 日志 → 创建主窗口 → 启动 MCP/RTSS → 初始化 WebView2
auto initialize(AppState& state, int show_command) -> std::expected<void, std::string>;
// 优雅关闭应用：标记退出 → 关闭后台各子系统 → 释放 WebView 控制器与 COM 资源
auto shutdown(AppState& state) -> void;
// 记录 WebView2 运行期错误并在主循环中排队弹窗
auto report_webview_error(AppState& state, std::string_view operation, HRESULT result) -> void;
// 弹出错误模态提示框并销毁主窗口
auto show_pending_error(AppState& state) -> void;

}  // namespace desktop

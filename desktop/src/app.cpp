#include "app.hpp"

#include "vendor/std.hpp"

#include "app_state.hpp"
#include "desktop_bridge.hpp"
#include "gpu_priority/gpu_priority.hpp"
#include "mcp/mcp_server.hpp"
#include "rtss/rtss_limiter.hpp"
#include "string_utils.hpp"
#include "webview.hpp"
#include "window.hpp"

namespace desktop {

// 初始化应用生命周期：启动 GPU 日志 → 创建主窗口 → 启动 MCP/RTSS → 初始化 WebView2
auto initialize(AppState& state, int show_command) -> std::expected<void, std::string> {
  // 初始化 GPU 优先级模块日志文件
  gpu_priority::initialize_log(state);
  // 创建并显示主原生窗口
  if (auto result = window::create(state, show_command); !result) {
    return result;
  }
  // 初始化 MCP 服务并绑定前端消息投递管道
  mcp::initialize(state, [&state](const Json& message) { bridge::send_message(state, message); });
  // 初始化 RTSS 状态监听并绑定广播回调
  rtss::initialize(state, [&state](const rtss::RtssStatus&) { bridge::broadcast_status(state); });
  // 启动并初始化 WebView2 运行时环境
  return webview::initialize(state);
}

// 优雅关闭应用：标记退出 → 关闭后台各子系统 → 释放 WebView 控制器与 COM 资源
auto shutdown(AppState& state) -> void {
  // 防止重复进入关闭逻辑
  if (state.shutting_down) {
    return;
  }
  state.shutting_down = true;
  // HTTP 工作线程可能仍引用 AppState，必须先停止服务，再释放页面与窗口资源。
  mcp::shutdown(state);
  rtss::shutdown(state);
  gpu_priority::shutdown(state);
  // 关闭并释放 WebView2 控制器
  if (state.controller) {
    state.controller->Close();
  }
  state.webview.reset();
  state.controller.reset();
  state.environment.reset();
}

// 记录 WebView2 运行期错误并在主循环中排队弹窗
auto report_webview_error(AppState& state, std::string_view operation, HRESULT result) -> void {
  // 已在关闭中或已有挂起错误时忽略后续错误
  if (state.shutting_down || !state.pending_error.empty()) {
    return;
  }
  // 格式化错误提示文本并设置失败退出码
  state.pending_error =
      std::format("{}失败（HRESULT: 0x{:08X}）。\n\n请确认已安装 Microsoft Edge WebView2 Runtime。",
                  operation, static_cast<unsigned long>(result));
  state.exit_code = 1;
  // WebView2 回调中不能开启模态消息循环；返回消息循环后再显示错误并关闭窗口。
  PostMessageW(state.window, kWebViewErrorMessage, 0, 0);
}

// 弹出错误模态提示框并销毁主窗口
auto show_pending_error(AppState& state) -> void {
  // 原子取出挂起的错误消息
  auto message = std::exchange(state.pending_error, {});
  // 弹出系统模态错误框并销毁主窗口
  if (!message.empty() && !state.shutting_down) {
    MessageBoxW(state.window, string::from_utf8(message).c_str(), L"BuildingMomo",
                MB_OK | MB_ICONERROR);
    DestroyWindow(state.window);
  }
}

}  // namespace desktop

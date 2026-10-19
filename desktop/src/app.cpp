#include "app.hpp"

#include <format>
#include <utility>

#include "webview.hpp"
#include "window.hpp"

namespace desktop {

auto initialize(AppState& state, int show_command) -> std::expected<void, std::wstring> {
  init_gpu_priority_log(state.gpu_priority);
  if (auto result = create_window(state, show_command); !result) {
    return result;
  }
  return initialize_webview(state);
}

auto shutdown(AppState& state) -> void {
  if (state.shutting_down) {
    return;
  }
  state.shutting_down = true;
  shutdown_gpu_priority(state.gpu_priority);
  if (state.controller) {
    state.controller->Close();
  }
  state.webview.reset();
  state.controller.reset();
  state.environment.reset();
}

auto report_webview_error(AppState& state, std::wstring_view operation, HRESULT result) -> void {
  if (state.shutting_down || !state.pending_error.empty()) {
    return;
  }
  state.pending_error = std::format(
      L"{}失败（HRESULT: 0x{:08X}）。\n\n请确认已安装 Microsoft Edge WebView2 Runtime。",
      operation, static_cast<unsigned long>(result));
  state.exit_code = 1;
  // WebView2 回调中不能开启模态消息循环；返回消息循环后再显示错误并关闭窗口。
  PostMessageW(state.window, kWebViewErrorMessage, 0, 0);
}

auto show_pending_error(AppState& state) -> void {
  auto message = std::exchange(state.pending_error, {});
  if (!message.empty() && !state.shutting_down) {
    MessageBoxW(state.window, message.c_str(), L"BuildingMomo", MB_OK | MB_ICONERROR);
    DestroyWindow(state.window);
  }
}

}  // namespace desktop

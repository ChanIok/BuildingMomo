#include "vendor/std.hpp"

#include "vendor/windows.hpp"
#include "vendor/windows/objbase.hpp"

#include "app.hpp"
#include "app_state.hpp"
#include "rtss/rtss_limiter.hpp"
#include "string_utils.hpp"
#include "system_utils.hpp"

// 应用程序主入口：单实例防重 → UAC 提权协商 → 初始化 COM 与应用子系统 → 运行 Win32 消息循环 →
// 资源清理
auto WINAPI wWinMain(HINSTANCE instance, HINSTANCE, LPWSTR cmd_line, int show_command) -> int {
  // 状态覆盖异步 WebView2 初始化的退出清理，并保持存活直到 CoUninitialize。
  desktop::AppState state;
  state.instance = instance;

  // 单实例检查必须早于提权，避免已有实例时仍弹出 UAC。
  if (!desktop::system::acquire_single_instance_lock(state)) {
    desktop::system::activate_existing_instance();
    return 0;
  }

  // no_admin 标记文件决定是否请求管理员权限。
  bool disable_admin = desktop::system::has_no_admin_marker();
  if (!disable_admin && !desktop::system::is_process_elevated()) {
    // 提权前先释放单实例锁，避免提权后的新进程被误判为“已有实例”
    desktop::system::release_single_instance_lock(state);

    // 以管理员权限拉起新实例，若成功则当前未提权实例正常退出
    if (desktop::system::restart_as_elevated(cmd_line)) {
      return 0;
    }

    // 用户在 UAC 弹窗点击“否”或提权失败：重新获取单实例锁后降级在普通权限下继续运行
    if (!desktop::system::acquire_single_instance_lock(state)) {
      desktop::system::activate_existing_instance();
      return 0;
    }
  }

  // 初始化当前线程 STA COM 套间
  auto result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  if (FAILED(result)) {
    desktop::system::release_single_instance_lock(state);
    MessageBoxW(nullptr, L"无法初始化 COM。", L"BuildingMomo", MB_OK | MB_ICONERROR);
    return 1;
  }

  // 初始化应用窗口与各个子系统
  if (auto initialized = desktop::initialize(state, show_command); !initialized) {
    MessageBoxW(state.window, desktop::string::from_utf8(initialized.error()).c_str(),
                L"BuildingMomo", MB_OK | MB_ICONERROR);
    state.exit_code = 1;
    if (state.window) {
      DestroyWindow(state.window);
    }
  } else {
    // 进入标准 Win32 消息循环
    MSG message{};
    int status = 0;
    while ((status = GetMessageW(&message, nullptr, 0, 0)) > 0) {
      // 捕获前台窗口变化线程消息并刷新 RTSS 限帧状态
      if (!message.hwnd && message.message == desktop::rtss::kForegroundChangedMessage) {
        if (!state.shutting_down) {
          desktop::rtss::refresh_status(state);
        }
        continue;
      }
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    // 消息循环异常退出时标记错误退出码
    if (status == -1) {
      state.exit_code = 1;
    }
  }

  // 释放各子系统资源、释放单实例锁并反初始化 COM 套间
  desktop::shutdown(state);
  desktop::system::release_single_instance_lock(state);
  CoUninitialize();
  return state.exit_code;
}

#include "app.hpp"
#include "system_utils.hpp"

auto WINAPI wWinMain(HINSTANCE instance, HINSTANCE, LPWSTR cmd_line, int show_command) -> int {
  // 1. 单实例互斥检查（需早于提权流程）
  if (!desktop::acquire_single_instance_lock()) {
    desktop::activate_existing_instance();
    return 0;
  }

  // 2. 管理员权限策略（通过数据目录 no_admin 标记文件极速判断）
  bool disable_admin = desktop::has_no_admin_marker();
  if (!disable_admin && !desktop::is_process_elevated()) {
    // 提权前先释放单实例锁，避免提权后的新进程被误判为“已有实例”
    desktop::release_single_instance_lock();

    if (desktop::restart_as_elevated(cmd_line)) {
      // 提权进程已成功启动，当前普通权限进程立即退出
      return 0;
    }

    // 用户在 UAC 弹窗点击“否”或提权失败：重新获取单实例锁后降级在普通权限下继续运行
    if (!desktop::acquire_single_instance_lock()) {
      desktop::activate_existing_instance();
      return 0;
    }
  }

  auto result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  if (FAILED(result)) {
    desktop::release_single_instance_lock();
    MessageBoxW(nullptr, L"无法初始化 COM。", L"BuildingMomo", MB_OK | MB_ICONERROR);
    return 1;
  }

  // state 保持存活直到 CoUninitialize，覆盖异步 WebView2 初始化的退出清理。
  desktop::AppState state;
  state.instance = instance;
  if (auto initialized = desktop::initialize(state, show_command); !initialized) {
    MessageBoxW(state.window, initialized.error().c_str(), L"BuildingMomo", MB_OK | MB_ICONERROR);
    state.exit_code = 1;
    if (state.window) {
      DestroyWindow(state.window);
    }
  } else {
    MSG message{};
    int status = 0;
    while ((status = GetMessageW(&message, nullptr, 0, 0)) > 0) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    if (status == -1) {
      state.exit_code = 1;
    }
  }

  desktop::shutdown(state);
  desktop::release_single_instance_lock();
  CoUninitialize();
  return state.exit_code;
}

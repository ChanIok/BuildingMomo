#include "app.hpp"

auto WINAPI wWinMain(HINSTANCE instance, HINSTANCE, LPWSTR, int show_command) -> int {
  auto result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  if (FAILED(result)) {
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
  CoUninitialize();
  return state.exit_code;
}

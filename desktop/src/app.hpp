#pragma once

#include <windows.h>
#include <objbase.h>
#include <WebView2.h>
#include <wil/com.h>

#include <expected>
#include <string>
#include <string_view>

#include "gpu_priority.hpp"

namespace desktop {

#ifdef BUILDINGMOMO_DESKTOP_DEBUG
inline constexpr std::wstring_view kAppOrigin = L"http://localhost:5173";
#else
inline constexpr std::wstring_view kAppOrigin = L"https://lab.infinitymomo.com";
#endif
inline constexpr UINT kWebViewErrorMessage = WM_APP + 1;

struct AppState {
  HINSTANCE instance = nullptr;
  HWND window = nullptr;
  GpuPriorityState gpu_priority;
  wil::com_ptr<ICoreWebView2Environment> environment;
  wil::com_ptr<ICoreWebView2Controller> controller;
  wil::com_ptr<ICoreWebView2> webview;
  std::wstring user_data_folder;
  std::wstring pending_error;
  bool shutting_down = false;
  int exit_code = 0;
};

auto initialize(AppState& state, int show_command) -> std::expected<void, std::wstring>;
auto shutdown(AppState& state) -> void;
auto report_webview_error(AppState& state, std::wstring_view operation, HRESULT result) -> void;
auto show_pending_error(AppState& state) -> void;

}  // namespace desktop

#pragma once

#include "vendor/std.hpp"

#include "vendor/webview2.hpp"
#include "vendor/wil.hpp"
#include "vendor/windows.hpp"

namespace desktop::gpu_priority {
struct GpuPriorityState;
}

namespace desktop::mcp {
struct McpServerState;
}

namespace desktop::rtss {
struct RtssState;
}

namespace desktop {

struct DesktopConfig {
  bool gpu_realtime_priority = true;
  bool rtss_hang_limit_enabled = false;
  int rtss_hang_limit_fps = 15;
};

struct AppState {
  AppState();
  ~AppState();

  HINSTANCE instance = nullptr;
  HWND window = nullptr;
  wil::unique_handle instance_mutex;
  DesktopConfig config;

  // 子系统由应用统一持有；头文件只前向声明，避免传播 HTTP 等实现依赖。
  std::unique_ptr<gpu_priority::GpuPriorityState> gpu_priority;
  std::unique_ptr<mcp::McpServerState> mcp;
  std::unique_ptr<rtss::RtssState> rtss;

  wil::com_ptr<ICoreWebView2Environment> environment;
  wil::com_ptr<ICoreWebView2Controller> controller;
  wil::com_ptr<ICoreWebView2> webview;
  std::wstring user_data_folder;
  std::string pending_error;
  bool shutting_down = false;
  int exit_code = 0;
};

}  // namespace desktop

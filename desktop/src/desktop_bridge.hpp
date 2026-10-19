#pragma once

#include <windows.h>
#include <objbase.h>
#include <WebView2.h>
#include <wil/com.h>

namespace desktop {

struct DesktopConfig {
  bool gpu_realtime_priority = true;
  bool rtss_hang_limit_enabled = false;
  int rtss_hang_limit_fps = 15;
};

void init_desktop_bridge(ICoreWebView2* webview);
void shutdown_desktop_bridge();
void handle_web_message(const wchar_t* message_json);
void broadcast_desktop_status();
bool is_gpu_realtime_priority_enabled();

}  // namespace desktop

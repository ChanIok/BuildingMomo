#include "desktop_bridge.hpp"

#include <format>
#include <optional>
#include <string>
#include <string_view>

#include "rtss_limiter.hpp"
#include "memory_cleaner.hpp"
#include "system_utils.hpp"
#include "window.hpp"
#include "build_info.h"

namespace desktop {

namespace {

wil::com_ptr<ICoreWebView2> g_webview;
HWND g_window = nullptr;
DesktopConfig g_config{};

std::optional<std::wstring_view> extract_value_raw(std::wstring_view json, std::wstring_view key) {
  auto pos = json.find(key);
  if (pos == std::wstring_view::npos) {
    return std::nullopt;
  }
  pos = json.find(L':', pos + key.size());
  if (pos == std::wstring_view::npos) {
    return std::nullopt;
  }
  pos++;
  while (pos < json.size() && (json[pos] == L' ' || json[pos] == L'\t' || json[pos] == L'\r' ||
                               json[pos] == L'\n')) {
    pos++;
  }
  if (pos >= json.size()) {
    return std::nullopt;
  }
  return json.substr(pos);
}

std::optional<std::wstring> extract_string(std::wstring_view json, std::wstring_view key) {
  auto raw = extract_value_raw(json, key);
  if (!raw || raw->empty() || raw->front() != L'"') {
    return std::nullopt;
  }
  auto end = raw->find(L'"', 1);
  if (end == std::wstring_view::npos) {
    return std::nullopt;
  }
  return std::wstring(raw->substr(1, end - 1));
}

std::optional<bool> extract_bool(std::wstring_view json, std::wstring_view key) {
  auto raw = extract_value_raw(json, key);
  if (!raw) {
    return std::nullopt;
  }
  if (raw->starts_with(L"true")) {
    return true;
  }
  if (raw->starts_with(L"false")) {
    return false;
  }
  return std::nullopt;
}

std::optional<int> extract_int(std::wstring_view json, std::wstring_view key) {
  auto raw = extract_value_raw(json, key);
  if (!raw) {
    return std::nullopt;
  }
  size_t idx = 0;
  bool negative = false;
  if (raw->at(0) == L'-') {
    negative = true;
    idx++;
  }
  int val = 0;
  bool found_digits = false;
  while (idx < raw->size() && raw->at(idx) >= L'0' && raw->at(idx) <= L'9') {
    found_digits = true;
    val = val * 10 + (raw->at(idx) - L'0');
    idx++;
  }
  if (!found_digits) {
    return std::nullopt;
  }
  return negative ? -val : val;
}

// 页面以计算结果字符串下发颜色（如 #181818），只接受 #RRGGBB。
std::optional<COLORREF> extract_color(std::wstring_view json, std::wstring_view key) {
  auto hex = extract_string(json, key);
  if (!hex || hex->size() != 7 || hex->front() != L'#') {
    return std::nullopt;
  }
  unsigned value = 0;
  for (size_t i = 1; i < 7; ++i) {
    const wchar_t digit = hex->at(i);
    if (digit >= L'0' && digit <= L'9') {
      value = value * 16 + static_cast<unsigned>(digit - L'0');
    } else if (digit >= L'a' && digit <= L'f') {
      value = value * 16 + static_cast<unsigned>(digit - L'a') + 10;
    } else if (digit >= L'A' && digit <= L'F') {
      value = value * 16 + static_cast<unsigned>(digit - L'A') + 10;
    } else {
      return std::nullopt;
    }
  }
  return RGB((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF);
}

}  // namespace

void init_desktop_bridge(ICoreWebView2* webview, HWND window) {
  g_webview = webview;
  g_window = window;
  init_rtss_limiter([](const RtssStatus&) {
    broadcast_desktop_status();
  });
}

void shutdown_desktop_bridge() {
  shutdown_rtss_limiter();
  g_webview.reset();
  g_window = nullptr;
}

void broadcast_desktop_status() {
  if (!g_webview) {
    return;
  }
  auto status = get_rtss_status();
  bool is_elevated = is_process_elevated();
  bool run_as_admin = !has_no_admin_marker();
  auto json = std::format(
      LR"({{"type":"desktopStatus","config":{{"gpuRealtimePriority":{},"rtssHangLimitEnabled":{},"rtssHangLimitFps":{}}},"status":{{"isDesktop":true,"isElevated":{},"runAsAdminEnabled":{},"rtssAvailable":{},"gameRunning":{},"gameFocused":{},"isLimiting":{}}},"version":{{"commit":"{}","committedAt":"{}"}}}})",
      g_config.gpu_realtime_priority ? L"true" : L"false",
      g_config.rtss_hang_limit_enabled ? L"true" : L"false",
      g_config.rtss_hang_limit_fps,
      is_elevated ? L"true" : L"false",
      run_as_admin ? L"true" : L"false",
      status.available ? L"true" : L"false",
      status.game_running ? L"true" : L"false",
      status.game_focused ? L"true" : L"false",
      status.is_limiting ? L"true" : L"false",
      BUILDINGMOMO_COMMIT, BUILDINGMOMO_COMMITTED_AT);

  g_webview->PostWebMessageAsJson(json.c_str());
}

void handle_web_message(const wchar_t* message_json) {
  if (!message_json) {
    return;
  }
  std::wstring_view sv(message_json);
  auto type = extract_string(sv, L"type");
  if (!type) {
    return;
  }

  if (type == L"getDesktopConfig") {
    refresh_rtss_status();
    broadcast_desktop_status();
  } else if (type == L"updateDesktopConfig") {
    if (auto gpu = extract_bool(sv, L"gpuRealtimePriority"); gpu.has_value()) {
      g_config.gpu_realtime_priority = *gpu;
    }
    if (auto enabled = extract_bool(sv, L"rtssHangLimitEnabled"); enabled.has_value()) {
      g_config.rtss_hang_limit_enabled = *enabled;
    }
    if (auto fps = extract_int(sv, L"rtssHangLimitFps"); fps.has_value()) {
      g_config.rtss_hang_limit_fps = (*fps > 0) ? *fps : 15;
    }
    update_rtss_config(g_config.rtss_hang_limit_enabled, g_config.rtss_hang_limit_fps);
    broadcast_desktop_status();
  } else if (type == L"cleanMemory") {
    auto target = extract_string(sv, L"target");
    if (!target || !g_webview) {
      return;
    }
    MemoryCleanResult result{};
    if (*target == L"game") {
      result = clean_game_memory();
    } else if (*target == L"editor") {
      result = clean_editor_memory();
    }
    auto json = std::format(
        LR"({{"type":"cleanMemoryResult","target":"{}","success":{},"releasedMb":{},"errorCode":"{}"}})",
        *target,
        result.success ? L"true" : L"false",
        result.released_mb,
        result.error_code);
    g_webview->PostWebMessageAsJson(json.c_str());
  } else if (type == L"setRunAsAdmin") {
    if (auto enabled = extract_bool(sv, L"enabled"); enabled.has_value()) {
      set_no_admin_marker(!(*enabled));
      broadcast_desktop_status();
    }
  } else if (type == L"setWindowAppearance") {
    // 四项必须齐全：页面主题由页面自己解析，宿主不做配色推断。
    const auto dark = extract_bool(sv, L"dark");
    const auto caption = extract_color(sv, L"caption");
    const auto text = extract_color(sv, L"text");
    const auto border = extract_color(sv, L"border");
    if (!g_window || !dark || !caption || !text || !border) {
      return;
    }
    apply_window_appearance(g_window, WindowAppearance{*dark, *caption, *text, *border});
  }
}

bool is_gpu_realtime_priority_enabled() {
  return g_config.gpu_realtime_priority;
}

}  // namespace desktop

#include "desktop_bridge.hpp"

#include "vendor/std.hpp"

#include "app_state.hpp"
#include "build_info.h"
#include "mcp/mcp_server.hpp"
#include "memory_cleaner.hpp"
#include "rtss/rtss_limiter.hpp"
#include "string_utils.hpp"
#include "system_utils.hpp"
#include "webview.hpp"
#include "window.hpp"

namespace desktop::bridge {

namespace {

// 从 JSON 对象中安全提取字符串字段
auto extract_string(const Json& json, std::string_view key) -> std::optional<std::string> {
  const auto found = json.find(key);
  if (found == json.end() || !found->is_string()) {
    return std::nullopt;
  }
  return found->get<std::string>();
}

// 从 JSON 对象中安全提取布尔字段
auto extract_bool(const Json& json, std::string_view key) -> std::optional<bool> {
  const auto found = json.find(key);
  if (found == json.end() || !found->is_boolean()) {
    return std::nullopt;
  }
  return found->get<bool>();
}

// 从 JSON 对象中安全提取 32 位整数字段（含数值越界校验）
auto extract_int(const Json& json, std::string_view key) -> std::optional<int> {
  const auto found = json.find(key);
  if (found == json.end() || !found->is_number_integer() ||
      *found < std::numeric_limits<int>::min() || *found > std::numeric_limits<int>::max()) {
    return std::nullopt;
  }
  return found->get<int>();
}

// 解析 #RRGGBB 格式的十六进制颜色字符串为 Win32 COLORREF 结构
auto extract_color(const Json& json, std::string_view key) -> std::optional<COLORREF> {
  const auto hex = extract_string(json, key);
  // 严格要求 # 加上 6 位 16 进制字符
  if (!hex || hex->size() != 7 || hex->front() != '#') {
    return std::nullopt;
  }
  unsigned value = 0;
  for (size_t i = 1; i < 7; ++i) {
    const auto digit = (*hex)[i];
    if (digit >= '0' && digit <= '9') {
      value = value * 16 + static_cast<unsigned>(digit - '0');
    } else if (digit >= 'a' && digit <= 'f') {
      value = value * 16 + static_cast<unsigned>(digit - 'a') + 10;
    } else if (digit >= 'A' && digit <= 'F') {
      value = value * 16 + static_cast<unsigned>(digit - 'A') + 10;
    } else {
      return std::nullopt;
    }
  }
  // 提取 RGB 各通道分量
  return RGB((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF);
}

// 解析前端下发的桌面配置，刷新限帧状态并向前端广播最新状态
auto update_config(AppState& state, const Json& message) -> void {
  // 更新 GPU 调度优先级配置
  if (const auto gpu = extract_bool(message, "gpuRealtimePriority")) {
    state.config.gpu_realtime_priority = *gpu;
  }
  // 更新后台挂机限帧开关
  if (const auto enabled = extract_bool(message, "rtssHangLimitEnabled")) {
    state.config.rtss_hang_limit_enabled = *enabled;
  }
  // 更新后台限帧目标 FPS 数值
  if (const auto fps = extract_int(message, "rtssHangLimitFps")) {
    state.config.rtss_hang_limit_fps = *fps > 0 ? *fps : 15;
  }
  // 触发限帧策略评估并同步广播最新状态
  rtss::refresh_status(state);
  broadcast_status(state);
}

// 根据目标类型清理游戏或编辑器的内存工作集，并将释放结果回传给前端
auto clean_memory(AppState& state, const Json& message) -> void {
  const auto target = extract_string(message, "target");
  // 过滤无效请求或非受支持的目标
  if (!target || !state.webview || (*target != "game" && *target != "editor")) {
    return;
  }
  // 执行物理内存裁减
  const auto result =
      *target == "game" ? memory::clean_game_memory() : memory::clean_editor_memory();
  // 向前端回传释放结果与释放量
  send_message(state, {{"type", "cleanMemoryResult"},
                       {"target", *target},
                       {"success", result.success},
                       {"releasedMb", result.released_mb},
                       {"errorCode", result.error_code}});
}

// 解析前端下发的标题栏样式参数并调用 DWM 接口应用到主窗口
auto set_window_appearance(AppState& state, const Json& message) -> void {
  // 四项必须齐全：页面主题由页面自己解析，宿主不做配色推断。
  const auto dark = extract_bool(message, "dark");
  const auto caption = extract_color(message, "caption");
  const auto text = extract_color(message, "text");
  const auto border = extract_color(message, "border");
  // 缺少任意一项或窗口无效时拒绝应用
  if (!state.window || !dark || !caption || !text || !border) {
    return;
  }
  // 应用窗口视觉样式
  window::apply_appearance(state.window, {*dark, *caption, *text, *border});
}

}  // namespace

// 校验页面来源并将 JSON 序列化消息投递给受信任的前端 WebView 页面
auto send_message(AppState& state, const Json& message) -> void {
  // 正在退出或 WebView 尚未创建时不发送
  if (!state.webview || state.shutting_down) {
    return;
  }
  // 仅在当前页面匹配受信任应用来源时投递消息
  wil::unique_cotaskmem_string source;
  if (FAILED(state.webview->get_Source(source.put())) || !source ||
      !webview::is_app_url(source.get())) {
    return;
  }
  // 序列化为 UTF-16 并投递给页面
  const auto json = string::from_utf8(message.dump());
  state.webview->PostWebMessageAsJson(json.c_str());
}

// 汇总桌面运行配置、RTSS 限帧情况、系统权限和版本构建信息广播给前端
auto broadcast_status(AppState& state) -> void {
  // 获取最新 RTSS 状态快照
  const auto status = rtss::get_status(state);
  // 向前端页面发送聚合状态消息
  send_message(state, {{"type", "desktopStatus"},
                       {"aiProtocol", 1},
                       {"config",
                        {{"gpuRealtimePriority", state.config.gpu_realtime_priority},
                         {"rtssHangLimitEnabled", state.config.rtss_hang_limit_enabled},
                         {"rtssHangLimitFps", state.config.rtss_hang_limit_fps}}},
                       {"status",
                        {{"isDesktop", true},
                         {"isElevated", system::is_process_elevated()},
                         {"runAsAdminEnabled", !system::has_no_admin_marker()},
                         {"rtssAvailable", status.available},
                         {"gameRunning", status.game_running},
                         {"gameFocused", status.game_focused},
                         {"isLimiting", status.is_limiting}}},
                       {"version",
                        {{"commit", string::to_utf8(BUILDINGMOMO_COMMIT)},
                         {"committedAt", string::to_utf8(BUILDINGMOMO_COMMITTED_AT)}}}});
}

// 解析前端发来的 WebMessage 并分流至 MCP、配置管理、内存清理或外观模块
auto handle_message(AppState& state, std::wstring_view message_json) -> void {
  // 解析 JSON 文本
  const auto message = Json::parse(string::to_utf8(message_json), nullptr, false);
  if (message.is_discarded() || !message.is_object()) {
    return;
  }
  try {
    const auto type = extract_string(message, "type");
    if (!type) {
      return;
    }
    // 根据消息类型分发各子系统处理逻辑
    if (type->starts_with("mcp")) {
      mcp::handle_message(state, message);
    } else if (type == "getDesktopConfig") {
      rtss::refresh_status(state);
      broadcast_status(state);
    } else if (type == "updateDesktopConfig") {
      update_config(state, message);
    } else if (type == "cleanMemory") {
      clean_memory(state, message);
    } else if (type == "setRunAsAdmin") {
      // 切换是否以管理员身份运行
      if (const auto enabled = extract_bool(message, "enabled")) {
        system::set_no_admin_marker(!*enabled);
        broadcast_status(state);
      }
    } else if (type == "setWindowAppearance") {
      set_window_appearance(state, message);
    }
  } catch (const Json::exception&) {
    // 拒绝类型不符的字段，不让 JSON 异常穿过 WebView2 的 COM 回调边界。
  }
}

}  // namespace desktop::bridge

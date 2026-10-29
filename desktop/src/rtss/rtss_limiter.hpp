#pragma once

#include "vendor/std.hpp"

#include "vendor/windows.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::rtss {

inline constexpr UINT kForegroundChangedMessage = WM_APP + 2;
inline constexpr UINT_PTR kHeartbeatTimer = 1;

struct RtssStatus {
  bool available = false;
  bool game_running = false;
  bool game_focused = false;
  bool is_limiting = false;
};

// 仅在 UI 线程调用；前台事件由主消息循环接回当前 AppState。

// 初始化 RTSS 状态监视：加载 API → 注册前台窗口切换钩子 → 启动心跳定时器
auto initialize(AppState& state, std::function<void(const RtssStatus&)> status_callback) -> void;
// 停止 RTSS 监视：销毁定时器 → 卸载事件钩子 → 恢复帧率限制 → 卸载 DLL
auto shutdown(AppState& state) -> void;
// 检查游戏焦点与运行状态，按需切换后台限帧并触发状态回调
auto refresh_status(AppState& state) -> void;
// 获取当前 RTSS 状态快照
auto get_status(const AppState& state) -> RtssStatus;

}  // namespace desktop::rtss

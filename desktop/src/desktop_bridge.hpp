#pragma once

#include "vendor/std.hpp"

#include "json.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::bridge {

// 仅在 UI 线程调用；只向当前受信任页面发送消息。

// 向前端受信任页面异步投递 JSON 消息
auto send_message(AppState& state, const Json& message) -> void;
// 聚合桌面配置、权限、RTSS 与版本信息广播给前端
auto broadcast_status(AppState& state) -> void;
// 解析并分发前端通过 WebMessage 发送给宿主的指令
auto handle_message(AppState& state, std::wstring_view message_json) -> void;

}  // namespace desktop::bridge

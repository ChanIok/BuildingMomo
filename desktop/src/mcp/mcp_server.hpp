#pragma once

#include "vendor/std.hpp"

#include "vendor/windows.hpp"

#include "json.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::mcp {

inline constexpr UINT kDispatchMessage = WM_APP + 3;

// 以下入口均在 UI 线程调用；send 也只会在 UI 线程执行。

// 注册向前端 WebView 投递 MCP 消息的通信回调
auto initialize(AppState& state, std::function<void(const Json&)> send) -> void;
// 停止 MCP 服务：拒绝所有待响应请求 → 停止 HTTP Server → 等待监听线程退出
auto shutdown(AppState& state) -> void;
// 页面重载或切换时重置 MCP 会话与授权状态
auto reset_page(AppState& state) -> void;
// 将 outbox 队列中的待发送请求在 UI 线程分发给前端页面
auto dispatch_messages(AppState& state) -> void;
// 处理前端回传的握手、配置修改或工具调用结果响应
auto handle_message(AppState& state, const Json& message) -> void;

}  // namespace desktop::mcp

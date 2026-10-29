#pragma once

#include "vendor/std.hpp"

#include "json.hpp"

namespace httplib {
class Server;
}

namespace desktop::mcp {

struct PendingRequest {
  std::condition_variable changed;
  std::optional<Json> response;
  std::string epoch;
  Json rpc_id = nullptr;
};

struct McpServerState {
  McpServerState();
  ~McpServerState();

  // 仅由 UI 线程设置和调用；HTTP 工作线程通过 outbox 投递消息，不接触 WebView。
  std::function<void(const Json&)> send;
  std::unique_ptr<httplib::Server> server;
  std::thread listener;
  std::string error;
  int port = 50725;

  // mutex 保护下面的共享数据及 PendingRequest 的字段。
  // UI 线程负责会话切换，必须先停止并等待旧服务退出，再更改 epoch / allowed。
  std::mutex mutex;
  std::unordered_map<std::string, std::shared_ptr<PendingRequest>> pending;
  std::deque<Json> outbox;
  // 页面每次握手生成新 epoch，旧页面响应不得完成新页面的请求。
  std::string epoch;
  bool allowed = false;
  bool enabled = false;
  std::uint64_t next_request = 0;
};

}  // namespace desktop::mcp

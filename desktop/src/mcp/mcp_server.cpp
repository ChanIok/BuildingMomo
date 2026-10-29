#include "mcp/mcp_server.hpp"

#include "vendor/std.hpp"

#include "vendor/httplib.hpp"

#include "app_state.hpp"
#include "mcp/state.hpp"

namespace desktop::mcp {

McpServerState::McpServerState() = default;
McpServerState::~McpServerState() = default;

namespace {

constexpr int kProtocol = 1;

// 构造标准 JSON-RPC 2.0 错误响应对象
auto rpc_error(int code, const char* text, const Json& id = nullptr) -> Json {
  return {{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", code}, {"message", text}}}};
}

// 向前端页面推送当前 MCP 服务的状态快照
auto publish_status(AppState& state) -> void {
  const auto& mcp = *state.mcp;
  // 通过 send 通道向前端下发当前配置与运行状态
  if (mcp.send) {
    mcp.send({{"type", "mcpStatus"},
              {"protocol", kProtocol},
              {"epoch", mcp.epoch},
              {"enabled", mcp.enabled},
              {"port", mcp.port},
              {"error", mcp.error}});
  }
}

// 停止 HTTP 服务：标记停用 → 拒绝待决请求 → 停止 Server → 等待监听线程退出
auto stop_server(AppState& state) -> void {
  auto& mcp = *state.mcp;
  {
    std::lock_guard lock(mcp.mutex);
    // 标记禁用并清空出站消息队列
    mcp.enabled = false;
    mcp.outbox.clear();
    // 先唤醒等待页面响应的 HTTP 工作线程，再停止服务并等待监听线程退出。
    for (auto& [id, pending] : mcp.pending) {
      pending->response = {
          {"status", 503},
          {"body", rpc_error(-32000, "Editor connection closed; do not replay edits automatically.",
                             pending->rpc_id)}};
      pending->changed.notify_all();
    }
  }
  // 请求 HTTP 服务端停止接收新连接
  if (mcp.server) {
    mcp.server->stop();
  }
  // 等待后台监听工作线程安全结束
  if (mcp.listener.joinable()) {
    mcp.listener.join();
  }
  // 释放服务端对象
  mcp.server.reset();
}

// 校验 HTTP 请求来源安全性与协议规范头部（Host/Origin/Method/Content-Type/Accept）
auto validate_http_request(const httplib::Request& request, httplib::Response& response, int port)
    -> bool {
  response.set_header("Cache-Control", "no-store");
  const auto authority = "127.0.0.1:" + std::to_string(port);
  const auto localhost = "localhost:" + std::to_string(port);
  const auto host = request.get_header_value("Host");
  const auto origin = request.get_header_value("Origin");
  // 仅允许来自本机的 Host 与 Origin 访问，防止跨站请求伪造
  if ((host != authority && host != localhost) ||
      (!origin.empty() && origin != "http://" + authority && origin != "http://" + localhost)) {
    response.status = 403;
    return false;
  }
  // MCP Streamable HTTP 传输仅接收 POST 请求
  if (request.method != "POST") {
    response.status = 405;
    response.set_header("Allow", "POST");
    return false;
  }
  // 校验请求体编码格式必须为 JSON
  if (!request.get_header_value("Content-Type").starts_with("application/json")) {
    response.status = 415;
    return false;
  }
  // 客户端必须同时声明支持 JSON 与 SSE 双重媒体类型
  const auto accept = request.get_header_value("Accept");
  if (accept.find("application/json") == std::string::npos ||
      accept.find("text/event-stream") == std::string::npos) {
    response.status = 406;
    return false;
  }
  return true;
}

// 将 HTTP 请求封装为 MCP 消息推入 outbox，并阻塞等待前端页面返回或超时
auto forward_request(AppState& state, const httplib::Request& request, const Json& body) -> Json {
  auto& mcp = *state.mcp;
  // 创建挂起请求同步原语
  auto pending = std::make_shared<PendingRequest>();
  // 提取 JSON-RPC 消息 id
  if (body.is_object() && body.contains("id") &&
      (body["id"].is_string() || body["id"].is_number())) {
    pending->rpc_id = body["id"];
  }

  std::unique_lock lock(mcp.mutex);
  // 服务未就绪或未被前端授权时直接拒绝
  if (!mcp.enabled || !mcp.allowed || mcp.epoch.empty()) {
    return {{"status", 503}, {"body", rpc_error(-32000, "Editor is not ready")}};
  }
  // 分配唯一请求序号并绑定当前页面 epoch
  pending->epoch = mcp.epoch;
  const auto id = std::to_string(++mcp.next_request);
  mcp.pending.emplace(id, pending);
  // 将请求压入出站队列并触发 UI 线程派发
  mcp.outbox.push_back({{"type", "mcpRequest"},
                        {"protocol", kProtocol},
                        {"epoch", mcp.epoch},
                        {"requestId", id},
                        {"request",
                         {{"body", body},
                          {"protocolVersion", request.get_header_value("MCP-Protocol-Version")},
                          {"methodHeader", request.get_header_value("Mcp-Method")},
                          {"nameHeader", request.get_header_value("Mcp-Name")}}}});
  PostMessageW(state.window, kDispatchMessage, 0, 0);

  // 轮询等待前端页面返回响应或连接断开/超时（最长 60 秒）
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
  while (!pending->response) {
    pending->changed.wait_for(lock, std::chrono::milliseconds(100));
    if (pending->response) {
      break;
    }
    // 客户端提前断开连接或等待超时，向页面发送取消消息并返回 504
    if (request.is_connection_closed() || std::chrono::steady_clock::now() >= deadline) {
      // 取消只针对本次转发；已经完成的编辑由页面保留，宿主不自动重放请求。
      mcp.outbox.push_back({{"type", "mcpCancel"},
                            {"protocol", kProtocol},
                            {"epoch", pending->epoch},
                            {"requestId", id}});
      PostMessageW(state.window, kDispatchMessage, 0, 0);
      pending->response = {
          {"status", 504},
          {"body",
           rpc_error(-32000,
                     "Execution timed out or disconnected; inspect history before retrying.",
                     pending->rpc_id)}};
    }
  }
  // 提取响应并清理挂起请求记录
  auto response = std::move(*pending->response);
  mcp.pending.erase(id);
  return response;
}

// 处理单个 HTTP 请求：校验请求格式 → 转发给前端 → 写入 HTTP 响应
auto handle_http_request(AppState& state, const httplib::Request& request,
                         httplib::Response& response, int port) -> void {
  // 安全与协议规范校验
  if (!validate_http_request(request, response, port)) {
    return;
  }
  // 解析 JSON 请求体
  const auto body = Json::parse(request.body, nullptr, false);
  if (body.is_discarded()) {
    response.status = 400;
    response.set_content(rpc_error(-32700, "Invalid JSON").dump(), "application/json");
    return;
  }
  // 转发给前端并同步获取执行结果
  const auto result = forward_request(state, request, body);
  response.status = result.value("status", 500);
  if (result.contains("body")) {
    response.set_content(result["body"].dump(), "application/json");
  }
}

// 启动 HTTP MCP 服务：重置旧服务 → 绑定端口 → 启动监听线程并等待就绪
auto start_server(AppState& state, int port) -> void {
  // 停止已存在的服务实例
  stop_server(state);
  auto& mcp = *state.mcp;
  mcp.port = port;
  mcp.error.clear();
  // 创建并配置 HTTP 服务器参数
  auto server = std::make_unique<httplib::Server>();
  server->set_payload_max_length(1024 * 1024);
  server->set_read_timeout(10, 0);
  server->set_write_timeout(15, 0);
  const auto handler = [&state, port](const httplib::Request& request,
                                      httplib::Response& response) -> void {
    handle_http_request(state, request, response, port);
  };
  server->Post("/mcp", handler);
  server->Get("/mcp", handler);
  server->Delete("/mcp", handler);
  // 绑定回环地址指定端口
  if (!server->bind_to_port("127.0.0.1", port)) {
    mcp.error = "bind_failed";
    publish_status(state);
    return;
  }
  // 标记服务启用状态
  {
    std::lock_guard lock(mcp.mutex);
    mcp.enabled = true;
  }
  mcp.server = std::move(server);
  auto* listener = mcp.server.get();
  const auto epoch = mcp.epoch;
  // 启动后台监听工作线程
  mcp.listener = std::thread([&state, listener, epoch] -> void {
    if (!listener->listen_after_bind()) {
      // 监听异常退出时通知主循环
      auto& mcp = *state.mcp;
      std::lock_guard lock(mcp.mutex);
      if (mcp.enabled && mcp.epoch == epoch) {
        mcp.outbox.push_back({{"type", "mcpServiceFailed"}, {"epoch", epoch}});
        PostMessageW(state.window, kDispatchMessage, 0, 0);
      }
    }
  });
  // httplib::stop 只停止已进入监听循环的服务；发布状态前等待就绪，避免立即关闭时卡在 join。
  listener->wait_until_ready();
  publish_status(state);
}

// 校验前端下发的 MCP 配置参数并启动或停用服务
auto configure_server(AppState& state, const Json& message) -> void {
  auto& mcp = *state.mcp;
  // 前端请求关闭服务
  if (!message.value("enabled", false)) {
    stop_server(state);
    mcp.error.clear();
    publish_status(state);
    return;
  }
  // 检查前端是否已被授予 MCP 操作权限
  if (!mcp.allowed) {
    mcp.error = "not_allowed";
    publish_status(state);
    return;
  }
  // 校验绑定端口是否在合法范围内
  const auto port = message.value("port", 0);
  if (port < 1024 || port > 65535) {
    mcp.error = "invalid_port";
    publish_status(state);
    return;
  }
  // 启动服务实例
  start_server(state, port);
}

// 接收前端对指定 requestId 的执行结果并唤醒挂起的 HTTP 线程
auto receive_response(AppState& state, const Json& message) -> void {
  // 校验响应消息格式
  if (!message.contains("response") || !message["response"].is_object()) {
    return;
  }
  const auto& response = message["response"];
  if (!response.contains("status") || !response["status"].is_number_integer()) {
    return;
  }
  const auto status = response["status"].get<int>();
  if (status < 200 || status > 599) {
    return;
  }
  auto& mcp = *state.mcp;
  std::lock_guard lock(mcp.mutex);
  // 按 requestId 和 epoch 匹配对应的挂起请求
  const auto found = mcp.pending.find(message.value("requestId", ""));
  if (found != mcp.pending.end() && found->second->epoch == mcp.epoch && !found->second->response) {
    // 写入响应并通知等待线程
    found->second->response = response;
    found->second->changed.notify_all();
  }
}

}  // namespace

// 初始化 MCP 模块并设置向前端页面投递消息的管道回调
auto initialize(AppState& state, std::function<void(const Json&)> send) -> void {
  state.mcp->send = std::move(send);
}

// 停用并退出 MCP 服务并清理前端通信回调
auto shutdown(AppState& state) -> void {
  stop_server(state);
  state.mcp->send = {};
}

// 页面重置或卸载时重置 MCP 状态：停止服务并清空当前 epoch 与授权
auto reset_page(AppState& state) -> void {
  stop_server(state);
  auto& mcp = *state.mcp;
  std::lock_guard lock(mcp.mutex);
  mcp.allowed = false;
  mcp.epoch.clear();
}

// 从出站消息队列取出待派发消息并在 UI 线程统一投递给前端
auto dispatch_messages(AppState& state) -> void {
  auto& mcp = *state.mcp;
  std::deque<Json> messages;
  // 加锁原子置换出站消息队列
  {
    std::lock_guard lock(mcp.mutex);
    messages.swap(mcp.outbox);
  }
  // 逐一派发有效消息
  for (const auto& message : messages) {
    // 处理后台服务监听故障通知
    if (message.value("type", "") == "mcpServiceFailed") {
      if (mcp.enabled && message.value("epoch", "") == mcp.epoch) {
        stop_server(state);
        mcp.error = "listen_failed";
        publish_status(state);
      }
      continue;
    }
    // 检查消息对应的会话 epoch 与请求是否依然有效
    bool valid = false;
    {
      std::lock_guard lock(mcp.mutex);
      const auto id = message.value("requestId", "");
      valid = mcp.enabled && message.value("epoch", "") == mcp.epoch &&
              (message.value("type", "") == "mcpCancel" || mcp.pending.contains(id));
    }
    // 投递给前端页面
    if (valid && mcp.send) {
      mcp.send(message);
    }
  }
}

// 接收前端页面发来的 MCP 控制消息（握手握定、配置变更或执行结果）
auto handle_message(AppState& state, const Json& message) -> void {
  auto& mcp = *state.mcp;
  const auto type = message.value("type", "");
  // 处理页面初始握手消息
  if (type == "mcpHello") {
    reset_page(state);
    if (message.value("protocol", 0) != kProtocol || !message.contains("epoch") ||
        !message["epoch"].is_string()) {
      return;
    }
    // 记录握手会话 epoch 与授权标记
    {
      std::lock_guard lock(mcp.mutex);
      mcp.epoch = message["epoch"].get<std::string>();
      mcp.allowed = message.value("allowed", false);
    }
    mcp.error.clear();
    publish_status(state);
    return;
  }
  // 忽略协议不符或旧页面的过期消息
  if (message.value("protocol", 0) != kProtocol || message.value("epoch", "") != mcp.epoch ||
      mcp.epoch.empty()) {
    return;
  }
  // 按消息类型分发业务处理
  if (type == "mcpConfigure") {
    configure_server(state, message);
  } else if (type == "mcpResponse") {
    receive_response(state, message);
  }
}

}  // namespace desktop::mcp

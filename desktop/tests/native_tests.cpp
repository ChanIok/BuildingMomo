#include "vendor/std.hpp"

#include "vendor/httplib.hpp"

#include "app_state.hpp"
#include "mcp/mcp_server.hpp"
#include "mcp/state.hpp"
#include "rtss/rtss_limiter.hpp"
#include "rtss/state.hpp"
#include "string_utils.hpp"

namespace {

using desktop::AppState;
using desktop::Json;
namespace mcp = desktop::mcp;
using namespace std::chrono_literals;

// 校验测试断言条件，不满足时抛出异常
auto require(bool condition, std::string_view message) -> void {
  // 断言失败抛出异常中断测试
  if (!condition) {
    throw std::runtime_error(std::string(message));
  }
}

// 模拟前端向宿主发送 mcpHello 握手报文
auto handshake(AppState& state, std::string_view epoch, bool allowed = true) -> void {
  // 向 MCP 模块投递握手测试消息
  mcp::handle_message(
      state, {{"type", "mcpHello"}, {"protocol", 1}, {"epoch", epoch}, {"allowed", allowed}});
}

// 模拟前端向宿主发送 mcpConfigure 服务启停及端口配置报文
auto configure(AppState& state, std::string_view epoch, bool enabled, int port) -> void {
  // 向 MCP 模块投递配置更新测试消息
  mcp::handle_message(state, {{"type", "mcpConfigure"},
                              {"protocol", 1},
                              {"epoch", epoch},
                              {"enabled", enabled},
                              {"port", port}});
}

// 动态绑定并释放一个空闲的本地回环测试端口
auto available_port() -> int {
  httplib::Server reservation;
  // 绑定回环随机端口
  const auto port = reservation.bind_to_any_port("127.0.0.1");
  require(port >= 1024, "reserve an ephemeral loopback port");
  // httplib::stop 只关闭已进入监听循环的 socket，不能直接释放仅 bind 的端口。
  std::thread listener([&] { reservation.listen_after_bind(); });
  reservation.wait_until_ready();
  // 关闭临时监听以让出端口
  reservation.stop();
  listener.join();
  return port;
}

// 轮询驱动 UI 消息派发并等待测试断言条件满足（最多等待 5 秒）
auto wait_until(AppState& state, const std::function<bool()>& predicate) -> void {
  const auto deadline = std::chrono::steady_clock::now() + 5s;
  // 持续分发消息直到条件成立
  while (!predicate()) {
    mcp::dispatch_messages(state);
    require(std::chrono::steady_clock::now() < deadline, "UI dispatch timed out");
    std::this_thread::sleep_for(5ms);
  }
}

// 构造携带 MCP 规范请求头的 HTTP POST 测试请求
auto post(httplib::Client& client, const Json& body) -> httplib::Result {
  // 发送 POST 请求并携带 Accept 与 MCP 协议元信息头
  return client.Post("/mcp",
                     {{"Accept", "application/json, text/event-stream"},
                      {"MCP-Protocol-Version", "2025-11-25"},
                      {"Mcp-Method", "tools/list"}},
                     body.dump(), "application/json");
}

// 验证 UTF-8 与 UTF-16 互转的一致性及畸变编码拒收逻辑
auto test_strings() -> void {
  const auto text = std::string("中文与 emoji 🐱");
  // 正常 UTF-8 双向转换回环
  require(desktop::string::to_utf8(desktop::string::from_utf8(text)) == text, "UTF-8 round trip");
  // 空字符串边界
  require(desktop::string::to_utf8(L"").empty(), "empty UTF-16");
  require(desktop::string::from_utf8("").empty(), "empty UTF-8");
  // 非法 UTF-8 字节序拒绝
  require(desktop::string::from_utf8("\xFF").empty(), "reject invalid UTF-8");
  // 单独未成对的 UTF-16 代理项拒绝
  require(desktop::string::to_utf8(std::wstring(1, L'\xD800')).empty(),
          "reject unpaired UTF-16 surrogate");
}

// 验证 RTSS 状态回调在限帧状态切换时的派发机制与去重特性
auto test_rtss_status() -> void {
  AppState state;
  // 获取初态
  desktop::rtss::refresh_status(state);
  state.rtss->status.is_limiting = true;
  int notifications = 0;
  // 注册状态监听回调并验证限帧状态被恢复
  state.rtss->status_callback = [&](const desktop::rtss::RtssStatus& status) {
    require(!status.is_limiting, "disabled config clears the limit");
    ++notifications;
  };
  // 不加载 RTSS DLL，只验证其他状态未变时，限帧状态变化仍会通知页面。
  desktop::rtss::refresh_status(state);
  require(notifications == 1, "limit-only status change must notify");
  // 状态未发生变化时不重复触发通知
  desktop::rtss::refresh_status(state);
  require(notifications == 1, "unchanged status must not notify twice");
  // 验证多次 shutdown 幂等性
  desktop::rtss::shutdown(state);
  desktop::rtss::shutdown(state);
}

// 测试 MCP 传输全流程：握手 → 端口校验 → 认证拦截 → 消息转发 → 会话隔离 → 异常取消 → 安全关闭
auto test_transport() -> void {
  AppState state;
  AppState other;
  std::vector<Json> sent;
  const auto ui_thread = GetCurrentThreadId();
  // 绑定测试发送回调，断言其在 UI 线程执行
  mcp::initialize(state, [&](const Json& message) {
    require(GetCurrentThreadId() == ui_thread, "send must run on the UI thread");
    sent.push_back(message);
  });

  // 异常路径也必须先退出服务，避免 joinable 的监听线程进入析构。
  try {
    // 初始状态服务处于停用状态
    require(!state.mcp->enabled && state.mcp->port == 50725, "service starts disabled");
    // 测试握手保留页面协议
    handshake(state, "page-a");
    require(sent.back() == Json{{"type", "mcpStatus"},
                                {"protocol", 1},
                                {"epoch", "page-a"},
                                {"enabled", false},
                                {"port", 50725},
                                {"error", ""}},
            "handshake preserves the page protocol");
    // 拒绝非法端口号配置
    configure(state, "page-a", true, 12);
    require(sent.back()["error"] == "invalid_port", "reject invalid port");
    // 拒绝未授权开启
    handshake(state, "page-a", false);
    configure(state, "page-a", true, 50725);
    require(sent.back()["error"] == "not_allowed", "reject unauthorized enable");

    // 授权并成功启动服务
    handshake(state, "page-a");
    const auto port = available_port();
    configure(state, "page-a", true, port);
    require(state.mcp->enabled && sent.back()["enabled"] == true, "enable service");
    require(state.mcp->server->is_running(), "enabled service is ready to stop");
    // 测试立即停用并回收监听线程
    configure(state, "page-a", false, port);
    require(!state.mcp->enabled && !state.mcp->listener.joinable(),
            "immediate disable joins the listener");
    // 重新开启服务并验证 AppState 会话隔离
    configure(state, "page-a", true, port);
    handshake(other, "other-page", false);
    require(state.mcp->enabled && state.mcp->epoch == "page-a", "AppState isolates sessions");

    // 针对 HTTP 客户端的边界校验拦截测试
    httplib::Client client("127.0.0.1", port);
    client.set_read_timeout(5, 0);
    client.set_connection_timeout(2, 0);
    // 拦截外站跨域 Origin 请求
    const auto forbidden =
        client.Post("/mcp", {{"Origin", "https://untrusted.example"}}, "{}", "application/json");
    require(forbidden && forbidden->status == 403,
            "reject foreign Origin: " + (forbidden ? std::to_string(forbidden->status)
                                                   : httplib::to_string(forbidden.error())));
    // 拦截伪造 Host 请求
    const auto wrong_host =
        client.Post("/mcp", {{"Host", "untrusted.example"}}, "{}", "application/json");
    require(wrong_host && wrong_host->status == 403, "reject foreign Host");
    // 拒绝非 POST 方法
    const auto get = client.Get("/mcp");
    require(get && get->status == 405 && get->get_header_value("Allow") == "POST", "reject GET");
    // 拒绝非 JSON 格式 Content-Type
    const auto content_type = client.Post("/mcp", "{}", "text/plain");
    require(content_type && content_type->status == 415, "reject wrong Content-Type");
    // 必须同时请求 json 与 sse 媒体类型
    const auto accept = client.Post("/mcp", "{}", "application/json");
    require(accept && accept->status == 406, "require both response media types");
    // 拒绝格式畸变的无效 JSON 数据
    const auto malformed = client.Post("/mcp", {{"Accept", "application/json, text/event-stream"}},
                                       "{", "application/json");
    require(malformed && malformed->status == 400 &&
                Json::parse(malformed->body)["error"]["code"] == -32700,
            "reject malformed JSON");

    // 正常异步请求转发至 UI 派发测试
    const Json body{{"jsonrpc", "2.0"}, {"id", "rpc-id"}, {"method", "tools/list"}};
    sent.clear();
    auto response = std::async(std::launch::async, [&] { return post(client, body); });
    wait_until(state, [&] { return !sent.empty(); });
    const auto request = sent.back();
    require(request["type"] == "mcpRequest" && request["epoch"] == "page-a" &&
                request["request"]["body"] == body &&
                request["request"]["protocolVersion"] == "2025-11-25" &&
                request["request"]["methodHeader"] == "tools/list",
            "forward body and metadata unchanged");
    const Json result{
        {"status", 200},
        {"body", {{"jsonrpc", "2.0"}, {"id", "rpc-id"}, {"result", {{"tools", Json::array()}}}}}};
    // 模拟来自旧页面的过期响应，验证被忽略
    Json reply{{"type", "mcpResponse"},
               {"protocol", 1},
               {"epoch", "stale-page"},
               {"requestId", request["requestId"]},
               {"response", result}};
    mcp::handle_message(state, reply);
    {
      std::lock_guard lock(state.mcp->mutex);
      require(!state.mcp->pending.at(request["requestId"].get<std::string>())->response,
              "ignore stale page response");
    }
    // 正确 epoch 回应，验证 HTTP 客户端收到正确结果
    reply["epoch"] = "page-a";
    mcp::handle_message(state, reply);
    const auto received = response.get();
    require(received && received->status == 200 && Json::parse(received->body) == result["body"],
            "return the page response");

    // 测试新握手重置页面时唤醒并拒绝旧会话未决请求
    sent.clear();
    auto closed = std::async(std::launch::async, [&] { return post(client, body); });
    wait_until(state, [&] { return !sent.empty(); });
    const auto closed_id = sent.back()["requestId"];
    handshake(state, "page-b");
    const auto closed_result = closed.get();
    require(closed_result && closed_result->status == 503 &&
                Json::parse(closed_result->body)["id"] == "rpc-id",
            "page reset wakes pending HTTP requests");
    require(!state.mcp->enabled && state.mcp->pending.empty() && state.mcp->outbox.empty(),
            "reset drains old transport work before changing epoch");

    // 测试客户端异常断开连接时向页面发送 mcpCancel 取消通知
    configure(state, "page-b", true, port);
    sent.clear();
    auto disconnected = std::async(std::launch::async, [&] { return post(client, body); });
    wait_until(state, [&] { return !sent.empty(); });
    require(sent.back()["requestId"] != closed_id, "request allocator survives page reset");
    const auto disconnected_id = sent.back()["requestId"];
    client.stop();
    disconnected.get();
    wait_until(state, [&] { return sent.back()["type"] == "mcpCancel"; });
    require(sent.back()["requestId"] == disconnected_id && sent.back()["epoch"] == "page-b",
            "disconnect cancels only its forwarded request");

    // 测试应用 shutdown 时安全唤醒所有工作线程并等待服务退出
    sent.clear();
    httplib::Client last_client("127.0.0.1", port);
    last_client.set_read_timeout(5, 0);
    auto stopping = std::async(std::launch::async, [&] { return post(last_client, body); });
    wait_until(state, [&] { return !sent.empty(); });
    mcp::shutdown(state);
    const auto stopped = stopping.get();
    require(stopped && stopped->status == 503 && !state.mcp->listener.joinable() &&
                state.mcp->pending.empty() && !state.mcp->send,
            "shutdown wakes workers and joins the listener before releasing state");
    mcp::shutdown(state);
  } catch (...) {
    mcp::shutdown(state);
    throw;
  }
}

}  // namespace

// 原生测试执行入口：顺序执行测试套件并输出测试结论
auto main() -> int {
  try {
    // 执行字符串编码转换、RTSS 状态及 MCP 传输测试
    test_strings();
    test_rtss_status();
    test_transport();
    std::puts(
        "PASS: UTF conversion, isolated state, MCP HTTP forwarding/reset/disconnect/shutdown");
    return 0;
  } catch (const std::exception& error) {
    // 捕获测试异常并打印错误信息
    std::fprintf(stderr, "FAIL: %s\n", error.what());
    return 1;
  }
}

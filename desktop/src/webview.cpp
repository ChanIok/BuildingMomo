#include "webview.hpp"

#include "vendor/std.hpp"

#include "vendor/webview2.hpp"
#include "vendor/wil.hpp"
#include "vendor/windows.hpp"
#include "vendor/windows/shellapi.hpp"
#include "vendor/windows/shlobj.hpp"
#include "vendor/windows/wrl.hpp"

#include "app.hpp"
#include "app_state.hpp"
#include "desktop_bridge.hpp"
#include "gpu_priority/gpu_priority.hpp"
#include "mcp/mcp_server.hpp"

namespace desktop::webview {

namespace {

// 校验协议并调用系统默认浏览器打开外部网页
auto open_external_url(HWND window, std::wstring_view url) -> void {
  // 只向系统浏览器交付网页链接，不从网页启动任意本地协议或可执行文件。
  if (url.starts_with(L"https://") || url.starts_with(L"http://")) {
    auto result = reinterpret_cast<INT_PTR>(
        ShellExecuteW(window, L"open", std::wstring(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    if (result <= 32) {
      OutputDebugStringW(L"[BuildingMomo] Failed to open external link.\n");
    }
  }
}

// 配置 WebView2 核心设置：禁用 HostObjects、启用 WebMessage、监听导航/弹窗/消息并加载主页
auto configure_webview(AppState& state) -> HRESULT {
  // 获取 CoreWebView2 核心接口
  auto result = state.controller->get_CoreWebView2(state.webview.put());
  if (FAILED(result)) {
    return result;
  }
  // 获取运行时安全与功能配置接口
  wil::com_ptr<ICoreWebView2Settings> settings;
  result = state.webview->get_Settings(settings.put());
  if (FAILED(result)) {
    return result;
  }
  // 允许页面与宿主通过 WebMessage 通信，不向页面暴露原生 COM 对象。
  result = settings->put_AreHostObjectsAllowed(FALSE);
  if (FAILED(result)) {
    return result;
  }
  result = settings->put_IsWebMessageEnabled(TRUE);
  if (FAILED(result)) {
    return result;
  }

  // 拦截外链导航；应用内跳转则重置页面会话状态
  EventRegistrationToken token{};
  result = state.webview->add_NavigationStarting(
      Microsoft::WRL::Callback<ICoreWebView2NavigationStartingEventHandler>(
          [&state](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string uri;
            auto result = args->get_Uri(uri.put());
            if (FAILED(result)) {
              return result;
            }
            // 外部链接取消页面内导航并转给系统默认浏览器
            if (!is_app_url(uri.get())) {
              args->put_Cancel(TRUE);
              open_external_url(state.window, uri.get());
            } else {
              // 应用内页面刷新或跳转：重置当前 MCP 会话
              mcp::reset_page(state);
            }
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }
  // 拦截 window.open 新窗口请求并转由系统默认浏览器打开
  result = state.webview->add_NewWindowRequested(
      Microsoft::WRL::Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [&state](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            args->put_Handled(TRUE);
            wil::unique_cotaskmem_string uri;
            auto result = args->get_Uri(uri.put());
            if (FAILED(result)) {
              return result;
            }
            open_external_url(state.window, uri.get());
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }

  // 响应前端 window.close() 触发关闭应用主窗口
  result = state.webview->add_WindowCloseRequested(
      Microsoft::WRL::Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
          [&state](ICoreWebView2*, IUnknown*) -> HRESULT {
            PostMessageW(state.window, WM_CLOSE, 0, 0);
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }

  // 接收前端页面 postMessage 并校验来源合法后转发给桌面桥
  result = state.webview->add_WebMessageReceived(
      Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [&state](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string source;
            // 严格过滤仅处理受信任主站的消息
            if (FAILED(args->get_Source(source.put())) || !source || !is_app_url(source.get())) {
              return S_OK;
            }
            // 提取 JSON 消息正文并投递至桌面桥
            wil::unique_cotaskmem_string raw_message;
            if (SUCCEEDED(args->get_WebMessageAsJson(raw_message.put())) && raw_message) {
              bridge::handle_message(state, raw_message.get());
            }
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }

  // 同步尺寸、设置可见性并初始化焦点
  resize(state);
  state.controller->put_IsVisible(!IsIconic(state.window));
  if (GetForegroundWindow() == state.window) {
    state.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  }
  // 导航至前端主入口 URL
  return state.webview->Navigate(std::wstring(kAppOrigin).c_str());
}

// 处理 WebView2 控制器创建完成回调：绑定状态并初始化视图与配置
auto on_controller_created(AppState& state, HRESULT result, ICoreWebView2Controller* controller)
    -> HRESULT {
  // 正在退出时立即关闭控制器避免资源泄漏
  if (state.shutting_down) {
    if (controller) {
      controller->Close();
    }
    return S_OK;
  }
  // 保存控制器句柄并初始化设置
  if (SUCCEEDED(result)) {
    state.controller = controller;
    result = configure_webview(state);
  }
  // 初始化出错记录异常并通知弹窗
  if (FAILED(result)) {
    report_webview_error(state, "初始化 WebView2 窗口", result);
  }
  return S_OK;
}

// 处理 WebView2 环境创建完成回调：启动 GPU 进程监视并异步创建窗口控制器
auto on_environment_created(AppState& state, HRESULT result, ICoreWebView2Environment* environment)
    -> HRESULT {
  // 正在关闭则跳过后续流程
  if (state.shutting_down) {
    return S_OK;
  }
  // 创建环境失败上报错误
  if (FAILED(result)) {
    report_webview_error(state, "创建 WebView2 环境", result);
    return S_OK;
  }
  state.environment = environment;
  // 启动对 WebView2 GPU 渲染子进程的实时优先级监视
  gpu_priority::watch_processes(state);
  // 在当前主窗口内创建 WebView2 控制器
  result = environment->CreateCoreWebView2Controller(
      state.window,
      Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [&state](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
            return on_controller_created(state, result, controller);
          })
          .Get());
  if (FAILED(result)) {
    report_webview_error(state, "创建 WebView2 窗口", result);
  }
  return S_OK;
}

}  // namespace

// 判定指定 URL 是否属于合法的应用根域或其子路由
auto is_app_url(std::wstring_view url) -> bool {
  return url.starts_with(kAppOrigin) &&
         (url.size() == kAppOrigin.size() || url[kAppOrigin.size()] == L'/' ||
          url[kAppOrigin.size()] == L'?' || url[kAppOrigin.size()] == L'#');
}

// 初始化 WebView2 运行时：定位创建 LocalAppData 缓存目录并异步创建环境对象
auto initialize(AppState& state) -> std::expected<void, std::string> {
  // 查询用户本地应用数据存储路径
  wil::unique_cotaskmem_string local_app_data;
  auto result = SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, local_app_data.put());
  if (FAILED(result)) {
    return std::unexpected("无法定位本地应用数据目录。");
  }
  // 创建专用的 WebView2 数据持久化目录
  const auto folder = std::filesystem::path(local_app_data.get()) / L"BuildingMomo" / L"WebView2";
  std::error_code error;
  std::filesystem::create_directories(folder, error);
  if (error) {
    return std::unexpected("无法创建 WebView2 数据目录。错误码：" + std::to_string(error.value()));
  }
  state.user_data_folder = folder.wstring();

  // 异步创建 WebView2 运行时环境对象
  result = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, state.user_data_folder.c_str(), nullptr,
      Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [&state](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            return on_environment_created(state, result, environment);
          })
          .Get());
  if (FAILED(result)) {
    return std::unexpected(std::format(
        "无法启动 WebView2（HRESULT: 0x{:08X}）。\n请安装 Microsoft Edge WebView2 Runtime 后重试。",
        static_cast<unsigned long>(result)));
  }
  return {};
}

// 将 WebView2 视图范围调整为充满主窗口客户区并同步可见状态
auto resize(AppState& state) -> void {
  // 窗口未最小化时调整 WebView 边界
  if (state.controller && !state.shutting_down) {
    RECT bounds{};
    GetClientRect(state.window, &bounds);
    state.controller->put_Bounds(bounds);
    state.controller->put_IsVisible(!IsIconic(state.window));
  }
}

}  // namespace desktop::webview

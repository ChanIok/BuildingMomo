#include "window.hpp"

#include "vendor/std.hpp"

#include "vendor/windows/dwmapi.hpp"

#include "app.hpp"
#include "app_state.hpp"
#include "mcp/mcp_server.hpp"
#include "rtss/rtss_limiter.hpp"
#include "system_utils.hpp"
#include "webview.hpp"

namespace desktop::window {

namespace {

// DwmSetWindowAttribute 的属性号与取值直接按 ABI 写死，避免依赖 SDK 头文件版本。
constexpr DWORD kAttrImmersiveDarkMode = 20;       // DWMWA_USE_IMMERSIVE_DARK_MODE（Win10 20H1）
constexpr DWORD kAttrWindowCornerPreference = 33;  // DWMWA_WINDOW_CORNER_PREFERENCE（Win11 22000）
constexpr DWORD kAttrBorderColor = 34;             // DWMWA_BORDER_COLOR（Win11 22000）
constexpr DWORD kAttrCaptionColor = 35;            // DWMWA_CAPTION_COLOR（Win11 22000）
constexpr DWORD kAttrTextColor = 36;               // DWMWA_TEXT_COLOR（Win11 22000）
constexpr int kCornerRound = 2;                    // DWMWCP_ROUND

// 读取系统当前应用主题，返回与系统相匹配的默认窗口外观
auto system_default_appearance() -> WindowAppearance {
  DWORD apps_use_light_theme = 1;
  DWORD size = sizeof(apps_use_light_theme);
  // 读取系统个人偏好注册表项中的深浅色模式配置
  RegGetValueW(HKEY_CURRENT_USER,
               L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
               L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &apps_use_light_theme, &size);
  WindowAppearance appearance{};
  // 页面加载完成前先猜一个与系统主题一致的外观，避免浅色标题栏压在深色内容上。
  if (apps_use_light_theme == 0) {
    appearance.dark = true;
    appearance.caption = RGB(0x18, 0x18, 0x18);
    appearance.text = RGB(0xCC, 0xCC, 0xCC);
    appearance.border = RGB(0x3A, 0x3A, 0x3A);
  }
  return appearance;
}

// 主窗口消息处理过程：分派 MCP 异步消息、心跳定时器、尺寸变化及生命周期事件
auto CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) -> LRESULT {
  auto* state = reinterpret_cast<AppState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  // 首次创建时将 AppState 实例关联至窗口的 GWLP_USERDATA
  if (message == WM_NCCREATE) {
    state = static_cast<AppState*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams);
    state->window = window;
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
  }
  if (!state) {
    return DefWindowProcW(window, message, wparam, lparam);
  }

  switch (message) {
    // 派发 MCP 工作线程队列中的待发送消息
    case mcp::kDispatchMessage:
      mcp::dispatch_messages(*state);
      return 0;
    // 心跳定时器触发：刷新 RTSS 与游戏焦点状态
    case WM_TIMER:
      if (wparam == rtss::kHeartbeatTimer && !state->shutting_down) {
        rtss::refresh_status(*state);
        return 0;
      }
      break;
    // 窗口尺寸变化：同步缩放 WebView2 视图
    case WM_SIZE:
      webview::resize(*state);
      return 0;
    // 窗口移动：通知 WebView2 更新绝对屏幕位置
    case WM_MOVE:
    case WM_MOVING:
      if (state->controller) {
        state->controller->NotifyParentWindowPositionChanged();
      }
      break;
    // 屏幕 DPI 变更：调整窗口位置尺寸并缩放 WebView2
    case WM_DPICHANGED: {
      const auto* bounds = reinterpret_cast<RECT*>(lparam);
      SetWindowPos(window, nullptr, bounds->left, bounds->top, bounds->right - bounds->left,
                   bounds->bottom - bounds->top, SWP_NOZORDER | SWP_NOACTIVATE);
      webview::resize(*state);
      return 0;
    }
    // 限制窗口最小缩放尺寸
    case WM_GETMINMAXINFO: {
      auto* limits = reinterpret_cast<MINMAXINFO*>(lparam);
      const auto dpi = GetDpiForWindow(window);
      limits->ptMinTrackSize = {MulDiv(640, dpi, 96), MulDiv(480, dpi, 96)};
      return 0;
    }
    // 窗口获得焦点：将输入焦点转移给内嵌 WebView2
    case WM_SETFOCUS:
      if (state->controller) {
        state->controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
      }
      return 0;
    // 异步弹窗显示 WebView2 运行时故障信息
    case kWebViewErrorMessage:
      show_pending_error(*state);
      return 0;
    // 收到单实例唤起消息：还原并置顶当前窗口
    case system::kActivateInstanceMessage:
      if (IsIconic(window)) {
        ShowWindow(window, SW_RESTORE);
      } else {
        ShowWindow(window, SW_SHOW);
      }
      SetForegroundWindow(window);
      return 0;
    // 用户点击关闭按钮：触发窗口销毁
    case WM_CLOSE:
      DestroyWindow(window);
      return 0;
    // 窗口销毁：优雅关闭各子系统并退出消息循环
    case WM_DESTROY:
      shutdown(*state);
      PostQuitMessage(0);
      return 0;
    // 非客户区销毁：解除窗口与 AppState 的绑定
    case WM_NCDESTROY:
      state->window = nullptr;
      SetWindowLongPtrW(window, GWLP_USERDATA, 0);
      break;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

}  // namespace

// 调用 DWM 接口依次设置暗黑模式、圆角样式、标题栏背景色、文字色及边框色
auto apply_appearance(HWND window, const WindowAppearance& appearance) -> void {
  // 设置暗黑模式标题栏（Win10 20H1+）
  const BOOL dark = appearance.dark ? TRUE : FALSE;
  DwmSetWindowAttribute(window, kAttrImmersiveDarkMode, &dark, sizeof(dark));

  // 设置圆角窗口样式（Win11+）
  const int corner = kCornerRound;
  DwmSetWindowAttribute(window, kAttrWindowCornerPreference, &corner, sizeof(corner));

  // 设置标题栏背景颜色
  const COLORREF caption = appearance.caption;
  DwmSetWindowAttribute(window, kAttrCaptionColor, &caption, sizeof(caption));

  // 设置标题栏文字颜色
  const COLORREF text = appearance.text;
  DwmSetWindowAttribute(window, kAttrTextColor, &text, sizeof(text));

  // 设置窗口边框颜色
  const COLORREF border = appearance.border;
  DwmSetWindowAttribute(window, kAttrBorderColor, &border, sizeof(border));
}

// 注册窗口类 → 计算 DPI 适配初始大小 → 创建并展示原生主窗口
auto create(AppState& state, int show_command) -> std::expected<void, std::string> {
  // 注册主窗口类
  WNDCLASSEXW window_class{sizeof(WNDCLASSEXW)};
  window_class.lpfnWndProc = window_proc;
  window_class.hInstance = state.instance;
  window_class.hIcon = LoadIconW(state.instance, MAKEINTRESOURCEW(101));
  window_class.hIconSm = window_class.hIcon;
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  window_class.lpszClassName = system::kMainWindowClass;
  if (!RegisterClassExW(&window_class)) {
    return std::unexpected("无法注册窗口。错误码：" + std::to_string(GetLastError()));
  }

  // 根据当前主显示器 DPI 计算自适应初始窗口边界
  const auto dpi = GetDpiForSystem();
  RECT bounds{0, 0, MulDiv(1280, dpi, 96), MulDiv(800, dpi, 96)};
  AdjustWindowRectExForDpi(&bounds, WS_OVERLAPPEDWINDOW, FALSE, 0, dpi);
  // 创建原生顶层窗口并将 AppState 传递至 WM_NCCREATE
  if (!CreateWindowExW(0, system::kMainWindowClass, L"搬砖吧大喵 · BuildingMomo",
                       WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                       bounds.right - bounds.left, bounds.bottom - bounds.top, nullptr, nullptr,
                       state.instance, &state)) {
    return std::unexpected("无法创建窗口。错误码：" + std::to_string(GetLastError()));
  }

  // 允许低权限实例发送激活窗口消息（绕过 UIPI 限制）
  ChangeWindowMessageFilterEx(state.window, system::kActivateInstanceMessage, MSGFLT_ALLOW,
                              nullptr);

  // 应用系统主题预设的外观风格
  apply_appearance(state.window, system_default_appearance());

  // 呈现并刷新主窗口
  ShowWindow(state.window, show_command);
  UpdateWindow(state.window);
  return {};
}

}  // namespace desktop::window

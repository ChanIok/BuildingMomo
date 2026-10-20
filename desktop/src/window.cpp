#include "window.hpp"

#include <dwmapi.h>

#include "app.hpp"
#include "system_utils.hpp"
#include "webview.hpp"

namespace desktop {

namespace {

constexpr auto kWindowClass = L"BuildingMomoDesktopWindow";

// DwmSetWindowAttribute 的属性号与取值直接按 ABI 写死，避免依赖 SDK 头文件版本。
constexpr DWORD kAttrImmersiveDarkMode = 20;      // DWMWA_USE_IMMERSIVE_DARK_MODE（Win10 20H1）
constexpr DWORD kAttrWindowCornerPreference = 33;  // DWMWA_WINDOW_CORNER_PREFERENCE（Win11 22000）
constexpr DWORD kAttrBorderColor = 34;             // DWMWA_BORDER_COLOR（Win11 22000）
constexpr DWORD kAttrCaptionColor = 35;            // DWMWA_CAPTION_COLOR（Win11 22000）
constexpr DWORD kAttrTextColor = 36;               // DWMWA_TEXT_COLOR（Win11 22000）
constexpr int kCornerRound = 2;                    // DWMWCP_ROUND

// 页面加载完成前先猜一个与系统主题一致的外观，避免浅色标题栏压在深色内容上。
auto system_default_appearance() -> WindowAppearance {
  DWORD apps_use_light_theme = 1;
  DWORD size = sizeof(apps_use_light_theme);
  RegGetValueW(HKEY_CURRENT_USER,
               L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
               L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &apps_use_light_theme, &size);
  WindowAppearance appearance{};
  if (apps_use_light_theme == 0) {
    appearance.dark = true;
    appearance.caption = RGB(0x18, 0x18, 0x18);
    appearance.text = RGB(0xCC, 0xCC, 0xCC);
    appearance.border = RGB(0x3A, 0x3A, 0x3A);
  }
  return appearance;
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  auto* state = reinterpret_cast<AppState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    state = static_cast<AppState*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams);
    state->window = window;
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
  }
  if (!state) {
    return DefWindowProcW(window, message, wparam, lparam);
  }

  switch (message) {
    case WM_SIZE:
      resize_webview(*state);
      return 0;
    case WM_MOVE:
    case WM_MOVING:
      if (state->controller) {
        state->controller->NotifyParentWindowPositionChanged();
      }
      break;
    case WM_DPICHANGED: {
      const auto* bounds = reinterpret_cast<RECT*>(lparam);
      SetWindowPos(window, nullptr, bounds->left, bounds->top, bounds->right - bounds->left,
                   bounds->bottom - bounds->top, SWP_NOZORDER | SWP_NOACTIVATE);
      resize_webview(*state);
      return 0;
    }
    case WM_GETMINMAXINFO: {
      auto* limits = reinterpret_cast<MINMAXINFO*>(lparam);
      const auto dpi = GetDpiForWindow(window);
      limits->ptMinTrackSize = {MulDiv(640, dpi, 96), MulDiv(480, dpi, 96)};
      return 0;
    }
    case WM_SETFOCUS:
      if (state->controller) {
        state->controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
      }
      return 0;
    case kWebViewErrorMessage:
      show_pending_error(*state);
      return 0;
    case kActivateInstanceMessage:
      if (IsIconic(window)) {
        ShowWindow(window, SW_RESTORE);
      } else {
        ShowWindow(window, SW_SHOW);
      }
      SetForegroundWindow(window);
      return 0;
    case WM_CLOSE:
      DestroyWindow(window);
      return 0;
    case WM_DESTROY:
      shutdown(*state);
      PostQuitMessage(0);
      return 0;
    case WM_NCDESTROY:
      state->window = nullptr;
      SetWindowLongPtrW(window, GWLP_USERDATA, 0);
      break;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

}  // namespace

auto apply_window_appearance(HWND window, const WindowAppearance& appearance) -> void {
  // 各属性按系统版本逐个失败，不检查返回值：老系统上缺哪项就少哪项效果。
  const BOOL dark = appearance.dark ? TRUE : FALSE;
  DwmSetWindowAttribute(window, kAttrImmersiveDarkMode, &dark, sizeof(dark));

  const int corner = kCornerRound;
  DwmSetWindowAttribute(window, kAttrWindowCornerPreference, &corner, sizeof(corner));

  const COLORREF caption = appearance.caption;
  DwmSetWindowAttribute(window, kAttrCaptionColor, &caption, sizeof(caption));

  const COLORREF text = appearance.text;
  DwmSetWindowAttribute(window, kAttrTextColor, &text, sizeof(text));

  const COLORREF border = appearance.border;
  DwmSetWindowAttribute(window, kAttrBorderColor, &border, sizeof(border));
}

auto create_window(AppState& state, int show_command) -> std::expected<void, std::wstring> {
  WNDCLASSEXW window_class{sizeof(WNDCLASSEXW)};
  window_class.lpfnWndProc = window_proc;
  window_class.hInstance = state.instance;
  window_class.hIcon = LoadIconW(state.instance, MAKEINTRESOURCEW(101));
  window_class.hIconSm = window_class.hIcon;
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  window_class.lpszClassName = kWindowClass;
  if (!RegisterClassExW(&window_class)) {
    return std::unexpected(L"无法注册窗口。错误码：" + std::to_wstring(GetLastError()));
  }

  const auto dpi = GetDpiForSystem();
  RECT bounds{0, 0, MulDiv(1280, dpi, 96), MulDiv(800, dpi, 96)};
  AdjustWindowRectExForDpi(&bounds, WS_OVERLAPPEDWINDOW, FALSE, 0, dpi);
  if (!CreateWindowExW(0, kWindowClass, L"搬砖吧大喵 · BuildingMomo", WS_OVERLAPPEDWINDOW,
                       CW_USEDEFAULT, CW_USEDEFAULT, bounds.right - bounds.left,
                       bounds.bottom - bounds.top, nullptr, nullptr, state.instance, &state)) {
    return std::unexpected(L"无法创建窗口。错误码：" + std::to_wstring(GetLastError()));
  }

  // 允许低权限实例发送激活窗口消息（绕过 UIPI 限制）
  ChangeWindowMessageFilterEx(state.window, kActivateInstanceMessage, MSGFLT_ALLOW, nullptr);

  apply_window_appearance(state.window, system_default_appearance());

  ShowWindow(state.window, show_command);
  UpdateWindow(state.window);
  return {};
}

}  // namespace desktop

#include "window.hpp"

#include "app.hpp"
#include "webview.hpp"

namespace desktop {

namespace {

constexpr auto kWindowClass = L"BuildingMomoDesktopWindow";

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
  ShowWindow(state.window, show_command);
  UpdateWindow(state.window);
  return {};
}

}  // namespace desktop

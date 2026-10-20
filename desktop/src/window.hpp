#pragma once

#include <windows.h>

#include <expected>
#include <string>

namespace desktop {

struct AppState;

// 标题栏配色由页面按当前主题下发。DWM 不支持的属性会被静默忽略：
// Win10 只能拿到深色标题栏，圆角与自定义配色需要 Win11。
struct WindowAppearance {
  bool dark = false;
  COLORREF caption = RGB(0xF8, 0xF8, 0xF8);
  COLORREF text = RGB(0x1E, 0x1E, 0x1E);
  COLORREF border = RGB(0xE5, 0xE5, 0xE5);
};

auto create_window(AppState& state, int show_command) -> std::expected<void, std::wstring>;
auto apply_window_appearance(HWND window, const WindowAppearance& appearance) -> void;

}  // namespace desktop

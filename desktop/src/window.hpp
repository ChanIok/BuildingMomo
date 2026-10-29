#pragma once

#include "vendor/std.hpp"

#include "vendor/windows.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::window {

// 标题栏配色由页面按当前主题下发。DWM 不支持的属性会被静默忽略：
// Win10 只能拿到深色标题栏，圆角与自定义配色需要 Win11。
struct WindowAppearance {
  bool dark = false;
  COLORREF caption = RGB(0xF8, 0xF8, 0xF8);
  COLORREF text = RGB(0x1E, 0x1E, 0x1E);
  COLORREF border = RGB(0xE5, 0xE5, 0xE5);
};

// 注册主窗口类、计算 DPI 适配尺寸并创建主窗口
auto create(AppState& state, int show_command) -> std::expected<void, std::string>;
// 通过 DWM API 为窗口应用暗黑模式、圆角与标题栏边框颜色
auto apply_appearance(HWND window, const WindowAppearance& appearance) -> void;

}  // namespace desktop::window

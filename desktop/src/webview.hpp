#pragma once

#include "vendor/std.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::webview {

#ifdef BUILDINGMOMO_DESKTOP_DEBUG
inline constexpr std::wstring_view kAppOrigin = L"http://localhost:5173";
#else
inline constexpr std::wstring_view kAppOrigin = L"https://lab.infinitymomo.com";
#endif

// 校验给定 URL 是否属于应用可信任的宿主地址
auto is_app_url(std::wstring_view url) -> bool;
// 准备 WebView2 用户数据目录并异步创建环境对象
auto initialize(AppState& state) -> std::expected<void, std::string>;
// 将 WebView2 控制器大小与可见性同步至当前主窗口客户区
auto resize(AppState& state) -> void;

}  // namespace desktop::webview

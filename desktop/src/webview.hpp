#pragma once

#include <expected>
#include <string>

namespace desktop {

struct AppState;
auto initialize_webview(AppState& state) -> std::expected<void, std::wstring>;
auto resize_webview(AppState& state) -> void;

}  // namespace desktop

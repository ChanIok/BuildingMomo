#pragma once

#include <expected>
#include <string>

namespace desktop {

struct AppState;
auto create_window(AppState& state, int show_command) -> std::expected<void, std::wstring>;

}  // namespace desktop

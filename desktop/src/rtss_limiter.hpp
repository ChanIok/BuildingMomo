#pragma once

#include <windows.h>
#include <functional>

namespace desktop {

struct RtssStatus {
  bool available = false;
  bool game_running = false;
  bool game_focused = false;
  bool is_limiting = false;
};

using RtssStatusCallback = std::function<void(const RtssStatus&)>;

void init_rtss_limiter(RtssStatusCallback status_callback);
void shutdown_rtss_limiter();
void update_rtss_config(bool enabled, int target_fps);
void refresh_rtss_status();
RtssStatus get_rtss_status();

}  // namespace desktop

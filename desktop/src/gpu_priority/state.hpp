#pragma once

#include "vendor/std.hpp"

#include "vendor/webview2.hpp"
#include "vendor/wil.hpp"
#include "vendor/windows.hpp"

namespace desktop::gpu_priority {

struct GpuPriorityState {
  std::ofstream log;
  wil::com_ptr<ICoreWebView2Environment8> environment;
  EventRegistrationToken process_changed_token{};
  // 每个 PID 在本次监视期间只尝试一次，不因失败或配置切换重复设置。
  std::unordered_set<DWORD> processed_pids;
};

}  // namespace desktop::gpu_priority

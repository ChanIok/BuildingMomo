#pragma once

#include <windows.h>
#include <objbase.h>
#include <WebView2.h>
#include <wil/com.h>

#include <fstream>
#include <unordered_set>

namespace desktop {

struct GpuPriorityState {
  std::ofstream log;
  wil::com_ptr<ICoreWebView2Environment8> environment;
  EventRegistrationToken process_changed_token{};
  std::unordered_set<DWORD> processed_pids;
};

void init_gpu_priority_log(GpuPriorityState& state);
void watch_gpu_processes(ICoreWebView2Environment* environment, GpuPriorityState& state);
void shutdown_gpu_priority(GpuPriorityState& state);

}  // namespace desktop

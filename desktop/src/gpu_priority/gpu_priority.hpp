#pragma once

#include "vendor/std.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::gpu_priority {

// 仅在 UI 线程访问 WebView2 进程信息与监视状态。

// 初始化 GPU 优先级监视日志并清理超额的历史日志文件
auto initialize_log(AppState& state) -> void;
// 注册 WebView2 进程变更监听并对 GPU 进程应用实时优先级
auto watch_processes(AppState& state) -> void;
// 停止 GPU 进程监视并清理日志与注册句柄
auto shutdown(AppState& state) -> void;

}  // namespace desktop::gpu_priority

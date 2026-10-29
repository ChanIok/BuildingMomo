#pragma once

#include "vendor/std.hpp"

namespace desktop::memory {

struct MemoryCleanResult {
  bool success = false;
  std::int64_t released_mb = 0;
  std::string error_code;  // 与页面协议一致："ok"、"game_not_running"、"access_denied"、"failed"。
};

// 查找运行中的游戏进程并执行物理内存裁减
auto clean_game_memory() -> MemoryCleanResult;
// 清理编辑器主进程及其所有 WebView2 子孙进程的物理内存
auto clean_editor_memory() -> MemoryCleanResult;

}  // namespace desktop::memory

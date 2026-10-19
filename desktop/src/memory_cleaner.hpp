#pragma once

#include <windows.h>
#include <cstdint>
#include <string>

namespace desktop {

struct MemoryCleanResult {
  bool success = false;
  int64_t released_mb = 0;
  std::wstring error_code;  // "ok", "game_not_running", "access_denied", "failed"
};

MemoryCleanResult clean_game_memory();
MemoryCleanResult clean_editor_memory();

}  // namespace desktop

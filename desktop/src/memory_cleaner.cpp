#include "memory_cleaner.hpp"

#include <psapi.h>
#include <tlhelp32.h>
#include <algorithm>
#include <unordered_set>
#include <vector>

namespace desktop {

namespace {

constexpr const wchar_t* kGameExeName = L"X6Game-Win64-Shipping.exe";

struct ProcessTrimInfo {
  bool success = false;
  int64_t bytes_before = 0;
  int64_t bytes_after = 0;
  DWORD error = 0;
};

ProcessTrimInfo trim_process_working_set(DWORD pid) {
  ProcessTrimInfo info{};
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, FALSE, pid);
  if (!process) {
    info.error = GetLastError();
    return info;
  }

  PROCESS_MEMORY_COUNTERS pmc{};
  if (GetProcessMemoryInfo(process, &pmc, sizeof(pmc))) {
    info.bytes_before = static_cast<int64_t>(pmc.WorkingSetSize);
  }

  if (EmptyWorkingSet(process)) {
    info.success = true;
    if (GetProcessMemoryInfo(process, &pmc, sizeof(pmc))) {
      info.bytes_after = static_cast<int64_t>(pmc.WorkingSetSize);
    }
  } else {
    info.error = GetLastError();
  }

  CloseHandle(process);
  return info;
}

}  // namespace

MemoryCleanResult clean_game_memory() {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return {false, 0, L"failed"};
  }

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);

  bool found = false;
  bool any_denied = false;
  bool any_success = false;
  int64_t total_before = 0;
  int64_t total_after = 0;

  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (_wcsicmp(entry.szExeFile, kGameExeName) == 0) {
        found = true;
        auto res = trim_process_working_set(entry.th32ProcessID);
        if (res.success) {
          any_success = true;
          total_before += res.bytes_before;
          total_after += res.bytes_after;
        } else if (res.error == ERROR_ACCESS_DENIED) {
          any_denied = true;
        }
      }
    } while (Process32NextW(snapshot, &entry));
  }

  CloseHandle(snapshot);

  if (!found) {
    return {false, 0, L"game_not_running"};
  }
  if (!any_success && any_denied) {
    return {false, 0, L"access_denied"};
  }
  if (!any_success) {
    return {false, 0, L"failed"};
  }

  int64_t released_bytes = (total_before > total_after) ? (total_before - total_after) : 0;
  int64_t released_mb = (released_bytes + (512 * 1024)) / (1024 * 1024);
  return {true, released_mb, L"ok"};
}

MemoryCleanResult clean_editor_memory() {
  int64_t total_before = 0;
  int64_t total_after = 0;

  // 1. 清理自身进程
  HANDLE current_process = GetCurrentProcess();
  PROCESS_MEMORY_COUNTERS pmc{};
  if (GetProcessMemoryInfo(current_process, &pmc, sizeof(pmc))) {
    total_before += static_cast<int64_t>(pmc.WorkingSetSize);
  }
  EmptyWorkingSet(current_process);
  if (GetProcessMemoryInfo(current_process, &pmc, sizeof(pmc))) {
    total_after += static_cast<int64_t>(pmc.WorkingSetSize);
  }

  // 2. 清理所有子进程 (包括 WebView2 渲染进程、GPU 进程等)
  DWORD self_pid = GetCurrentProcessId();
  std::unordered_set<DWORD> tree_pids;
  tree_pids.insert(self_pid);

  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot != INVALID_HANDLE_VALUE) {
    std::vector<PROCESSENTRY32W> entries;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);

    if (Process32FirstW(snapshot, &entry)) {
      do {
        entries.push_back(entry);
      } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);

    // 多轮传递依赖找到属于本工具的所有子代进程
    bool added = true;
    while (added) {
      added = false;
      for (const auto& pe : entries) {
        if (tree_pids.contains(pe.th32ParentProcessID) && !tree_pids.contains(pe.th32ProcessID)) {
          tree_pids.insert(pe.th32ProcessID);
          added = true;
        }
      }
    }

    // 清理除当前进程外的所有子进程
    for (DWORD pid : tree_pids) {
      if (pid == self_pid) {
        continue;
      }
      auto res = trim_process_working_set(pid);
      if (res.success) {
        total_before += res.bytes_before;
        total_after += res.bytes_after;
      }
    }
  }

  int64_t released_bytes = (total_before > total_after) ? (total_before - total_after) : 0;
  int64_t released_mb = (released_bytes + (512 * 1024)) / (1024 * 1024);
  return {true, released_mb, L"ok"};
}

}  // namespace desktop

#include "memory_cleaner.hpp"

#include "vendor/std.hpp"

#include "vendor/wil.hpp"
#include "vendor/windows.hpp"
#include "vendor/windows/psapi.hpp"
#include "vendor/windows/tlhelp32.hpp"

namespace desktop::memory {

namespace {

constexpr const wchar_t* kGameExeName = L"X6Game-Win64-Shipping.exe";

struct ProcessTrimInfo {
  bool success = false;
  std::int64_t bytes_before = 0;
  std::int64_t bytes_after = 0;
  DWORD error = 0;
};

// 尝试对指定 PID 进程调用 EmptyWorkingSet 裁减物理内存并统计前后差值
auto trim_process_working_set(DWORD pid) -> ProcessTrimInfo {
  ProcessTrimInfo info{};
  // 打开目标进程（需要查询信息和配额设置权限）
  wil::unique_handle process(
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, FALSE, pid));
  if (!process) {
    info.error = GetLastError();
    return info;
  }

  // 记录清理前的工作集大小
  PROCESS_MEMORY_COUNTERS pmc{};
  if (GetProcessMemoryInfo(process.get(), &pmc, sizeof(pmc))) {
    info.bytes_before = static_cast<std::int64_t>(pmc.WorkingSetSize);
  }

  // 请求系统将进程非必要工作集页面移入修改页列表或分页文件
  if (EmptyWorkingSet(process.get())) {
    info.success = true;
    // 记录清理后的工作集大小
    if (GetProcessMemoryInfo(process.get(), &pmc, sizeof(pmc))) {
      info.bytes_after = static_cast<std::int64_t>(pmc.WorkingSetSize);
    }
  } else {
    info.error = GetLastError();
  }

  return info;
}

}  // namespace

// 遍历系统进程定位无限暖暖游戏并清理其物理内存占用
auto clean_game_memory() -> MemoryCleanResult {
  // 创建系统进程快照
  wil::unique_handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (!snapshot) {
    return {false, 0, "failed"};
  }

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);

  bool found = false;
  bool any_denied = false;
  bool any_success = false;
  std::int64_t total_before = 0;
  std::int64_t total_after = 0;

  // 查找匹配目标游戏进程名的所有实例并执行裁减
  if (Process32FirstW(snapshot.get(), &entry)) {
    do {
      if (_wcsicmp(entry.szExeFile, kGameExeName) == 0) {
        found = true;
        const auto result = trim_process_working_set(entry.th32ProcessID);
        // 统计成功清理的内存差值
        if (result.success) {
          any_success = true;
          total_before += result.bytes_before;
          total_after += result.bytes_after;
        } else if (result.error == ERROR_ACCESS_DENIED) {
          any_denied = true;
        }
      }
    } while (Process32NextW(snapshot.get(), &entry));
  }

  // 游戏未运行返回对应错误码
  if (!found) {
    return {false, 0, "game_not_running"};
  }
  // 因权限不足被拒绝
  if (!any_success && any_denied) {
    return {false, 0, "access_denied"};
  }
  // 清理失败
  if (!any_success) {
    return {false, 0, "failed"};
  }

  // 换算释放字节数为 MB 并四舍五入
  std::int64_t released_bytes = (total_before > total_after) ? (total_before - total_after) : 0;
  std::int64_t released_mb = (released_bytes + (512 * 1024)) / (1024 * 1024);
  return {true, released_mb, "ok"};
}

// 清理主进程并递归遍历所有 WebView2 子进程执行物理工作集裁减
auto clean_editor_memory() -> MemoryCleanResult {
  std::int64_t total_before = 0;
  std::int64_t total_after = 0;

  // 首先清理主进程自身的工作集
  HANDLE current_process = GetCurrentProcess();
  PROCESS_MEMORY_COUNTERS pmc{};
  if (GetProcessMemoryInfo(current_process, &pmc, sizeof(pmc))) {
    total_before += static_cast<std::int64_t>(pmc.WorkingSetSize);
  }
  EmptyWorkingSet(current_process);
  if (GetProcessMemoryInfo(current_process, &pmc, sizeof(pmc))) {
    total_after += static_cast<std::int64_t>(pmc.WorkingSetSize);
  }

  // 收集当前进程的所有子进程 PID（递归子树）
  DWORD self_pid = GetCurrentProcessId();
  std::unordered_set<DWORD> tree_pids;
  tree_pids.insert(self_pid);

  // 遍历进程快照构建进程树
  wil::unique_handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (snapshot) {
    std::vector<PROCESSENTRY32W> entries;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);

    if (Process32FirstW(snapshot.get(), &entry)) {
      do {
        entries.push_back(entry);
      } while (Process32NextW(snapshot.get(), &entry));
    }

    // 快照不保证父进程先于子进程出现，多轮扩展才能包含 WebView2 的所有子代。
    bool added = true;
    while (added) {
      added = false;
      for (const auto& process_entry : entries) {
        if (tree_pids.contains(process_entry.th32ParentProcessID) &&
            !tree_pids.contains(process_entry.th32ProcessID)) {
          tree_pids.insert(process_entry.th32ProcessID);
          added = true;
        }
      }
    }

    // 逐一裁减所有子孙进程的物理工作集
    for (DWORD pid : tree_pids) {
      if (pid == self_pid) {
        continue;
      }
      const auto result = trim_process_working_set(pid);
      if (result.success) {
        total_before += result.bytes_before;
        total_after += result.bytes_after;
      }
    }
  }

  // 换算释放总量为 MB 并返回成功
  std::int64_t released_bytes = (total_before > total_after) ? (total_before - total_after) : 0;
  std::int64_t released_mb = (released_bytes + (512 * 1024)) / (1024 * 1024);
  return {true, released_mb, "ok"};
}

}  // namespace desktop::memory

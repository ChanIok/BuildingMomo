#include "gpu_priority.hpp"

#include <d3dkmthk.h>
#include <shlobj.h>
#include <wil/resource.h>
#include <wrl.h>

#include <algorithm>
#include <filesystem>
#include <format>
#include <vector>

namespace desktop {

namespace {

void log_message(GpuPriorityState& state, const std::string& message) {
  SYSTEMTIME time{};
  GetLocalTime(&time);
  auto line = std::format("{:02}:{:02}:{:02}.{:03} {}\n", time.wHour, time.wMinute,
                          time.wSecond, time.wMilliseconds, message);
  if (state.log.is_open()) {
    state.log << line;
    state.log.flush();
  }
  OutputDebugStringA(line.c_str());
}

void apply_priority(GpuPriorityState& state, DWORD pid) {
  wil::unique_handle process(OpenProcess(PROCESS_SET_INFORMATION, FALSE, pid));
  if (!process) {
    log_message(state, std::format("pid={} OpenProcess failed: Win32={}", pid, GetLastError()));
    return;
  }
  auto status = D3DKMTSetProcessSchedulingPriorityClass(
      process.get(), D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME);
  if (status == 0) {
    log_message(state, std::format("pid={} priority set to REALTIME", pid));
  } else {
    log_message(state, std::format("pid={} set REALTIME failed: NTSTATUS=0x{:08X}",
                                   pid, static_cast<unsigned long>(status)));
  }
}

void refresh_gpu_processes(GpuPriorityState& state) {
  if (!state.environment) {
    return;
  }
  wil::com_ptr<ICoreWebView2ProcessInfoCollection> collection;
  if (FAILED(state.environment->GetProcessInfos(collection.put()))) {
    return;
  }
  UINT count = 0;
  if (FAILED(collection->get_Count(&count))) {
    return;
  }
  for (UINT index = 0; index < count; ++index) {
    wil::com_ptr<ICoreWebView2ProcessInfo> info;
    if (FAILED(collection->GetValueAtIndex(index, info.put()))) {
      continue;
    }
    COREWEBVIEW2_PROCESS_KIND kind{};
    INT32 pid = 0;
    if (FAILED(info->get_Kind(&kind)) || FAILED(info->get_ProcessId(&pid))) {
      continue;
    }
    if (kind != COREWEBVIEW2_PROCESS_KIND_GPU) {
      continue;
    }
    auto dword_pid = static_cast<DWORD>(pid);
    if (!state.processed_pids.contains(dword_pid)) {
      state.processed_pids.insert(dword_pid);
      apply_priority(state, dword_pid);
    }
  }
}

}  // namespace

void init_gpu_priority_log(GpuPriorityState& state) {
  wil::unique_cotaskmem_string local_app_data;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, local_app_data.put()))) {
    return;
  }
  const auto log_dir = std::filesystem::path(local_app_data.get()) / L"BuildingMomo" / L"logs";
  std::error_code ec;
  std::filesystem::create_directories(log_dir, ec);
  if (ec) {
    return;
  }

  // 限制日志文件数量，最多保留 5 个
  constexpr size_t kMaxLogFiles = 5;
  std::vector<std::filesystem::directory_entry> log_files;
  for (const auto& entry : std::filesystem::directory_iterator(log_dir, ec)) {
    if (entry.is_regular_file(ec) && entry.path().extension() == L".log") {
      log_files.push_back(entry);
    }
  }
  if (log_files.size() >= kMaxLogFiles) {
    std::ranges::sort(log_files, [](const auto& a, const auto& b) {
      std::error_code e1, e2;
      return a.last_write_time(e1) < b.last_write_time(e2);
    });
    for (size_t i = 0; i <= log_files.size() - kMaxLogFiles; ++i) {
      std::filesystem::remove(log_files[i].path(), ec);
    }
  }

  const auto path = log_dir / std::format(L"gpu-priority-{}.log", GetCurrentProcessId());
  state.log.open(path, std::ios::out | std::ios::trunc);
  log_message(state, std::format("host={} watcher started", GetCurrentProcessId()));
}

void watch_gpu_processes(ICoreWebView2Environment* environment, GpuPriorityState& state) {
  if (!environment) {
    return;
  }
  auto env8 = wil::com_ptr<ICoreWebView2Environment>(environment).try_query<ICoreWebView2Environment8>();
  if (!env8) {
    log_message(state, "ICoreWebView2Environment8 not supported; GPU priority unchanged");
    return;
  }
  state.environment = env8;
  auto result = state.environment->add_ProcessInfosChanged(
      Microsoft::WRL::Callback<ICoreWebView2ProcessInfosChangedEventHandler>(
          [&state](ICoreWebView2Environment*, IUnknown*) -> HRESULT {
            refresh_gpu_processes(state);
            return S_OK;
          })
          .Get(),
      &state.process_changed_token);
  if (FAILED(result)) {
    log_message(state, std::format("Cannot watch GPU processes: HRESULT=0x{:08X}",
                                   static_cast<unsigned long>(result)));
    state.environment.reset();
    return;
  }
  refresh_gpu_processes(state);
}

void shutdown_gpu_priority(GpuPriorityState& state) {
  if (state.environment) {
    state.environment->remove_ProcessInfosChanged(state.process_changed_token);
    state.environment.reset();
  }
  state.processed_pids.clear();
  if (state.log.is_open()) {
    log_message(state, "GPU priority watcher stopped");
    state.log.close();
  }
}

}  // namespace desktop

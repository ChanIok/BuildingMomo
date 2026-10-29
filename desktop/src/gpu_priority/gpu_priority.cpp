#include "gpu_priority/gpu_priority.hpp"

#include "vendor/std.hpp"

#include "vendor/wil.hpp"
#include "vendor/windows.hpp"
#include "vendor/windows/d3dkmthk.hpp"
#include "vendor/windows/shlobj.hpp"
#include "vendor/windows/wrl.hpp"

#include "app_state.hpp"
#include "gpu_priority/state.hpp"

namespace desktop::gpu_priority {

namespace {

// 格式化当前时间戳并向日志文件及系统调试输出端口输出消息
auto log_message(GpuPriorityState& state, std::string_view message) -> void {
  SYSTEMTIME time{};
  // 获取本地系统时间
  GetLocalTime(&time);
  auto line = std::format("{:02}:{:02}:{:02}.{:03} {}\n", time.wHour, time.wMinute, time.wSecond,
                          time.wMilliseconds, message);
  // 写入日志文件并实时刷盘
  if (state.log.is_open()) {
    state.log << line;
    state.log.flush();
  }
  // 向 OutputDebugString 镜像一份调试信息
  OutputDebugStringA(line.c_str());
}

// 为指定的 WebView2 GPU 子进程设置实时调度优先级
auto apply_priority(AppState& app, DWORD pid) -> void {
  auto& state = *app.gpu_priority;
  // 未启用 GPU 优先级配置时直接跳过
  if (!app.config.gpu_realtime_priority) {
    log_message(state, std::format("pid={} priority elevation skipped (disabled by config)", pid));
    return;
  }
  // 获取进程提权配置权限
  wil::unique_handle process(OpenProcess(PROCESS_SET_INFORMATION, FALSE, pid));
  if (!process) {
    log_message(state, std::format("pid={} OpenProcess failed: Win32={}", pid, GetLastError()));
    return;
  }
  // 调用 D3DKMT 内核 API 提升 GPU 调度优先级到 REALTIME
  auto status = D3DKMTSetProcessSchedulingPriorityClass(process.get(),
                                                        D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME);
  if (status == 0) {
    log_message(state, std::format("pid={} priority set to REALTIME", pid));
  } else {
    log_message(state, std::format("pid={} set REALTIME failed: NTSTATUS=0x{:08X}", pid,
                                   static_cast<unsigned long>(status)));
  }
}

// 遍历 WebView2 进程快照，筛选未处理过的 GPU 子进程并提升优先级
auto refresh_gpu_processes(AppState& app) -> void {
  auto& state = *app.gpu_priority;
  // 环境尚未就绪直接退出
  if (!state.environment) {
    return;
  }
  // 获取 WebView2 当前所有子进程列表
  wil::com_ptr<ICoreWebView2ProcessInfoCollection> collection;
  if (FAILED(state.environment->GetProcessInfos(collection.put()))) {
    return;
  }
  UINT count = 0;
  if (FAILED(collection->get_Count(&count))) {
    return;
  }
  // 逐一检查进程类型并对新 GPU 进程提权
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
    // 忽略非 GPU 渲染子进程
    if (kind != COREWEBVIEW2_PROCESS_KIND_GPU) {
      continue;
    }
    auto dword_pid = static_cast<DWORD>(pid);
    // 仅对本次未处理过的 GPU 进程提权，避免重复操作
    if (!state.processed_pids.contains(dword_pid)) {
      state.processed_pids.insert(dword_pid);
      apply_priority(app, dword_pid);
    }
  }
}

}  // namespace

// 初始化 GPU 优先级日志文件并清理超出上限的历史日志
auto initialize_log(AppState& app) -> void {
  auto& state = *app.gpu_priority;
  wil::unique_cotaskmem_string local_app_data;
  // 定位 LocalAppData 目录
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, local_app_data.put()))) {
    return;
  }
  const auto log_dir = std::filesystem::path(local_app_data.get()) / L"BuildingMomo" / L"logs";
  // 确保日志目录存在
  std::error_code ec;
  std::filesystem::create_directories(log_dir, ec);
  if (ec) {
    return;
  }

  // 保留当前日志与最近的历史日志，总数最多 5 个。
  constexpr size_t kMaxLogFiles = 5;
  std::vector<std::filesystem::directory_entry> log_files;
  for (const auto& entry : std::filesystem::directory_iterator(log_dir, ec)) {
    if (entry.is_regular_file(ec) && entry.path().extension() == L".log") {
      log_files.push_back(entry);
    }
  }
  // 数量超限时移除最旧的文件，为新日志腾出空间
  if (log_files.size() >= kMaxLogFiles) {
    std::ranges::sort(log_files, [](const auto& a, const auto& b) {
      std::error_code first_error;
      std::error_code second_error;
      return a.last_write_time(first_error) < b.last_write_time(second_error);
    });
    for (size_t i = 0; i <= log_files.size() - kMaxLogFiles; ++i) {
      std::filesystem::remove(log_files[i].path(), ec);
    }
  }

  // 创建并打开当前进程实例的日志文件
  const auto path = log_dir / std::format(L"gpu-priority-{}.log", GetCurrentProcessId());
  state.log.open(path, std::ios::out | std::ios::trunc);
  log_message(state, std::format("host={} watcher started", GetCurrentProcessId()));
}

// 注册 WebView2 进程生命周期监听器并立即执行初次全量扫描
auto watch_processes(AppState& app) -> void {
  auto& state = *app.gpu_priority;
  auto* environment = app.environment.get();
  if (!environment) {
    return;
  }
  // 查询支持进程监视事件的 Environment8 接口
  auto env8 =
      wil::com_ptr<ICoreWebView2Environment>(environment).try_query<ICoreWebView2Environment8>();
  if (!env8) {
    log_message(state, "ICoreWebView2Environment8 not supported; GPU priority unchanged");
    return;
  }
  state.environment = env8;
  // 订阅子进程创建与退出事件回调
  auto result = state.environment->add_ProcessInfosChanged(
      Microsoft::WRL::Callback<ICoreWebView2ProcessInfosChangedEventHandler>(
          [&app](ICoreWebView2Environment*, IUnknown*) -> HRESULT {
            refresh_gpu_processes(app);
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
  // 注册成功后立即扫描当前已存在的 GPU 进程
  refresh_gpu_processes(app);
}

// 注销进程监视器、清空进程缓存并关闭日志文件
auto shutdown(AppState& app) -> void {
  auto& state = *app.gpu_priority;
  // 注销 WebView2 进程通知并重置 COM 接口
  if (state.environment) {
    state.environment->remove_ProcessInfosChanged(state.process_changed_token);
    state.environment.reset();
  }
  // 清理处理过的 PID 记录
  state.processed_pids.clear();
  // 关闭日志文件
  if (state.log.is_open()) {
    log_message(state, "GPU priority watcher stopped");
    state.log.close();
  }
}

}  // namespace desktop::gpu_priority

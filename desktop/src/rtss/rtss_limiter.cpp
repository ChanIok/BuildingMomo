#include "rtss/rtss_limiter.hpp"

#include "vendor/std.hpp"

#include "vendor/wil.hpp"
#include "vendor/windows.hpp"
#include "vendor/windows/tlhelp32.hpp"

#include "app_state.hpp"
#include "rtss/state.hpp"

namespace desktop::rtss {

namespace {

constexpr DWORD kRtssHookFlagLimiterDisabled = 4;
constexpr UINT kWmRtssUpdateSettings = WM_APP + 100;
constexpr auto kTargetProcessName = "X6Game-Win64-Shipping.exe";
constexpr auto kTargetProcessExe = L"X6Game-Win64-Shipping.exe";

// 卸载 RTSS Hooks DLL 并重置全部函数指针
auto unload_api(RtssState& rtss) -> void {
  // 释放动态库句柄并置空导出函数指针
  rtss.hooks_dll.reset();
  rtss.load_profile = nullptr;
  rtss.save_profile = nullptr;
  rtss.set_profile_property = nullptr;
  rtss.update_profiles = nullptr;
  rtss.set_flags = nullptr;
}

// 从注册表读取 RTSS 安装路径并动态加载 RTSSHooks64.dll 及其导出函数
auto load_api(RtssState& rtss) -> bool {
  // DLL 已加载则直接复用
  if (rtss.hooks_dll) {
    return true;
  }
  // 打开 RTSS 32位注册表键
  wil::unique_hkey key;
  if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "Software\\WOW6432Node\\Unwinder\\RTSS", 0, KEY_READ,
                    key.put()) != ERROR_SUCCESS) {
    return false;
  }
  // 读取 RTSS 安装目录
  char install_dir[MAX_PATH]{};
  DWORD size = MAX_PATH;
  DWORD type = 0;
  const auto result = RegQueryValueExA(key.get(), "InstallDir", nullptr, &type,
                                       reinterpret_cast<LPBYTE>(install_dir), &size);
  if (result != ERROR_SUCCESS || type != REG_SZ) {
    return false;
  }
  // 拼接路径并加载 RTSSHooks64.dll
  const auto dll_path = std::string(install_dir) + "\\RTSSHooks64.dll";
  rtss.hooks_dll.reset(LoadLibraryA(dll_path.c_str()));
  if (!rtss.hooks_dll) {
    return false;
  }
  // 解析配置读取、保存、更新与标志位操作函数地址
  rtss.load_profile =
      reinterpret_cast<LoadProfileFn>(GetProcAddress(rtss.hooks_dll.get(), "LoadProfile"));
  rtss.save_profile =
      reinterpret_cast<SaveProfileFn>(GetProcAddress(rtss.hooks_dll.get(), "SaveProfile"));
  rtss.set_profile_property = reinterpret_cast<SetProfilePropertyFn>(
      GetProcAddress(rtss.hooks_dll.get(), "SetProfileProperty"));
  rtss.update_profiles =
      reinterpret_cast<UpdateProfilesFn>(GetProcAddress(rtss.hooks_dll.get(), "UpdateProfiles"));
  rtss.set_flags = reinterpret_cast<SetFlagsFn>(GetProcAddress(rtss.hooks_dll.get(), "SetFlags"));
  // 任意必需导出函数缺失则彻底卸载并返回失败
  if (!rtss.load_profile || !rtss.save_profile || !rtss.set_profile_property ||
      !rtss.update_profiles || !rtss.set_flags) {
    unload_api(rtss);
    return false;
  }
  return true;
}

// 查找 RTSS 主界面窗口句柄以确认服务正在运行
auto find_rtss_window() -> HWND {
  // 优先匹配新版类名，缺省时降级匹配完整标题
  auto window = FindWindowA(nullptr, "RTSS");
  if (!window) {
    window = FindWindowA(nullptr, "RivaTuner Statistics Server");
  }
  return window;
}

// 向 RTSS 主窗口发送自定义更新消息通知配置生效
auto notify_rtss() -> void {
  // 查找 RTSS 窗口并异步投递配置更新通知
  if (const auto window = find_rtss_window()) {
    PostMessageA(window, kWmRtssUpdateSettings, 0, 0);
  }
}

// 为无限暖暖游戏配置帧率上限并通知 RTSS 生效
auto set_limit(RtssState& rtss, int fps) -> bool {
  // 确保 RTSS API 已成功加载
  if (!load_api(rtss)) {
    return false;
  }
  // 加载目标游戏独立配置文件
  rtss.load_profile(kTargetProcessName);
  auto value = static_cast<DWORD>(fps);
  // 写入帧率限制属性
  if (!rtss.set_profile_property("FramerateLimit", reinterpret_cast<LPBYTE>(&value),
                                 sizeof(value))) {
    return false;
  }
  // 保存并应用配置
  rtss.save_profile(kTargetProcessName);
  rtss.update_profiles();
  // 清除禁用限流标志位以启用限速
  rtss.set_flags(~kRtssHookFlagLimiterDisabled, 0);
  notify_rtss();
  return true;
}

// 清除游戏进程的帧率上限并恢复无限制运行
auto clear_limit(RtssState& rtss) -> void {
  // DLL 未加载说明未曾配置过限制，直接退出
  if (!rtss.hooks_dll) {
    return;
  }
  // 加载游戏配置并将限帧上限归零
  rtss.load_profile(kTargetProcessName);
  DWORD value = 0;
  rtss.set_profile_property("FramerateLimit", reinterpret_cast<LPBYTE>(&value), sizeof(value));
  rtss.save_profile(kTargetProcessName);
  rtss.update_profiles();
  // 设置禁用限流标志位以关闭限速
  rtss.set_flags(~kRtssHookFlagLimiterDisabled, kRtssHookFlagLimiterDisabled);
  notify_rtss();
}

// 遍历当前系统进程快照定位目标游戏进程的 PID
auto find_game_pid() -> DWORD {
  // 创建系统进程快照
  wil::unique_handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (!snapshot) {
    return 0;
  }
  // 遍历进程匹配可执行文件名
  PROCESSENTRY32W entry{sizeof(entry)};
  if (Process32FirstW(snapshot.get(), &entry)) {
    do {
      if (_wcsicmp(entry.szExeFile, kTargetProcessExe) == 0) {
        return entry.th32ProcessID;
      }
    } while (Process32NextW(snapshot.get(), &entry));
  }
  return 0;
}

// 捕获前台窗口变化并向当前 UI 线程投递异步通知消息
auto CALLBACK win_event_proc(HWINEVENTHOOK, DWORD event, HWND, LONG object_id, LONG, DWORD, DWORD)
    -> void {
  // 仅响应窗口对象激活的前台切换事件
  if (event == EVENT_SYSTEM_FOREGROUND && object_id == OBJID_WINDOW) {
    // OUTOFCONTEXT 回调在安装钩子的 UI 线程执行，但 Win32 不提供用户上下文。
    // 只投递线程消息，由主循环用自己的 AppState 处理，不保存全局状态指针。
    PostThreadMessageW(GetCurrentThreadId(), kForegroundChangedMessage, 0, 0);
  }
}

}  // namespace

// 评估游戏焦点与限帧条件：获取状态 → 动态升降帧率限制 → 派发变更事件
auto refresh_status(AppState& state) -> void {
  auto& rtss = *state.rtss;
  // 检测 RTSS 服务与目标游戏运行状态
  const auto rtss_running = find_rtss_window() != nullptr;
  const auto game_pid = find_game_pid();
  const auto game_running = game_pid != 0;
  // 获取当前获得焦点的顶层窗口所属进程
  const auto foreground = GetForegroundWindow();
  DWORD foreground_pid = 0;
  if (foreground) {
    GetWindowThreadProcessId(foreground, &foreground_pid);
  }
  // 游戏后台且启用了限制开关时触发限帧
  const auto game_focused = game_running && foreground_pid == game_pid;
  const auto should_limit =
      state.config.rtss_hang_limit_enabled && rtss_running && game_running && !game_focused;
  auto is_limiting = rtss.status.is_limiting;
  // 根据目标状态按需开启或清除帧率限制
  if (should_limit && !is_limiting) {
    if (set_limit(rtss, state.config.rtss_hang_limit_fps)) {
      is_limiting = true;
    }
  } else if (!should_limit && is_limiting) {
    clear_limit(rtss);
    is_limiting = false;
  }

  // 构建最新状态快照
  const RtssStatus status{
      .available = rtss_running,
      .game_running = game_running,
      .game_focused = game_focused,
      .is_limiting = is_limiting,
  };
  // 状态发生变化时通知页面监听方
  if (status.available != rtss.status.available ||
      status.game_running != rtss.status.game_running ||
      status.game_focused != rtss.status.game_focused ||
      status.is_limiting != rtss.status.is_limiting) {
    rtss.status = status;
    if (rtss.status_callback) {
      rtss.status_callback(rtss.status);
    }
  }
}

// 注册状态回调、加载 RTSS 库并设置前台事件钩子和心跳定时器
auto initialize(AppState& state, std::function<void(const RtssStatus&)> status_callback) -> void {
  auto& rtss = *state.rtss;
  // 绑定状态变更回调
  rtss.status_callback = std::move(status_callback);
  // 预加载 RTSS 接口
  load_api(rtss);
  // 安装前台窗口变更全局系统事件钩子
  if (!rtss.event_hook) {
    rtss.event_hook =
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, win_event_proc,
                        0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  }
  // 启动兜底轮询定时器以防钩子漏事件
  if (!rtss.heartbeat_timer) {
    rtss.heartbeat_timer = SetTimer(state.window, kHeartbeatTimer, 1500, nullptr);
  }
  // 初始立即评估一次状态
  refresh_status(state);
}

// 移除定时器与系统钩子、清除游戏限帧设置并卸载 RTSS 动态库
auto shutdown(AppState& state) -> void {
  auto& rtss = *state.rtss;
  // 清理心跳定时器
  if (rtss.heartbeat_timer) {
    KillTimer(state.window, rtss.heartbeat_timer);
    rtss.heartbeat_timer = 0;
  }
  // 注销窗口系统钩子
  if (rtss.event_hook) {
    UnhookWinEvent(rtss.event_hook);
    rtss.event_hook = nullptr;
  }
  // 退出前恢复游戏无限制帧率
  if (rtss.status.is_limiting) {
    clear_limit(rtss);
    rtss.status.is_limiting = false;
  }
  // 卸载 RTSS 模块并释放回调
  unload_api(rtss);
  rtss.status_callback = {};
}

// 获取当前 RTSS 运行及限帧状态快照
auto get_status(const AppState& state) -> RtssStatus { return state.rtss->status; }

}  // namespace desktop::rtss

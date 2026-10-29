#include "system_utils.hpp"

#include "vendor/std.hpp"

#include "vendor/wil.hpp"
#include "vendor/windows/shellapi.hpp"
#include "vendor/windows/shlobj.hpp"

#include "app_state.hpp"

namespace desktop::system {

namespace {

constexpr auto kMutexName = L"Local\\BuildingMomo_SingleInstance_Mutex";
constexpr auto kMarkerFileName = L"no_admin";

}  // namespace

// 获取单实例互斥锁：创建命名互斥体 → 探测是否已有实例运行
auto acquire_single_instance_lock(AppState& state) -> bool {
  // 创建或打开当前会话专属的命名互斥体
  state.instance_mutex.reset(CreateMutexW(nullptr, FALSE, kMutexName));
  if (!state.instance_mutex) {
    return false;
  }
  // 互斥体已存在说明已有实例正在运行，放弃锁并返回失败
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    state.instance_mutex.reset();
    return false;
  }
  return true;
}

// 释放单实例互斥体句柄
auto release_single_instance_lock(AppState& state) -> void { state.instance_mutex.reset(); }

// 查找已存在的主窗口并向其投递窗口激活消息
auto activate_existing_instance() -> void {
  // 寻找已运行实例的主窗口句柄
  HWND hwnd = FindWindowW(kMainWindowClass, nullptr);
  // 向已有窗口投递前台激活通知
  if (hwnd) {
    PostMessageW(hwnd, kActivateInstanceMessage, 0, 0);
  }
}

// 检查当前进程访问令牌中是否包含管理员组 SID
auto is_process_elevated() -> bool {
  static const bool result = []() {
    BYTE admin_sid[SECURITY_MAX_SID_SIZE]{};
    DWORD sid_size = sizeof(admin_sid);
    // 生成 Windows 内置管理员组 SID
    if (!CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, &admin_sid, &sid_size)) {
      return false;
    }
    BOOL is_admin = FALSE;
    // 校验当前进程令牌是否拥有管理员权限
    if (!CheckTokenMembership(nullptr, admin_sid, &is_admin)) {
      return false;
    }
    return is_admin != FALSE;
  }();
  return result;
}

// 启动自身副本并请求管理员提权：取可执行路径 → 配置 runas 参数 → 同步执行 ShellExecuteEx
auto restart_as_elevated(const wchar_t* arguments) -> bool {
  wchar_t exe_path[MAX_PATH]{};
  // 获取当前进程可执行文件路径
  if (GetModuleFileNameW(nullptr, exe_path, MAX_PATH) == 0) {
    return false;
  }

  // 配置 UAC 提权启动参数并阻塞等待启动结果
  SHELLEXECUTEINFOW exec_info{
      .cbSize = sizeof(exec_info),
      .fMask = SEE_MASK_NOASYNC,
      .lpVerb = L"runas",
      .lpFile = exe_path,
      .lpParameters = arguments,
      .nShow = SW_SHOWNORMAL,
  };

  return ShellExecuteExW(&exec_info) != FALSE;
}

// 查询系统 LocalAppData 路径并拼装 BuildingMomo 数据子目录
auto get_app_data_folder() -> std::filesystem::path {
  wil::unique_cotaskmem_string local_app_data;
  // 获取系统的已知 LocalAppData 文件夹绝对路径
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, local_app_data.put()))) {
    return std::filesystem::path(local_app_data.get()) / L"BuildingMomo";
  }
  return {};
}

// 检测应用数据目录下是否存在 no_admin 标记文件
auto has_no_admin_marker() -> bool {
  auto folder = get_app_data_folder();
  if (folder.empty()) {
    return false;
  }
  // 检查标记文件属性，确认其存在且不是文件夹
  auto marker_file = folder / kMarkerFileName;
  DWORD attrs = GetFileAttributesW(marker_file.c_str());
  return (attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY));
}

// 创建或删除 no_admin 标记文件以切换启动时的提权策略
auto set_no_admin_marker(bool disable_admin) -> void {
  auto folder = get_app_data_folder();
  if (folder.empty()) {
    return;
  }
  // 确保存储目录已创建
  std::error_code ec;
  std::filesystem::create_directories(folder, ec);
  auto marker_file = folder / kMarkerFileName;

  if (disable_admin) {
    // 禁用提权：创建标记文件
    wil::unique_handle file(CreateFileW(marker_file.c_str(), GENERIC_WRITE, 0, nullptr,
                                        CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
  } else {
    // 允许提权：删除标记文件
    DeleteFileW(marker_file.c_str());
  }
}

}  // namespace desktop::system

#pragma once

#include "vendor/std.hpp"

#include "vendor/windows.hpp"

namespace desktop {
struct AppState;
}

namespace desktop::system {

inline constexpr UINT kActivateInstanceMessage = WM_APP + 101;
inline constexpr auto kMainWindowClass = L"BuildingMomoDesktopWindow";

// 获取单实例互斥锁；已存在同名实例时返回 false
auto acquire_single_instance_lock(AppState& state) -> bool;
// 释放单实例互斥锁
auto release_single_instance_lock(AppState& state) -> void;
// 查找并向已运行的主窗口投递激活消息
auto activate_existing_instance() -> void;

// 检查当前进程是否具备管理员提权权限
auto is_process_elevated() -> bool;
// 使用管理员权限以 runas 重新启动当前可执行文件
auto restart_as_elevated(const wchar_t* arguments) -> bool;

// 获取应用程序专属的 LocalAppData 数据路径
auto get_app_data_folder() -> std::filesystem::path;
// 检查用户是否配置了禁用管理员权限的标记文件
auto has_no_admin_marker() -> bool;
// 创建或删除禁用管理员权限的标记文件
auto set_no_admin_marker(bool disable_admin) -> void;

}  // namespace desktop::system

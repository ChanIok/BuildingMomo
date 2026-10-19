#pragma once

#include <windows.h>
#include <filesystem>

namespace desktop {

constexpr UINT kActivateInstanceMessage = WM_APP + 101;
constexpr const wchar_t* kMainWindowClass = L"BuildingMomoDesktopWindow";

bool acquire_single_instance_lock();
void release_single_instance_lock();
void activate_existing_instance();

bool is_process_elevated();
bool restart_as_elevated(const wchar_t* arguments);

std::filesystem::path get_app_data_folder();
bool has_no_admin_marker();
void set_no_admin_marker(bool disable_admin);

}  // namespace desktop

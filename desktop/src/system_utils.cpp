#include "system_utils.hpp"

#include <shlobj.h>
#include <shellapi.h>
#include <wil/resource.h>

namespace desktop {

namespace {

constexpr auto kMutexName = L"Local\\BuildingMomo_SingleInstance_Mutex";
constexpr auto kMarkerFileName = L"no_admin";

HANDLE g_instance_mutex = nullptr;

}  // namespace

bool acquire_single_instance_lock() {
  g_instance_mutex = CreateMutexW(nullptr, FALSE, kMutexName);
  if (!g_instance_mutex) {
    return false;
  }
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    CloseHandle(g_instance_mutex);
    g_instance_mutex = nullptr;
    return false;
  }
  return true;
}

void release_single_instance_lock() {
  if (g_instance_mutex) {
    CloseHandle(g_instance_mutex);
    g_instance_mutex = nullptr;
  }
}

void activate_existing_instance() {
  HWND hwnd = FindWindowW(kMainWindowClass, nullptr);
  if (hwnd) {
    PostMessageW(hwnd, kActivateInstanceMessage, 0, 0);
  }
}

bool is_process_elevated() {
  static bool result = []() {
    BYTE admin_sid[SECURITY_MAX_SID_SIZE]{};
    DWORD sid_size = sizeof(admin_sid);
    if (!CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, &admin_sid, &sid_size)) {
      return false;
    }
    BOOL is_admin = FALSE;
    if (!CheckTokenMembership(nullptr, admin_sid, &is_admin)) {
      return false;
    }
    return is_admin != FALSE;
  }();
  return result;
}

bool restart_as_elevated(const wchar_t* arguments) {
  wchar_t exe_path[MAX_PATH]{};
  if (GetModuleFileNameW(nullptr, exe_path, MAX_PATH) == 0) {
    return false;
  }

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

std::filesystem::path get_app_data_folder() {
  wil::unique_cotaskmem_string local_app_data;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, local_app_data.put()))) {
    return std::filesystem::path(local_app_data.get()) / L"BuildingMomo";
  }
  return {};
}

bool has_no_admin_marker() {
  auto folder = get_app_data_folder();
  if (folder.empty()) {
    return false;
  }
  auto marker_file = folder / kMarkerFileName;
  DWORD attrs = GetFileAttributesW(marker_file.c_str());
  return (attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY));
}

void set_no_admin_marker(bool disable_admin) {
  auto folder = get_app_data_folder();
  if (folder.empty()) {
    return;
  }
  std::error_code ec;
  std::filesystem::create_directories(folder, ec);
  auto marker_file = folder / kMarkerFileName;

  if (disable_admin) {
    HANDLE hFile = CreateFileW(marker_file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                               FILE_ATTRIBUTE_NORMAL, nullptr);
    if (hFile != INVALID_HANDLE_VALUE) {
      CloseHandle(hFile);
    }
  } else {
    DeleteFileW(marker_file.c_str());
  }
}

}  // namespace desktop

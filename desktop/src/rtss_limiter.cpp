#include "rtss_limiter.hpp"

#include <tlhelp32.h>
#include <wil/resource.h>

#include <string>
#include <string_view>

namespace desktop {

namespace {

constexpr DWORD kRtssHookFlagLimiterDisabled = 4;
constexpr UINT kWmRtssUpdateSettings = WM_APP + 100;
constexpr const char* kTargetProcessName = "X6Game-Win64-Shipping.exe";
constexpr const wchar_t* kTargetProcessExe = L"X6Game-Win64-Shipping.exe";

using EnumProfilesFn = DWORD (*)(LPSTR, DWORD);
using LoadProfileFn = void (*)(LPCSTR);
using SaveProfileFn = void (*)(LPCSTR);
using GetProfilePropertyFn = BOOL (*)(LPCSTR, LPBYTE, DWORD);
using SetProfilePropertyFn = BOOL (*)(LPCSTR, LPBYTE, DWORD);
using UpdateProfilesFn = void (*)();
using SetFlagsFn = DWORD (*)(DWORD, DWORD);
using GetFlagsFn = DWORD (*)();

class RtssApi {
 public:
  ~RtssApi() { unload(); }

  bool load() {
    if (hooks_dll_) {
      return true;
    }

    HKEY key = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "Software\\WOW6432Node\\Unwinder\\RTSS", 0, KEY_READ,
                      &key) != ERROR_SUCCESS) {
      return false;
    }

    char install_dir[MAX_PATH]{};
    DWORD size = MAX_PATH;
    DWORD type = 0;
    const auto result = RegQueryValueExA(key, "InstallDir", nullptr, &type,
                                         reinterpret_cast<LPBYTE>(install_dir), &size);
    RegCloseKey(key);

    if (result != ERROR_SUCCESS || type != REG_SZ) {
      return false;
    }

    std::string dll_path = std::string(install_dir) + "\\RTSSHooks64.dll";
    hooks_dll_ = LoadLibraryA(dll_path.c_str());
    if (!hooks_dll_) {
      return false;
    }

    load_profile_ = reinterpret_cast<LoadProfileFn>(GetProcAddress(hooks_dll_, "LoadProfile"));
    save_profile_ = reinterpret_cast<SaveProfileFn>(GetProcAddress(hooks_dll_, "SaveProfile"));
    set_profile_property_ = reinterpret_cast<SetProfilePropertyFn>(
        GetProcAddress(hooks_dll_, "SetProfileProperty"));
    update_profiles_ =
        reinterpret_cast<UpdateProfilesFn>(GetProcAddress(hooks_dll_, "UpdateProfiles"));
    set_flags_ = reinterpret_cast<SetFlagsFn>(GetProcAddress(hooks_dll_, "SetFlags"));

    if (!load_profile_ || !save_profile_ || !set_profile_property_ || !update_profiles_ ||
        !set_flags_) {
      unload();
      return false;
    }
    return true;
  }

  void unload() {
    if (hooks_dll_) {
      FreeLibrary(hooks_dll_);
      hooks_dll_ = nullptr;
    }
    load_profile_ = nullptr;
    save_profile_ = nullptr;
    set_profile_property_ = nullptr;
    update_profiles_ = nullptr;
    set_flags_ = nullptr;
  }

  bool is_loaded() const { return hooks_dll_ != nullptr; }

  static HWND find_rtss_window() {
    HWND window = FindWindowA(nullptr, "RTSS");
    if (!window) {
      window = FindWindowA(nullptr, "RivaTuner Statistics Server");
    }
    return window;
  }

  bool set_limit(int fps) {
    if (!load()) {
      return false;
    }
    load_profile_(kTargetProcessName);
    DWORD value = static_cast<DWORD>(fps);
    if (!set_profile_property_("FramerateLimit", reinterpret_cast<LPBYTE>(&value), sizeof(value))) {
      return false;
    }
    save_profile_(kTargetProcessName);
    update_profiles_();
    set_flags_(~kRtssHookFlagLimiterDisabled, 0);

    if (HWND window = find_rtss_window()) {
      PostMessageA(window, kWmRtssUpdateSettings, 0, 0);
    }
    return true;
  }

  bool clear_limit() {
    if (!is_loaded()) {
      return true;
    }
    load_profile_(kTargetProcessName);
    DWORD value = 0;
    set_profile_property_("FramerateLimit", reinterpret_cast<LPBYTE>(&value), sizeof(value));
    save_profile_(kTargetProcessName);
    update_profiles_();
    set_flags_(~kRtssHookFlagLimiterDisabled, kRtssHookFlagLimiterDisabled);

    if (HWND window = find_rtss_window()) {
      PostMessageA(window, kWmRtssUpdateSettings, 0, 0);
    }
    return true;
  }

 private:
  HMODULE hooks_dll_ = nullptr;
  LoadProfileFn load_profile_ = nullptr;
  SaveProfileFn save_profile_ = nullptr;
  SetProfilePropertyFn set_profile_property_ = nullptr;
  UpdateProfilesFn update_profiles_ = nullptr;
  SetFlagsFn set_flags_ = nullptr;
};

RtssApi g_rtss;
HWINEVENTHOOK g_event_hook = nullptr;
UINT_PTR g_heartbeat_timer = 0;
RtssStatusCallback g_status_callback;

bool g_config_enabled = false;
int g_config_target_fps = 15;
RtssStatus g_current_status{};

DWORD find_game_pid() {
  wil::unique_handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (!snapshot) {
    return 0;
  }
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

void evaluate_and_apply() {
  bool rtss_running = RtssApi::find_rtss_window() != nullptr;
  DWORD game_pid = find_game_pid();
  bool game_running = (game_pid != 0);

  HWND foreground = GetForegroundWindow();
  DWORD foreground_pid = 0;
  if (foreground) {
    GetWindowThreadProcessId(foreground, &foreground_pid);
  }
  bool game_focused = game_running && (foreground_pid == game_pid);

  bool should_limit = g_config_enabled && rtss_running && game_running && !game_focused;

  if (should_limit && !g_current_status.is_limiting) {
    if (g_rtss.set_limit(g_config_target_fps)) {
      g_current_status.is_limiting = true;
    }
  } else if (!should_limit && g_current_status.is_limiting) {
    g_rtss.clear_limit();
    g_current_status.is_limiting = false;
  }

  RtssStatus new_status{
      .available = rtss_running,
      .game_running = game_running,
      .game_focused = game_focused,
      .is_limiting = g_current_status.is_limiting,
  };

  if (new_status.available != g_current_status.available ||
      new_status.game_running != g_current_status.game_running ||
      new_status.game_focused != g_current_status.game_focused ||
      new_status.is_limiting != g_current_status.is_limiting) {
    g_current_status = new_status;
    if (g_status_callback) {
      g_status_callback(g_current_status);
    }
  }
}

void CALLBACK win_event_proc(HWINEVENTHOOK, DWORD event, HWND, LONG idObject, LONG, DWORD, DWORD) {
  if (event == EVENT_SYSTEM_FOREGROUND && idObject == OBJID_WINDOW) {
    evaluate_and_apply();
  }
}

VOID CALLBACK heartbeat_timer_proc(HWND, UINT, UINT_PTR, DWORD) {
  evaluate_and_apply();
}

}  // namespace

void init_rtss_limiter(RtssStatusCallback status_callback) {
  g_status_callback = std::move(status_callback);
  g_rtss.load();

  if (!g_event_hook) {
    g_event_hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr,
                                   win_event_proc, 0, 0,
                                   WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  }
  if (!g_heartbeat_timer) {
    g_heartbeat_timer = SetTimer(nullptr, 0, 1500, heartbeat_timer_proc);
  }
  evaluate_and_apply();
}

void shutdown_rtss_limiter() {
  if (g_heartbeat_timer) {
    KillTimer(nullptr, g_heartbeat_timer);
    g_heartbeat_timer = 0;
  }
  if (g_event_hook) {
    UnhookWinEvent(g_event_hook);
    g_event_hook = nullptr;
  }
  if (g_current_status.is_limiting) {
    g_rtss.clear_limit();
    g_current_status.is_limiting = false;
  }
  g_rtss.unload();
  g_status_callback = nullptr;
}

void update_rtss_config(bool enabled, int target_fps) {
  g_config_enabled = enabled;
  g_config_target_fps = (target_fps > 0) ? target_fps : 15;
  evaluate_and_apply();
}

void refresh_rtss_status() {
  evaluate_and_apply();
}

RtssStatus get_rtss_status() {
  return g_current_status;
}

}  // namespace desktop

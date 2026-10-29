#pragma once

#include "vendor/std.hpp"

#include "vendor/wil.hpp"
#include "vendor/windows.hpp"

#include "rtss/rtss_limiter.hpp"

namespace desktop::rtss {

using LoadProfileFn = void (*)(LPCSTR);
using SaveProfileFn = void (*)(LPCSTR);
using SetProfilePropertyFn = BOOL (*)(LPCSTR, LPBYTE, DWORD);
using UpdateProfilesFn = void (*)();
using SetFlagsFn = DWORD (*)(DWORD, DWORD);

struct RtssState {
  // 全部在 UI 线程访问；关闭钩子与定时器后才能释放 DLL。
  wil::unique_hmodule hooks_dll;
  LoadProfileFn load_profile = nullptr;
  SaveProfileFn save_profile = nullptr;
  SetProfilePropertyFn set_profile_property = nullptr;
  UpdateProfilesFn update_profiles = nullptr;
  SetFlagsFn set_flags = nullptr;

  HWINEVENTHOOK event_hook = nullptr;
  UINT_PTR heartbeat_timer = 0;
  std::function<void(const RtssStatus&)> status_callback;
  RtssStatus status;
};

}  // namespace desktop::rtss

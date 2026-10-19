#include "webview.hpp"

#include "app.hpp"
#include "desktop_bridge.hpp"

#include <shellapi.h>
#include <shlobj.h>
#include <wil/resource.h>
#include <wrl.h>

#include <filesystem>
#include <format>

namespace desktop {

namespace {

auto is_app_url(std::wstring_view url) -> bool {
  if (!url.starts_with(kAppOrigin)) {
    return false;
  }
  return url.size() == kAppOrigin.size() || url[kAppOrigin.size()] == L'/' ||
         url[kAppOrigin.size()] == L'?' || url[kAppOrigin.size()] == L'#';
}

auto open_external_url(HWND window, std::wstring_view url) -> void {
  // 只向系统浏览器交付网页链接，不从网页启动任意本地协议或可执行文件。
  if (url.starts_with(L"https://") || url.starts_with(L"http://")) {
    auto result = reinterpret_cast<INT_PTR>(
        ShellExecuteW(window, L"open", std::wstring(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    if (result <= 32) {
      OutputDebugStringW(L"[BuildingMomo] Failed to open external link.\n");
    }
  }
}

auto configure_webview(AppState& state) -> HRESULT {
  auto result = state.controller->get_CoreWebView2(state.webview.put());
  if (FAILED(result)) {
    return result;
  }
  wil::com_ptr<ICoreWebView2Settings> settings;
  result = state.webview->get_Settings(settings.put());
  if (FAILED(result)) {
    return result;
  }
  // 允许页面与宿主通过 WebMessage 通信，不向页面暴露原生 COM 对象。
  result = settings->put_AreHostObjectsAllowed(FALSE);
  if (FAILED(result)) {
    return result;
  }
  result = settings->put_IsWebMessageEnabled(TRUE);
  if (FAILED(result)) {
    return result;
  }

  EventRegistrationToken token{};
  result = state.webview->add_NavigationStarting(
      Microsoft::WRL::Callback<ICoreWebView2NavigationStartingEventHandler>(
          [&state](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string uri;
            auto result = args->get_Uri(uri.put());
            if (FAILED(result)) {
              return result;
            }
            if (!is_app_url(uri.get())) {
              args->put_Cancel(TRUE);
              open_external_url(state.window, uri.get());
            }
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }
  result = state.webview->add_NewWindowRequested(
      Microsoft::WRL::Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [&state](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            args->put_Handled(TRUE);
            wil::unique_cotaskmem_string uri;
            auto result = args->get_Uri(uri.put());
            if (FAILED(result)) {
              return result;
            }
            open_external_url(state.window, uri.get());
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }

  result = state.webview->add_WindowCloseRequested(
      Microsoft::WRL::Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
          [&state](ICoreWebView2*, IUnknown*) -> HRESULT {
            PostMessageW(state.window, WM_CLOSE, 0, 0);
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }

  result = state.webview->add_WebMessageReceived(
      Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string raw_message;
            if (SUCCEEDED(args->get_WebMessageAsJson(raw_message.put())) && raw_message) {
              handle_web_message(raw_message.get());
            }
            return S_OK;
          })
          .Get(),
      &token);
  if (FAILED(result)) {
    return result;
  }

  init_desktop_bridge(state.webview.get());

  resize_webview(state);
  state.controller->put_IsVisible(!IsIconic(state.window));
  if (GetForegroundWindow() == state.window) {
    state.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  }
  return state.webview->Navigate(std::wstring(kAppOrigin).c_str());
}

}  // namespace

auto initialize_webview(AppState& state) -> std::expected<void, std::wstring> {
  wil::unique_cotaskmem_string local_app_data;
  auto result = SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, local_app_data.put());
  if (FAILED(result)) {
    return std::unexpected(L"无法定位本地应用数据目录。");
  }
  const auto folder =
      std::filesystem::path(local_app_data.get()) / L"BuildingMomo" / L"WebView2";
  std::error_code error;
  std::filesystem::create_directories(folder, error);
  if (error) {
    return std::unexpected(L"无法创建 WebView2 数据目录。错误码：" +
                           std::to_wstring(error.value()));
  }
  state.user_data_folder = folder.wstring();

  result = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, state.user_data_folder.c_str(), nullptr,
      Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [&state](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            if (state.shutting_down) {
              return S_OK;
            }
            if (FAILED(result)) {
              report_webview_error(state, L"创建 WebView2 环境", result);
              return S_OK;
            }
            state.environment = environment;
            watch_gpu_processes(state.environment.get(), state.gpu_priority);
            result = environment->CreateCoreWebView2Controller(
                state.window,
                Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [&state](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                      if (state.shutting_down) {
                        if (controller) {
                          controller->Close();
                        }
                        return S_OK;
                      }
                      if (SUCCEEDED(result)) {
                        state.controller = controller;
                        result = configure_webview(state);
                      }
                      if (FAILED(result)) {
                        report_webview_error(state, L"初始化 WebView2 窗口", result);
                      }
                      return S_OK;
                    })
                    .Get());
            if (FAILED(result)) {
              report_webview_error(state, L"创建 WebView2 窗口", result);
            }
            return S_OK;
          })
          .Get());
  if (FAILED(result)) {
    return std::unexpected(std::format(
        L"无法启动 WebView2（HRESULT: 0x{:08X}）。\n请安装 Microsoft Edge WebView2 Runtime 后重试。",
        static_cast<unsigned long>(result)));
  }
  return {};
}

auto resize_webview(AppState& state) -> void {
  if (state.controller && !state.shutting_down) {
    RECT bounds{};
    GetClientRect(state.window, &bounds);
    state.controller->put_Bounds(bounds);
    state.controller->put_IsVisible(!IsIconic(state.window));
  }
}

}  // namespace desktop

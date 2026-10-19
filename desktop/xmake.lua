set_project("BuildingMomoDesktop")
set_version("0.1.0")
set_languages("c++23")
set_allowedplats("windows")
set_allowedarchs("x64")
add_rules("mode.debug", "mode.release")
set_config("toolchain", "clang-cl[llvm]")
set_runtimes(is_mode("debug") and "MDd" or "MT")

-- 与 SpinningMomo 使用同一份 vcpkg 快照，静态链接 WebView2 Loader。
set_policy("package.requires_lock", true)
add_requireconfs("vcpkg::*", {
    configs = {baseline = "1ea949145db9db7c9b254062f94acdaeed947767"}
})
add_requires("vcpkg::webview2", "vcpkg::wil")

target("BuildingMomo")
    set_kind("binary")
    add_files("src/*.cpp", "resources/app.rc")
    add_includedirs("src", "resources")
    add_packages("vcpkg::webview2", "vcpkg::wil")
    add_defines("UNICODE", "_UNICODE", "NOMINMAX", "WIN32_LEAN_AND_MEAN", "_WIN32_WINNT=0x0A00")
    add_cxflags("/utf-8")
    add_links("user32", "gdi32", "shell32", "ole32", "shlwapi", "version", "advapi32")
    -- manifest 由 app.rc 嵌入，避免链接器再生成另一份清单。
    add_ldflags("/SUBSYSTEM:WINDOWS", "/MANIFEST:NO", {force = true})
    if is_mode("debug") then
        add_defines("BUILDINGMOMO_DESKTOP_DEBUG")
    end

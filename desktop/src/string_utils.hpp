#pragma once

#include "vendor/std.hpp"

namespace desktop::string {

// 严格转换 UTF-8 / UTF-16；遇到非法编码或空输入返回空字符串
auto to_utf8(std::wstring_view value) -> std::string;
auto from_utf8(std::string_view value) -> std::wstring;

}  // namespace desktop::string

#include "string_utils.hpp"

#include "vendor/std.hpp"

#include "vendor/windows.hpp"

namespace desktop::string {

// UTF-16 转 UTF-8：空输入短路 → 探测目标缓冲区长度 → 执行严格转换
auto to_utf8(std::wstring_view value) -> std::string {
  // 空输入直接返回空字符串
  if (value.empty()) {
    return {};
  }
  // 计算目标 UTF-8 缓冲区所需字节数（遇到非法字符报错）
  const auto size =
      WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                          static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  // 转换失败或遇到非法字符返回空字符串
  if (size == 0) {
    return {};
  }
  // 分配目标空间并执行实际编码转换
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                      result.data(), size, nullptr, nullptr);
  return result;
}

// UTF-8 转 UTF-16：空输入短路 → 探测目标缓冲区长度 → 执行严格转换
auto from_utf8(std::string_view value) -> std::wstring {
  // 空输入直接返回空字符串
  if (value.empty()) {
    return {};
  }
  // 计算目标 UTF-16 缓冲区所需字符数（遇到非法字符报错）
  const auto size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                        static_cast<int>(value.size()), nullptr, 0);
  // 转换失败或遇到非法字符返回空字符串
  if (size == 0) {
    return {};
  }
  // 分配目标空间并执行实际编码转换
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                      result.data(), size);
  return result;
}

}  // namespace desktop::string

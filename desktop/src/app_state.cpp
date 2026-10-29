#include "app_state.hpp"

#include "vendor/std.hpp"

#include "gpu_priority/state.hpp"
#include "mcp/state.hpp"
#include "rtss/state.hpp"

namespace desktop {

// 构建应用全局状态：分配 GPU 优先级、MCP 服务及 RTSS 限帧等子系统状态容器
AppState::AppState()
    : gpu_priority(std::make_unique<gpu_priority::GpuPriorityState>()),
      mcp(std::make_unique<mcp::McpServerState>()),
      rtss(std::make_unique<rtss::RtssState>()) {}

// 销毁应用全局状态并按顺序析构子系统容器
AppState::~AppState() = default;

}  // namespace desktop

# TresJS 渲染模式切换修复

`@tresjs__core@5.9.3.patch` 在渲染模式变化时重置待渲染帧数：进入 `always` 或 `on-demand` 时设为 `1`，进入 `manual` 时设为 `0`。切换模式不再继承上一模式的帧预算，避免恢复持续渲染时冻结、按需模式缺少首帧或手动模式意外绘制。

对应 [TresJS PR #1488](https://github.com/Tresjs/tres/pull/1488) 的模式切换修复；保留原有绘制条件和显式完成通知，不引入零参数绘制函数的自动完成逻辑。

修复通过 `pnpm-workspace.yaml` 注册，使用 `pnpm install --frozen-lockfile` 安装时自动应用；不需要修改相机、交互或场景生命周期。

`tests/composables/renderMode.spec.ts` 直接测试安装后的 TresJS 调度器，覆盖三种模式间的切换、反复开关、按需刷新合并及自定义绘制完成通知。

升级 TresJS 时，先确认目标版本已修复模式切换时的帧预算，再移除依赖修复文件和注册项、更新依赖版本及锁文件，并运行上述回归测试。

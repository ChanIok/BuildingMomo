# Viewport (`src/lib/viewport`)

视口相机构图、裁剪面与渲染预算/档位的纯计算模块。

- `cameraUtils.ts`：视图预设位姿、正交/透视缩放换算与向量数学。
- `cameraClipRange.ts`：基于世界包围盒的动态远裁面计算。
- `spatialBounds.ts`：相机构图用世界空间 AABB 与超大场景降级策略（不与变换 Pivot 混用）。
- `renderInstanceBudget.ts` / `renderQuality.ts`：实例预算上限与渲染画质档位定义。

边界：禁止依赖 `stores/` 或 `composables/`；运行时模型包围盒与 Store 查询通过 `WorldBoundsProvider` 回调注入。

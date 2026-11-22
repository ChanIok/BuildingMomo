# Transform (`src/lib/transform`)

坐标空间、缩放轴映射、选择变换与显示补偿的纯数学契约。修改坐标或缩放语义时，需联查本目录全部文件以及 Gizmo、侧栏输入和渲染矩阵。

- `matrixTransform.ts`：数据空间 ↔ Three.js 世界空间矩阵与视觉旋转互转。
- `coordinateTransform.ts`：全局空间 ↔ 工作坐标系位置转换。
- `rotationTransform.ts`：工作坐标系下的组合相对旋转（ZYX 欧拉、视觉 Z 取反）。
- `selectionScaleTransform.ts`：视觉 X/Y/Z → 存档 `Scale.Y/X/Z` 唯一轴映射与共同合法倍率缩放。
- `selectionTransform.ts`：固定顺序 `Scale → Rotate → Translate` 相对组合变换。
- `scaleLimits.ts`：float32 缩放合法性校验（编辑、Worker 验证、导出共用）。
- `scaleRenderCompensation.ts`：特定家具缩放锚点漂移的显示补偿（不得写回存档）。

边界：禁止依赖 `stores/`、`composables/` 或 Vue 响应式状态；家具尺寸等外部规则由调用方显式传入。

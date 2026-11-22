# Geometry (`src/lib/geometry`)

空间边界、碰撞相交、对齐吸附与特殊几何的纯计算模块。

- `collision.ts`：OBB / AABB 几何边界与相交检测。
- `geometry.ts`：选中家具轴点包围盒中心（用于变换 Pivot，不与相机构图混用）。
- `alignmentHelpers.ts`：基于显示矩阵与 OBB 的对齐、分布辅助计算。
- `translationSnap.ts`：平移吸附求解器。
- `slidePath.ts`：飞花道点位坐标转换、包围盒与不可变更新。
- `screenGeometry.ts`：屏幕空间矩形/套索几何相交判断。

边界：禁止依赖 `stores/`、`composables/` 或 Vue 响应式状态。

# Environment (`src/lib/environment`)

家园昼夜（TOD）、大气散射、天空与环境的静态配置数据及纯计算模型。

- `homeTodData.ts` / `homeTod.ts`：时间曲线关键帧数据与昼夜参数插值。
- `homeAtmosphere.ts`：大气/光照颜色与雾效计算。
- `homeSkyData.ts` / `homeEnvironmentData.ts`：天空、远山与环境基础常量数据。

边界：纯数据与数学计算，禁止依赖 Three.js 场景实例、`stores/` 或 `composables/`；Three.js 构建与视口装配位于 `src/composables/environment/`。

# Environment (`src/composables/environment`)

家园环境渲染子系统：昼夜天空盒、远山、地形水面、PMREM 光照、背景图与环境过渡。

- 视口装配：`useThreeEnvironment.ts`、`useThreeBackground.ts`、`useHomeTerrain.ts`
- Three.js 构建与过渡：`homeSky.ts`、`homeMountains.ts`、`homeTerrainWater.ts`、`homeOutput.ts`、`homeTodCurve.ts`、`preparePmrem.ts`、`environmentTransition.ts`

边界：依赖 `src/lib/environment/` 的纯昼夜/大气数据，与家具实例化渲染引擎（`src/composables/renderer/`）解耦。

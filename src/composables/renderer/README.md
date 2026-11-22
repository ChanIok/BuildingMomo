# Furniture Renderer (`src/composables/renderer`)

家具实例化渲染引擎、飞花道渲染与模型/图标共享资源管理。

- 入口与核心：`index.ts`、`core.ts`、`types.ts`、`bvh.ts`、`useSlidePathRenderer.ts`
- 渲染模式与实例共享：`modes/`（box / simple-box / icon / model）、`shared/`（实例矩阵、颜色、轮廓、异步射线检测）
- 共享资源管理：`useFurnitureRender.ts`、`furnitureRenderState.ts`、`useThreeModelManager.ts`、`useThreeIconManager.ts`、`useIconLoader.ts`

边界：`@nuan5-pro/render` 共享上下文生命周期由 `useFurnitureRender.ts` 统一托管，业务消费者不得自行释放库拥有的资源。

# Viewport (`src/composables/viewport`)

3D 视口的相机控制、输入路由、拾取选区、Gizmo、离屏截图与帧率监控，主要由 `ThreeEditor.vue` 装配。

- 相机与网格：`useThreeCamera.ts`、`useCameraInputConfig.ts`、`useOrbitControlsInput.ts`、`useThreeGrid.ts`
- 输入与拾取：`useThreePointerRouter.ts`、`useThreeSelection.ts`、`useEditorSelectionAction.ts`、`useThreeTooltip.ts`
- 变换控制器：`gizmo/useThreeTransformGizmo.ts` 及外观、吸附、触控子模块
- 视口基础设施：`useSceneInvalidate.ts`、`sceneCapture.ts`、`useFpsMonitor.ts`、`gpuFrameTimer.ts`

边界：纯数学与构图边界计算位于 `src/lib/viewport/` 和 `src/lib/geometry/`；家具实例化渲染位于 `src/composables/renderer/`；家园天空/地形位于 `src/composables/environment/`。

import { computed, type Ref } from 'vue'
import { MOUSE, TOUCH } from 'three'
import type { useCameraInputConfig } from '@/composables/useCameraInputConfig'

type CameraInputConfig = ReturnType<typeof useCameraInputConfig>

interface UseOrbitControlsInputOptions {
  isOrthographic: Ref<boolean>
  isCoarsePointer: Ref<boolean>
}

const ORBIT_TOUCH_NONE = -1

/**
 * OrbitControls 输入映射（鼠标/触摸/开关）集中计算。
 * 仅负责映射策略，不处理 pointer 会话路由。
 */
export function useOrbitControlsInput(
  cameraInput: CameraInputConfig,
  options: UseOrbitControlsInputOptions
) {
  // 计算 OrbitControls 的鼠标按钮映射
  const orbitMouseButtons = computed(() => {
    // Alt+左键：启用相机控制（需要在设置中启用，且仅 Alt 按下）
    if (cameraInput.isAltCameraActive.value) {
      if (cameraInput.isOrthographic.value) {
        // 正交：Alt+左键平移
        return { LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }
      } else {
        // 透视：Alt+左键旋转
        return { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }
      }
    }

    // 如果在正交视图下按住空格键，左键临时用于平移
    if (cameraInput.isOrthographic.value && cameraInput.isSpacePressed.value) {
      return {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.ROTATE,
      }
    }

    // 如果是手形工具，左键用于平移（正交）或旋转（透视）
    if (cameraInput.currentTool.value === 'hand') {
      if (cameraInput.isOrthographic.value) {
        return {
          LEFT: MOUSE.PAN,
          MIDDLE: MOUSE.ROTATE, // 保持中键习惯
          RIGHT: MOUSE.ROTATE,
        }
      } else {
        return {
          LEFT: MOUSE.ROTATE,
          MIDDLE: MOUSE.PAN,
          RIGHT: MOUSE.PAN,
        }
      }
    }

    // 默认模式（选择工具）：左键留给框选，根据配置操作相机
    if (cameraInput.isOrthographic.value) {
      // 正交视图：始终使用平移
      return cameraInput.orbitRotateButton.value === 'right'
        ? { RIGHT: MOUSE.PAN }
        : { MIDDLE: MOUSE.PAN }
    } else {
      // 透视视图：根据配置使用旋转
      return cameraInput.orbitRotateButton.value === 'right'
        ? { RIGHT: MOUSE.ROTATE }
        : { MIDDLE: MOUSE.ROTATE }
    }
  })

  // 旋转开关：保持桌面原逻辑，是否可旋转由视图类型决定
  const orbitEnableRotate = computed(() => {
    return !options.isOrthographic.value
  })

  // 平移开关：
  // - 正交视图始终允许平移
  // - 透视视图仅在手形工具下允许平移（用于触屏单指拖拽平移）
  const orbitEnablePan = computed(() => {
    return (
      options.isOrthographic.value ||
      (cameraInput.currentTool.value === 'hand' && options.isCoarsePointer.value)
    )
  })

  // 触摸手势：默认单指用于选择；双指用于缩放/平移；手形工具保留单指相机操作
  const orbitTouches = computed(() => {
    if (cameraInput.currentTool.value === 'hand') {
      if (cameraInput.isOrthographic.value) {
        return { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }
      }
      // 透视 + 手形工具：单指平移，双指旋转+缩放（与 selection 透视双指一致）
      return { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }
    }

    // 选择工具：
    // - 正交视图：双指缩放+平移
    // - 透视视图：双指缩放+旋转（禁用平移）
    if (cameraInput.isOrthographic.value) {
      return { ONE: ORBIT_TOUCH_NONE, TWO: TOUCH.DOLLY_PAN }
    }
    return { ONE: ORBIT_TOUCH_NONE, TWO: TOUCH.DOLLY_ROTATE }
  })

  return {
    orbitMouseButtons,
    orbitEnableRotate,
    orbitEnablePan,
    orbitTouches,
  }
}

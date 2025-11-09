import { useKeyModifier, useMagicKeys, createSharedComposable } from '@vueuse/core'

/**
 * 统一的输入状态管理
 * 基于 VueUse 提供键盘修饰键状态跟踪
 * 使用 createSharedComposable 确保全局单例
 */
function _useInputState() {
  // 修饰键使用 useKeyModifier
  const isShiftPressed = useKeyModifier('Shift')
  const isAltPressed = useKeyModifier('Alt')
  const isCtrlPressed = useKeyModifier('Control')

  // 空格键使用 useMagicKeys（useKeyModifier 不支持非修饰键）
  const { space } = useMagicKeys()

  return {
    isShiftPressed,
    isAltPressed,
    isCtrlPressed,
    isSpacePressed: space,
  }
}

// 导出单例版本
export const useInputState = createSharedComposable(_useInputState)

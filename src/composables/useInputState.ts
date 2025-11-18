import {
  useKeyModifier,
  useMagicKeys,
  useEventListener,
  createSharedComposable,
} from '@vueuse/core'
import { ref, computed } from 'vue'

/**
 * 统一的输入状态管理
 * 全局单例，2D/3D 模块共享
 *
 * 提供：
 * - 修饰键：Shift, Alt, Ctrl (响应式布尔值)
 * - 导航键：W, A, S, D, Q, Space (响应式布尔值)
 * - 鼠标按钮：Left, Middle, Right (响应式布尔值)
 *
 * 使用 createSharedComposable 确保全局单例，避免重复监听
 */
function _useInputState() {
  // 修饰键：使用 useKeyModifier 获取响应式布尔值
  // useKeyModifier 可能返回 boolean | null，我们将其转换为纯 boolean
  const _isShiftPressed = useKeyModifier('Shift')
  const _isAltPressed = useKeyModifier('Alt')
  const _isCtrlPressed = useKeyModifier('Control')

  const isShiftPressed = computed(() => _isShiftPressed.value === true)
  const isAltPressed = computed(() => _isAltPressed.value === true)
  const isCtrlPressed = computed(() => _isCtrlPressed.value === true)

  // 导航键和空格键：使用 useMagicKeys（useKeyModifier 仅支持修饰键）
  const keys = useMagicKeys()

  // 3D 相机导航键：useMagicKeys 返回的键可能为 undefined，我们将其转换为确定的 ComputedRef<boolean>
  const w = computed(() => keys.w?.value === true)
  const a = computed(() => keys.a?.value === true)
  const s = computed(() => keys.s?.value === true)
  const d = computed(() => keys.d?.value === true)
  const q = computed(() => keys.q?.value === true)
  const space = computed(() => keys.space?.value === true)

  // 鼠标按钮状态：全局监听，确保即使鼠标移出画布也能捕获释放事件
  const isLeftMousePressed = ref(false)
  const isMiddleMousePressed = ref(false)
  const isRightMousePressed = ref(false)

  // 全局监听鼠标按下
  useEventListener(document, 'mousedown', (e: MouseEvent) => {
    if (e.button === 0) isLeftMousePressed.value = true
    if (e.button === 1) isMiddleMousePressed.value = true
    if (e.button === 2) isRightMousePressed.value = true
  })

  // 全局监听鼠标释放
  useEventListener(document, 'mouseup', (e: MouseEvent) => {
    if (e.button === 0) isLeftMousePressed.value = false
    if (e.button === 1) isMiddleMousePressed.value = false
    if (e.button === 2) isRightMousePressed.value = false
  })

  return {
    // 修饰键
    isShiftPressed,
    isAltPressed,
    isCtrlPressed,

    // 导航键 (3D 相机移动)
    w,
    a,
    s,
    d,
    q,
    space,

    // 向后兼容：保留旧 API
    isSpacePressed: space,

    // 鼠标按钮状态
    isLeftMousePressed,
    isMiddleMousePressed,
    isRightMousePressed,
  }
}

// 导出单例版本
export const useInputState = createSharedComposable(_useInputState)

import { computed } from 'vue'
import { useMagicKeys } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'

/**
 * 相机输入配置管理 Composable
 * 集中管理相机控制相关的输入配置和按键状态检测
 *
 * 职责：
 * - 读取 settingsStore 中的 inputBindings.camera 配置
 * - 检测修饰键状态（Alt、Ctrl、Shift）
 * - 计算派生状态（如 Alt+左键是否激活）
 * - 提供统一的框选禁用条件判断
 */
export function useCameraInputConfig() {
  const settingsStore = useSettingsStore()
  const uiStore = useUIStore()
  const editorStore = useEditorStore()

  // 监听修饰键状态
  const { alt, ctrl, shift, space } = useMagicKeys()

  // ============================================================
  // 基础按键状态
  // ============================================================

  /** 是否仅按下 Alt 键（不包含 Ctrl/Shift） */
  const isAltOnly = computed(() => {
    return (alt?.value ?? false) && !(ctrl?.value ?? false) && !(shift?.value ?? false)
  })

  const isSpacePressed = computed(() => space?.value ?? false)

  // ============================================================
  // 相机配置读取
  // ============================================================

  /** 相机输入绑定配置 */
  const cameraBindings = computed(() => settingsStore.settings.inputBindings.camera)

  /** Orbit 模式旋转按键 */
  const orbitRotateButton = computed(() => cameraBindings.value.orbitRotate)

  /** Flight 模式视角控制按键 */
  const flightLookButton = computed(() => cameraBindings.value.flightLook)

  /** 是否启用 Alt+左键相机控制 */
  const enableAltLeftClick = computed(() => cameraBindings.value.enableAltLeftClick)

  // ============================================================
  // 派生状态
  // ============================================================

  /**
   * Alt+左键相机控制是否当前激活
   * 条件：
   * 1. 设置中启用了 Alt+左键
   * 2. 仅按下 Alt 键（不包含 Ctrl/Shift）
   */
  const isAltCameraActive = computed(() => {
    return enableAltLeftClick.value && isAltOnly.value
  })

  /** 当前是否为正交视图 */
  const isOrthographic = computed(() => uiStore.currentViewPreset !== 'perspective')

  /** 当前工具 */
  const currentTool = computed(() => editorStore.currentTool)

  // ============================================================
  // 复合逻辑
  // ============================================================

  /**
   * 框选是否应该被禁用
   *
   * 禁用条件（满足任一即禁用）：
   * 1. 当前工具为手形工具
   * 2. 正交视图下按住空格键（临时平移）
   * 3. Alt+左键相机控制激活
   */
  const shouldDisableSelection = computed(() => {
    return (
      currentTool.value === 'hand' ||
      (isOrthographic.value && isSpacePressed.value) ||
      isAltCameraActive.value
    )
  })

  /**
   * 检查某个鼠标按键是否应该触发 Flight 模式视角控制
   * @param button 鼠标按键 (0=左, 1=中, 2=右)
   */
  function shouldTriggerFlightLook(button: number): boolean {
    const flightKey = flightLookButton.value

    return (
      (flightKey === 'middle' && button === 1) ||
      (flightKey === 'right' && button === 2) ||
      (enableAltLeftClick.value && isAltOnly.value && button === 0)
    )
  }

  /**
   * 检查某个鼠标按键是否应该释放 Flight 模式视角控制
   * @param button 鼠标按键 (0=左, 1=中, 2=右)
   */
  function shouldReleaseFlightLook(button: number): boolean {
    const flightKey = flightLookButton.value

    return (
      (flightKey === 'middle' && button === 1) ||
      (flightKey === 'right' && button === 2) ||
      (enableAltLeftClick.value && button === 0) // Alt 释放会改变 isAltOnly
    )
  }

  // ============================================================
  // 返回 API
  // ============================================================

  return {
    // 基础状态
    isAltOnly,
    isSpacePressed,

    // 配置
    orbitRotateButton,
    flightLookButton,
    enableAltLeftClick,

    // 派生状态
    isAltCameraActive,
    isOrthographic,
    currentTool,

    // 复合逻辑
    shouldDisableSelection,

    // 工具函数
    shouldTriggerFlightLook,
    shouldReleaseFlightLook,
  }
}

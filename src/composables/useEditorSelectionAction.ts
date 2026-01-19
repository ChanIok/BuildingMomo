import { computed } from 'vue'
import { useMagicKeys } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settingsStore'
import type { SelectionAction } from '@/stores/editorStore'

/**
 * 统一管理编辑器选择行为的 Composable
 * 结合 Store 设置和键盘修饰键计算当前的有效选择模式
 */
export function useEditorSelectionAction() {
  const settingsStore = useSettingsStore()
  const { shift, alt, ctrl } = useMagicKeys()

  // 当前按键状态
  const modifierState = computed(() => ({
    shift: shift?.value ?? false,
    ctrl: ctrl?.value ?? false,
    alt: alt?.value ?? false,
  }))

  const activeAction = computed<SelectionAction>(() => {
    const bindings = settingsStore.settings.inputBindings.selection

    // 1. 交叉选择：最高优先级
    if (
      bindings.intersect !== 'none' &&
      matchModifierKey(bindings.intersect, modifierState.value)
    ) {
      return 'intersect'
    }

    const togglePressed =
      bindings.toggleIndividual !== 'none' &&
      isKeyIncluded(bindings.toggleIndividual, modifierState.value)

    // 2. toggleIndividual + add/subtract 组合
    if (togglePressed) {
      // 检查是否还按了 add 或 subtract 的键
      if (isExtraKeyPressed(bindings.add, modifierState.value, bindings.toggleIndividual)) {
        return 'add'
      }
      if (isExtraKeyPressed(bindings.subtract, modifierState.value, bindings.toggleIndividual)) {
        return 'subtract'
      }
      // toggleIndividual 单独
      return 'toggle'
    }

    // 3. add / subtract 单独
    if (matchModifierKey(bindings.add, modifierState.value)) return 'add'
    if (matchModifierKey(bindings.subtract, modifierState.value)) return 'subtract'

    // 4. 默认：新选区
    return 'new'
  })

  // 强制单选模式（不扩展到组）：只要 toggleIndividual 的键被按下就启用
  const forceIndividualSelection = computed(() => {
    const key = settingsStore.settings.inputBindings.selection.toggleIndividual
    return key !== 'none' && isKeyIncluded(key, modifierState.value)
  })

  return {
    activeAction,
    forceIndividualSelection,
  }
}

/**
 * 匹配修饰键组合（严格模式：不能有多余的键）
 * @param key 键位定义（如 'ctrl', 'ctrl+shift'）
 * @param state 当前按键状态
 * @returns 是否匹配
 */
function matchModifierKey(
  key: string,
  state: { shift: boolean; ctrl: boolean; alt: boolean }
): boolean {
  if (key === 'none') return false

  const parts = key.split('+')

  // 所有要求的键都按下
  const allPressed = parts.every((part) => {
    if (part === 'shift') return state.shift
    if (part === 'ctrl') return state.ctrl
    if (part === 'alt') return state.alt
    return false
  })

  // 没有多余的键（严格匹配）
  const hasExtraKeys =
    (state.shift && !parts.includes('shift')) ||
    (state.ctrl && !parts.includes('ctrl')) ||
    (state.alt && !parts.includes('alt'))

  return allPressed && !hasExtraKeys
}

/**
 * 检查某个键位的所有键是否都被按下（非严格模式：允许多余的键）
 * @param key 键位定义
 * @param state 当前按键状态
 * @returns 是否所有键都被按下
 */
function isKeyIncluded(
  key: string,
  state: { shift: boolean; ctrl: boolean; alt: boolean }
): boolean {
  if (key === 'none') return false

  const parts = key.split('+')
  return parts.every((part) => {
    if (part === 'shift') return state.shift
    if (part === 'ctrl') return state.ctrl
    if (part === 'alt') return state.alt
    return false
  })
}

/**
 * 检查在已按下 baseKey 的基础上，是否还额外按下了 extraKey 的键
 * @param extraKey 额外键位（如 'shift'）
 * @param state 当前按键状态
 * @param baseKey 基础键位（如 'ctrl'）
 * @returns 是否同时按下了两组键
 */
function isExtraKeyPressed(
  extraKey: string,
  state: { shift: boolean; ctrl: boolean; alt: boolean },
  baseKey: string
): boolean {
  // baseKey 必须被按下
  if (!isKeyIncluded(baseKey, state)) return false

  // extraKey 必须被按下
  if (!isKeyIncluded(extraKey, state)) return false

  // 确保 extraKey 不是 baseKey 的子集（避免 ctrl+shift 被误判为 ctrl）
  const baseParts = baseKey.split('+')
  const extraParts = extraKey.split('+')

  // extraKey 中至少有一个键不在 baseKey 中
  const hasNewKey = extraParts.some((part) => !baseParts.includes(part))

  return hasNewKey
}

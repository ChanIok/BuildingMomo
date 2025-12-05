/**
 * 键盘输入上下文工具函数
 * 用于协调全局快捷键、导航键、工具键的优先级
 */

/**
 * 检查是否按下了修饰键（Ctrl/Alt/Meta）
 * 用于区分单字母按键和快捷键组合
 */
export function hasModifierKeys(): boolean {
  // 直接检查 event，而不是依赖 useMagicKeys
  // 因为 useMagicKeys 可能在某些情况下不够及时
  const event = window.event as KeyboardEvent | null
  if (event) {
    return !!(event.ctrlKey || event.metaKey || event.altKey)
  }
  return false
}

/**
 * 检查用户是否选中了文本
 * 用于决定是否允许浏览器的原生复制行为
 */
export function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return (selection?.toString().length ?? 0) > 0
}

/**
 * 检查当前焦点是否在文本输入元素上
 * 用于决定是否允许快捷键
 */
export function isTextInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false

  const tagName = el.tagName

  // 输入框和文本域
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true
  }

  // 可编辑元素 (contenteditable)
  if (el.hasAttribute('contenteditable')) {
    return true
  }

  return false
}

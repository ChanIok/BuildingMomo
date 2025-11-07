import { ref, computed } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { AppItem } from '../types/editor'

export function useClipboard(editorStore: ReturnType<typeof useEditorStore>) {
  // 内部剪贴板（存储复制的物品数据）
  const clipboard = ref<AppItem[]>([])

  // 是否有剪贴板数据
  const hasClipboardData = computed(() => clipboard.value.length > 0)

  // 复制选中项到剪贴板
  function copy() {
    if (editorStore.selectedItemIds.size === 0) {
      console.warn('[Clipboard] No items selected to copy')
      return
    }

    // 深拷贝选中的物品
    clipboard.value = editorStore.selectedItems.map((item) => ({
      ...item,
      originalData: JSON.parse(JSON.stringify(item.originalData)),
    }))

    console.log(`[Clipboard] Copied ${clipboard.value.length} items`)
  }

  // 剪切选中项（复制 + 删除）
  function cut() {
    if (editorStore.selectedItemIds.size === 0) {
      console.warn('[Clipboard] No items selected to cut')
      return
    }

    // 先复制
    copy()

    // 再删除
    editorStore.deleteSelected()

    console.log(`[Clipboard] Cut ${clipboard.value.length} items`)
  }

  // 粘贴剪贴板内容到画布
  function paste() {
    if (clipboard.value.length === 0) {
      console.warn('[Clipboard] No items in clipboard to paste')
      return
    }

    // 创建新物品（不偏移位置）
    editorStore.pasteItems(clipboard.value, 0, 0)

    console.log(`[Clipboard] Pasted ${clipboard.value.length} items`)
  }

  // 清空剪贴板
  function clearClipboard() {
    clipboard.value = []
    console.log('[Clipboard] Cleared')
  }

  return {
    clipboard,
    hasClipboardData,
    copy,
    cut,
    paste,
    clearClipboard,
  }
}

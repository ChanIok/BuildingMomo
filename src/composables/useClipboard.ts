import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useEditorHistory } from './editor/useEditorHistory'
import { useEditorGroups } from './editor/useEditorGroups'
import type { AppItem } from '../types/editor'

// 生成简单的UUID (局部工具函数，或从 utils 导入)
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function useClipboard() {
  const store = useEditorStore()
  const { activeScheme, clipboardList: clipboard } = storeToRefs(store)
  const { getNextInstanceId } = store

  const { saveHistory } = useEditorHistory()
  const { getNextGroupId } = useEditorGroups()

  const hasClipboardData = computed(() => clipboard.value.length > 0)

  // 跨方案剪贴板：复制到剪贴板
  function copyToClipboard() {
    if (!activeScheme.value) return

    clipboard.value = activeScheme.value.items.value
      .filter((item) => activeScheme.value!.selectedItemIds.value.has(item.internalId))
      .map((item) => ({ ...item })) // 深拷贝
  }

  // 跨方案剪贴板：剪切到剪贴板
  function cutToClipboard() {
    if (!activeScheme.value) return

    // 保存历史（编辑操作）
    saveHistory('edit')

    copyToClipboard()

    // 剪切后删除
    activeScheme.value.items.value = activeScheme.value.items.value.filter(
      (item) => !activeScheme.value!.selectedItemIds.value.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.value.clear()

    // 触发更新
    store.triggerSceneUpdate()
    store.triggerSelectionUpdate()
  }

  // 粘贴物品（内部方法）
  function pasteItems(clipboardItems: AppItem[], offsetX: number, offsetY: number): string[] {
    if (!activeScheme.value) return []

    // 保存历史（编辑操作）
    saveHistory('edit')

    const newIds: string[] = []
    const newItems: AppItem[] = []
    let nextInstanceId = getNextInstanceId()

    // 收集剪贴板物品的所有组ID，为每个组分配新的 GroupID
    const groupIdMap = new Map<number, number>() // 旧GroupID -> 新GroupID

    clipboardItems.forEach((item) => {
      const oldGroupId = item.groupId
      if (oldGroupId > 0 && !groupIdMap.has(oldGroupId)) {
        groupIdMap.set(oldGroupId, getNextGroupId() + groupIdMap.size)
      }
    })

    clipboardItems.forEach((item) => {
      const newId = generateUUID()
      const newInstanceId = nextInstanceId++
      newIds.push(newId)

      const newX = item.x + offsetX
      const newY = item.y + offsetY

      // 如果物品有组，分配新的 GroupID
      const oldGroupId = item.groupId
      const newGroupId = oldGroupId > 0 ? groupIdMap.get(oldGroupId)! : 0

      newItems.push({
        ...item,
        internalId: newId,
        instanceId: newInstanceId,
        x: newX,
        y: newY,
        rotation: { ...item.rotation },
        groupId: newGroupId,
        extra: { ...item.extra },
      })
    })

    activeScheme.value.items.value.push(...newItems)

    // 选中新粘贴的物品
    activeScheme.value.selectedItemIds.value.clear()
    newIds.forEach((id) => activeScheme.value!.selectedItemIds.value.add(id))

    // 触发更新
    store.triggerSceneUpdate()
    store.triggerSelectionUpdate()

    return newIds
  }

  // 复制选中项到剪贴板 (对外 API)
  function copy() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to copy')
      return
    }

    copyToClipboard()
    console.log(`[Clipboard] Copied ${clipboard.value.length} items`)
  }

  // 剪切选中项（复制 + 删除） (对外 API)
  function cut() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to cut')
      return
    }

    cutToClipboard()
    console.log(`[Clipboard] Cut ${clipboard.value.length} items`)
  }

  // 粘贴剪贴板内容到画布 (对外 API)
  function paste() {
    if (clipboard.value.length === 0) {
      console.warn('[Clipboard] No items in clipboard to paste')
      return
    }

    // 粘贴剪贴板物品（不偏移位置）
    pasteItems(clipboard.value, 0, 0)
    console.log(`[Clipboard] Pasted ${clipboard.value.length} items`)
  }

  // 清空剪贴板
  function clearClipboard() {
    clipboard.value = []
    console.log('[Clipboard] Cleared')
  }

  return {
    clipboard: computed(() => clipboard.value),
    hasClipboardData,
    copy,
    cut,
    paste,
    pasteItems, // 暴露给 Store 和其他需要自定义偏移的场景
    clearClipboard,
    copyToClipboard, // 保留兼容性
    cutToClipboard, // 保留兼容性
  }
}

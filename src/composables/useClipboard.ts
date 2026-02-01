import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useEditorHistory } from './editor/useEditorHistory'
import type { AppItem, ClipboardData } from '../types/editor'

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

  const { saveHistory } = useEditorHistory()

  /**
   * 从选中物品构建剪贴板数据（包含组原点信息）
   * 这个函数可以在复制、Alt+拖拽复制等场景中复用
   */
  function buildClipboardDataFromSelection(): ClipboardData {
    const scheme = activeScheme.value
    if (!scheme) {
      return { items: [], groupOrigins: new Map() }
    }

    // 复制选中的物品
    const copiedItems = scheme.items.value
      .filter((item) => scheme.selectedItemIds.value.has(item.internalId))
      .map((item) => ({ ...item })) // 深拷贝

    // 单物体复制时强制脱组：避免产生只有 1 个成员的组
    if (copiedItems.length === 1) {
      const singleItem = copiedItems[0]
      if (singleItem && singleItem.groupId > 0) {
        singleItem.groupId = 0
      }
    }

    // 收集这些物品涉及的所有组 ID
    const involvedGroupIds = new Set<number>()
    copiedItems.forEach((item: AppItem) => {
      if (item.groupId > 0) {
        involvedGroupIds.add(item.groupId)
      }
    })

    // 收集这些组的原点设置
    const copiedGroupOrigins = new Map<number, string>()
    involvedGroupIds.forEach((groupId: number) => {
      const originItemId = scheme.groupOrigins.value.get(groupId)
      if (originItemId) {
        copiedGroupOrigins.set(groupId, originItemId)
      }
    })

    return {
      items: copiedItems,
      groupOrigins: copiedGroupOrigins,
    }
  }

  // 跨方案剪贴板：复制到剪贴板
  function copyToClipboard() {
    if (!activeScheme.value) return
    clipboard.value = buildClipboardDataFromSelection()
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

  /**
   * 粘贴物品（内部方法）
   * @param clipboardData 剪贴板数据，包含物品列表和组原点信息
   * @param offsetX X 轴偏移
   * @param offsetY Y 轴偏移
   * @returns 新创建的物品 ID 列表
   */
  function pasteItems(clipboardData: ClipboardData, offsetX: number, offsetY: number): string[] {
    if (!activeScheme.value) return []

    const { items: clipboardItems, groupOrigins: clipboardGroupOrigins } = clipboardData

    // 保存历史（编辑操作）
    saveHistory('edit')

    const scheme = activeScheme.value
    const newIds: string[] = []
    const newItems: AppItem[] = []

    // 1. 使用方案级别的 maxInstanceId（严格自增，永不回退）
    let currentMaxInstanceId = scheme.maxInstanceId.value

    // 2. 收集剪贴板物品的所有组ID，为每个组分配新的 GroupID（严格自增策略）
    const groupIdMap = new Map<number, number>() // 旧GroupID -> 新GroupID

    // 使用方案级别的 maxGroupId（严格自增，永不回退）
    let currentMaxGroupId = scheme.maxGroupId.value

    clipboardItems.forEach((item: AppItem) => {
      const oldGroupId = item.groupId
      if (oldGroupId > 0 && !groupIdMap.has(oldGroupId)) {
        // 使用 Max + 1 策略分配新的 GroupID
        currentMaxGroupId++
        groupIdMap.set(oldGroupId, currentMaxGroupId)
      }
    })

    // 3. 建立物品 ID 映射（旧 internalId -> 新 internalId）
    const itemIdMap = new Map<string, string>()

    clipboardItems.forEach((item: AppItem) => {
      const newId = generateUUID()

      // 建立物品 ID 映射
      itemIdMap.set(item.internalId, newId)

      // 直接递增 InstanceID（严格自增策略，永不回退）
      currentMaxInstanceId++
      const newInstanceId = currentMaxInstanceId

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

    // 4. 恢复组原点设置（转换为新的 groupId 和新的 itemId）
    clipboardGroupOrigins.forEach((oldOriginItemId: string, oldGroupId: number) => {
      const newGroupId = groupIdMap.get(oldGroupId)
      const newOriginItemId = itemIdMap.get(oldOriginItemId)

      // 只有当组 ID 和原点物品 ID 都成功转换时才设置
      if (newGroupId !== undefined && newOriginItemId !== undefined) {
        scheme.groupOrigins.value.set(newGroupId, newOriginItemId)
      }
    })

    // 触发 groupOrigins 的响应式更新
    if (clipboardGroupOrigins.size > 0) {
      import('vue').then(({ triggerRef }) => {
        triggerRef(scheme.groupOrigins)
      })
    }

    scheme.items.value.push(...newItems)

    // 更新方案级别的最大ID（持久化历史最大值）
    scheme.maxInstanceId.value = currentMaxInstanceId
    scheme.maxGroupId.value = currentMaxGroupId

    // 选中新粘贴的物品
    scheme.selectedItemIds.value.clear()
    newIds.forEach((id) => scheme.selectedItemIds.value.add(id))

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
    console.log(`[Clipboard] Copied ${clipboard.value.items.length} items`)
  }

  // 剪切选中项（复制 + 删除） (对外 API)
  function cut() {
    if (!activeScheme.value || activeScheme.value.selectedItemIds.value.size === 0) {
      console.warn('[Clipboard] No items selected to cut')
      return
    }

    cutToClipboard()
    console.log(`[Clipboard] Cut ${clipboard.value.items.length} items`)
  }

  // 粘贴剪贴板内容到画布 (对外 API)
  function paste() {
    if (clipboard.value.items.length === 0) {
      console.warn('[Clipboard] No items in clipboard to paste')
      return
    }

    // 粘贴剪贴板物品（不偏移位置）
    pasteItems(clipboard.value, 0, 0)
    console.log(`[Clipboard] Pasted ${clipboard.value.items.length} items`)
  }

  // 清空剪贴板
  function clearClipboard() {
    clipboard.value = {
      items: [],
      groupOrigins: new Map(),
    }
    console.log('[Clipboard] Cleared')
  }

  const hasClipboardData = computed(() => clipboard.value.items.length > 0)

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
    buildClipboardDataFromSelection, // 暴露给需要临时构建剪贴板数据的场景（如 Alt+拖拽复制）
  }
}

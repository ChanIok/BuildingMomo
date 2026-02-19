import { storeToRefs } from 'pinia'
import { markRaw } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import type { AppItem, HistorySnapshot, HistoryStack } from '../../types/editor'

export function useEditorHistory() {
  const store = useEditorStore()
  // 使用 storeToRefs 保持响应性
  const { activeScheme } = storeToRefs(store)

  // 初始化历史栈
  function initHistoryStack(): HistoryStack {
    return {
      undoStack: [],
      redoStack: [],
      maxSize: 50,
    }
  }

  // 浅拷贝物品数组（共享 originalData 引用以节省内存）
  function cloneItems(items: AppItem[]): AppItem[] {
    // 性能优化：只拷贝基础属性，共享 originalData 引用
    return items.map((item) => ({
      ...item,
      extra: item.extra, // 保持引用，避免重复存储
    }))
  }

  // 深拷贝选择集合
  function cloneSelection(selection: Set<string>): Set<string> {
    return new Set(selection)
  }

  // 保存历史记录
  function saveHistory(type: 'edit' | 'selection' = 'edit') {
    if (!activeScheme.value) return

    // 确保历史栈已初始化
    // history 也是 shallowRef，需要 .value 访问
    if (!activeScheme.value.history.value) {
      activeScheme.value.history.value = initHistoryStack()
    }

    const history = activeScheme.value.history.value!

    // 方案A：选择操作合并策略
    // 如果是选择操作且栈顶也是选择操作，则替换而不是新增
    if (type === 'selection' && history.undoStack.length > 0) {
      const lastSnapshot = history.undoStack[history.undoStack.length - 1]
      if (lastSnapshot && lastSnapshot.type === 'selection') {
        // 仅更新选择集合和时间戳，避免重复深拷贝 items
        lastSnapshot.selectedItemIds = cloneSelection(activeScheme.value.selectedItemIds.value)
        lastSnapshot.timestamp = Date.now()
        return
      }
    }

    // 创建快照
    let snapshot: HistorySnapshot
    if (type === 'selection') {
      // 选择操作：只保存选择状态，items 设为 null 以减少性能开销
      snapshot = {
        items: null,
        selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds.value),
        timestamp: Date.now(),
        type,
      }
    } else {
      // 编辑操作：保存完整的物品数据和选择状态
      // 传入 items.value
      snapshot = {
        items: cloneItems(activeScheme.value.items.value),
        selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds.value),
        timestamp: Date.now(),
        type,
      }
    }

    // 推入撤销栈
    // 使用 markRaw 标记快照，阻止 Vue 将其转换为响应式 Proxy
    // 历史记录是只读数据，不需要响应式追踪，这样可以显著减少内存占用和 GC 压力
    history.undoStack.push(markRaw(snapshot))

    // 限制栈大小
    if (history.undoStack.length > history.maxSize) {
      history.undoStack.shift()
    }

    // 清空重做栈（新操作会使重做历史失效）
    history.redoStack = []
    store.triggerHistoryUpdate()
  }

  // 撤销操作
  function undo() {
    // history 是 shallowRef
    if (!activeScheme.value?.history.value) return
    const history = activeScheme.value.history.value

    if (history.undoStack.length === 0) {
      console.log('[History] 没有可撤销的操作')
      return
    }

    // 保存当前状态到重做栈
    const currentSnapshot: HistorySnapshot = {
      items: cloneItems(activeScheme.value.items.value),
      selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds.value),
      timestamp: Date.now(),
      type: 'edit', // 重做栈不区分类型
    }
    // 同样使用 markRaw 阻止响应式包裹
    history.redoStack.push(markRaw(currentSnapshot))

    // 从撤销栈弹出并恢复状态
    const snapshot = history.undoStack.pop()!

    if (snapshot.type === 'edit') {
      // 编辑操作：恢复物品和选择状态
      if (snapshot.items) {
        activeScheme.value.items.value = cloneItems(snapshot.items)
      }
      activeScheme.value.selectedItemIds.value = cloneSelection(snapshot.selectedItemIds)
      store.triggerSceneUpdate()
    } else if (snapshot.type === 'selection') {
      // 选择操作：只恢复选择状态，避免不必要的物品深拷贝
      activeScheme.value.selectedItemIds.value = cloneSelection(snapshot.selectedItemIds)
    }
    store.triggerSelectionUpdate()
    store.triggerHistoryUpdate()

    console.log(`[History] 撤销操作 (类型: ${snapshot.type})`)
  }

  // 重做操作
  function redo() {
    if (!activeScheme.value?.history.value) return
    const history = activeScheme.value.history.value

    if (history.redoStack.length === 0) {
      console.log('[History] 没有可重做的操作')
      return
    }

    // 保存当前状态到撤销栈
    const currentSnapshot: HistorySnapshot = {
      items: cloneItems(activeScheme.value.items.value),
      selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds.value),
      timestamp: Date.now(),
      type: 'edit',
    }
    // 同样使用 markRaw 阻止响应式包裹
    history.undoStack.push(markRaw(currentSnapshot))

    // 从重做栈弹出并恢复状态
    const snapshot = history.redoStack.pop()!

    if (snapshot.type === 'edit') {
      if (snapshot.items) {
        activeScheme.value.items.value = cloneItems(snapshot.items)
      }
      activeScheme.value.selectedItemIds.value = cloneSelection(snapshot.selectedItemIds)
      store.triggerSceneUpdate()
    } else if (snapshot.type === 'selection') {
      activeScheme.value.selectedItemIds.value = cloneSelection(snapshot.selectedItemIds)
    }
    store.triggerSelectionUpdate()
    store.triggerHistoryUpdate()

    console.log('[History] 重做操作')
  }

  // 检查是否可以撤销
  function canUndo(): boolean {
    return (activeScheme.value?.history.value?.undoStack.length ?? 0) > 0
  }

  // 检查是否可以重做
  function canRedo(): boolean {
    return (activeScheme.value?.history.value?.redoStack.length ?? 0) > 0
  }

  return {
    saveHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    initHistoryStack,
  }
}

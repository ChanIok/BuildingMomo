import { storeToRefs } from 'pinia'
import { markRaw } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import {
  applyEditorTransactionToScheme,
  buildTransactionByRef,
  captureSchemeSnapshot,
  collectTransactionTouchedItemIds,
  collectTransactionTouchedGroupIds,
  createReplayTransaction,
  invertEditorTransaction,
  transactionAffectsScene,
} from '../../lib/editorTransactions'
import type {
  EditorTransaction,
  HistoryStack,
  SelectionHistoryEntry,
  TransactionHistoryEntry,
} from '../../types/editor'

export function useEditorHistory() {
  const store = useEditorStore()
  const { activeScheme } = storeToRefs(store)

  // ========== 基础数据结构与栈管理 ==========

  /**
   * 初始化一个全新的历史记录栈
   * 包含独立的选择状态栈和事务栈，并维护一个自增的 sequence 控制顺序
   */
  function initHistoryStack(): HistoryStack {
    return {
      selectionUndoStack: [],
      selectionRedoStack: [],
      transactionUndoStack: [],
      transactionRedoStack: [],
      maxSize: 50, // 最大可撤销步数
      nextSequence: 1, // 全局动作序列号，用于判断哪个操作更新
    }
  }

  /**
   * 确保当前激活的方案拥有初始化的历史记录栈
   * 如果当前方案为空，则返回 null
   */
  function ensureHistoryStack(): HistoryStack | null {
    if (!activeScheme.value) return null

    if (!activeScheme.value.history.value) {
      activeScheme.value.history.value = initHistoryStack()
    }

    return activeScheme.value.history.value
  }

  /**
   * 辅助函数：克隆选中集合（Selection Set）
   * 避免由于引用被共享导致撤销重做时发生数据篡改
   */
  function cloneSelection(selection: Set<string>): Set<string> {
    return new Set(selection)
  }

  /**
   * 获取并递增全局操作序列号（Sequence）
   * 每次发生新的历史记录（选区修改 / 状态事务修改），都会取得一个排他性的自增序号
   * 保证历史前进、后退时的全局先后顺序清晰
   */
  function getNextSequence(history: HistoryStack): number {
    return history.nextSequence++
  }

  /**
   * 截断数组（模拟堆栈长度限制）
   * @param stack 要截断的数组栈
   * @param maxSize 允许存储的最大动作数
   */
  function trimToMaxSize<T>(stack: T[], maxSize: number) {
    if (stack.length > maxSize) {
      // 溢出时删除最旧的记录
      stack.splice(0, stack.length - maxSize)
    }
  }

  /**
   * 查看栈顶元素但不弹出
   */
  function peek<T>(stack: T[]): T | null {
    return stack.length > 0 ? stack[stack.length - 1]! : null
  }

  // ========== Entry (历史操作条目) 构造 ==========

  /**
   * 构造一条选区历史记录 entry
   */
  function createSelectionEntry(
    selectedItemIds: Set<string>,
    history: HistoryStack
  ): SelectionHistoryEntry {
    return {
      kind: 'selection',
      selectedItemIds: cloneSelection(selectedItemIds),
      sequence: getNextSequence(history), // 分配时序
      timestamp: Date.now(),
    }
  }

  /**
   * 构造一条事务（实质变更）历史记录 entry
   * 事务除了包括属性/数量变更，还可以保存操作前后的选区信息，确保撤销时能够高亮目标
   */
  function createTransactionEntry(
    entry: Omit<TransactionHistoryEntry, 'kind' | 'sequence' | 'timestamp'>,
    history: HistoryStack
  ): TransactionHistoryEntry {
    return {
      kind: 'transaction',
      transaction: entry.transaction,
      selectionBefore: cloneSelection(entry.selectionBefore),
      selectionAfter: cloneSelection(entry.selectionAfter),
      committed: entry.committed, // 云协同模式下的提交状态
      stale: entry.stale, // 是否成为废弃或过期状态（例如产生了网络冲突）
      sequence: getNextSequence(history), // 分配时序
      timestamp: Date.now(),
    }
  }

  // ========== 核心 API：记录操作 ==========

  /**
   * 记录纯选取修改的行为（被点击选中的物品更改）
   * 不需要进行大规模的对象 Diff
   */
  function recordSelectionChange() {
    const scheme = activeScheme.value
    const history = ensureHistoryStack()
    if (!scheme || !history) return

    // markRaw: 性能优化。避免被放入 Pinia 的时候去深度遍历追踪对象属性
    history.selectionUndoStack.push(
      markRaw(createSelectionEntry(scheme.selectedItemIds.value, history))
    )
    trimToMaxSize(history.selectionUndoStack, history.maxSize)

    // 新的任何操作都会导致原有的重做分支清空
    history.selectionRedoStack = []
    store.triggerHistoryUpdate()
  }

  /**
   * 【最核心入口】产生一条真实的修改记录（Transaction）。
   *
   * 其工作原理非常像 React 的 `useEffect` 执行前的快照和执行后的快照进行的比较环节。
   * **由于它使用了严格的引用相等(`===`)机制：如果你传入的函数 `execute` 在内部没有产出
   *  "新对象的拷贝"，那么系统将会认为该对象的值没有变化从而跳过修改开销；
   *  反之则会进行非常快且精细的记录。**
   *
   * @param intent 意图的前缀（如 'transform.move', 'group.create' 等，用于界面文案呈现以及查错）
   * @param execute 实际触发数据修改的闭包函数
   */
  function recordTransaction<T>(intent: string, execute: () => T): T {
    const scheme = activeScheme.value
    if (!scheme) {
      return execute()
    }

    // 所有编辑入口统一校验选择范围和保护限制。
    if (store.constrainSelectionToEditable()) store.triggerSelectionUpdate()

    // [第①步]：零开销缓存当前的引用状态
    const before = captureSchemeSnapshot(scheme)
    const renderVersion = store.sceneVersion
    const selectionBefore = cloneSelection(scheme.selectedItemIds.value)

    // [第②步]：执行副作用操作，真正修改 activeScheme 里的内容或指针
    const result = execute()

    // [第③步]：零开销缓存这之后的引用状态
    const after = captureSchemeSnapshot(scheme)
    const selectionAfter = cloneSelection(scheme.selectedItemIds.value)

    // [第④步]：比较生成可供回滚的交易日志记录 (基于引用比较而非巨大的深拷贝Diff JSON比对)
    const transaction = buildTransactionByRef({
      schemeId: scheme.id,
      intent,
      before,
      after,
    })

    if (transaction) {
      store.recordRenderTransaction(transaction, renderVersion)
      const history = ensureHistoryStack()
      if (!history) return result

      // 生成操作包裹并装载进撤销堆栈（Undo）
      history.transactionUndoStack.push(
        markRaw(
          createTransactionEntry(
            {
              transaction,
              selectionBefore,
              selectionAfter,
              // 如果不在云协同房间，或者本方案就是本地方案，那么被视为立即生效（即被 commit）
              committed: scheme.source.value !== 'cloud',
              stale: false,
            },
            history
          )
        )
      )
      trimToMaxSize(history.transactionUndoStack, history.maxSize)
      // 操作后打破原有的重做可能性分支
      history.transactionRedoStack = []

      // 让界面或 Pinia 监控者知道历史发生过变动
      store.triggerHistoryUpdate()

      // 如果属于云协同操作，这把交易放入队列排队等候发往服务器
      if (scheme.source.value === 'cloud') {
        store.enqueuePendingTransaction(transaction)
      }
    }

    return result
  }

  // ========== undo/redo 目标选择逻辑 ==========

  /**
   * 检查一条事务记录是否安全/可用。
   * 特别是在云协同模式下，必须判断该事件是否已被服务端接受（committed）
   * 以及当前是否仍有堵塞的上行事务在发送中（pendingTransaction 为空）。
   */
  function canUseTransactionEntry(entry: TransactionHistoryEntry | null): boolean {
    const scheme = activeScheme.value
    if (!scheme || !entry) return false

    // 本地不协同模式永远可以直接撤销重做
    if (scheme.source.value !== 'cloud') {
      return true
    }

    // 尚有排队的未定操作，阻止撤销以防止网络数据覆写带来的多重幻觉时空
    if (store.peekPendingTransaction(scheme.id)) {
      return false
    }

    return entry.committed && !entry.stale
  }

  type StackTarget =
    | { type: 'selection'; entry: SelectionHistoryEntry }
    | { type: 'transaction'; entry: TransactionHistoryEntry }

  /**
   * 从 Selection 操作栈 和 Transaction 基础动作栈 的「栈顶」抽选最符合逻辑的下个回撤目标。
   *
   * 由于可能先动了家具、然后点击变更了选区；这时在用户心智模型里：
   * 撤回的第一步往往应该是刚刚改变的『选择框』，然后再回到家具摆放的位置。
   *
   * @returns 判断并返回最高序列号的可用撤回内容，如果事务被锁了就Fallback到选区
   */
  function getStackTarget(
    selectionStack: SelectionHistoryEntry[],
    transactionStack: TransactionHistoryEntry[]
  ): StackTarget | null {
    const selEntry = peek(selectionStack)
    const txEntry = peek(transactionStack)
    const canUseTx = canUseTransactionEntry(txEntry)

    // 如果两者并存，比较 Sequence (谁更大谁就是后发生的谁就先被倒回去处理)
    if (selEntry && canUseTx && txEntry) {
      return selEntry.sequence > txEntry.sequence
        ? { type: 'selection', entry: selEntry }
        : { type: 'transaction', entry: txEntry }
    }

    // 如果事务合规且存在就返回事务
    if (canUseTx && txEntry) return { type: 'transaction', entry: txEntry }
    // 如果只是有选区记录，或者事务记录处于被云端网络锁定状态，但选区可以改回去那就返回选区
    if (selEntry) return { type: 'selection', entry: selEntry }

    return null
  }

  // ========== undo/redo (执行倒退或快进) ==========

  /**
   * 恢复选取状态
   */
  function restoreSelectionEntry(entry: SelectionHistoryEntry) {
    if (!activeScheme.value) return

    activeScheme.value.selectedItemIds.value = cloneSelection(entry.selectedItemIds)
    store.triggerSelectionUpdate()
  }

  // Replay retains global history order; outside edits must be visible before applying them.
  function prepareLocalHistoryReplay(entry: TransactionHistoryEntry) {
    const scope = store.localEditingItemIds
    if (scope === null) return
    const touchedIds = collectTransactionTouchedItemIds(entry.transaction)
    let outside = [...touchedIds].some((id) => !scope.has(id))
    for (const op of entry.transaction.ops) {
      if (op.type !== 'set_group_origins' && op.type !== 'set_group_names') continue
      const before = new Map(op.before)
      const after = new Map(op.after)
      for (const groupId of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(groupId) === after.get(groupId)) continue
        if ([...(store.groupsMap.get(groupId) ?? [])].some((id) => !scope.has(id))) outside = true
      }
    }
    if (outside) store.exitLocalEditing()
  }

  /** 执行对一条事务记录的撤回。 */
  function undoTransaction(entry: TransactionHistoryEntry) {
    prepareLocalHistoryReplay(entry)
    const renderVersion = store.sceneVersion
    const scheme = activeScheme.value!
    const history = scheme.history.value!

    // [管理栈] 把它从 Undo 端推送到 Redo 以备可能的快进
    history.transactionRedoStack.push(markRaw(createTransactionEntry(entry, history)))
    trimToMaxSize(history.transactionRedoStack, history.maxSize)

    // 判断处理数据的方式
    if (scheme.source.value === 'cloud') {
      // 1. 对于协同云模式：不可以直接原位回滚数据。我们必须将此次撤回也“打包为一笔独立的反相交易”。
      // 这样其他人收到时，同样可以知道如何退后操作。
      const inverse = createReplayTransaction(invertEditorTransaction(entry.transaction), 'undo')
      applyEditorTransactionToScheme(scheme, inverse)
      store.enqueuePendingTransaction(inverse)
    } else {
      // 2. 本地模式：直接用这个事物的“逆指令”来套回到当前文档场景即可
      applyEditorTransactionToScheme(scheme, invertEditorTransaction(entry.transaction))
    }

    // [收尾工作] 最后必须重置回当时操作发生前的选区，以便使用者能清晰明确他们回退了什么物体
    scheme.selectedItemIds.value = cloneSelection(entry.selectionBefore)
    if (transactionAffectsScene(entry.transaction)) store.triggerSceneUpdate()
    store.recordRenderTransaction(invertEditorTransaction(entry.transaction), renderVersion)
    store.triggerSelectionUpdate()
    store.triggerHistoryUpdate()
  }

  /**
   * 执行对一条事务记录的重新做(快进)
   * 和 undo 极为神似。
   */
  function redoTransaction(entry: TransactionHistoryEntry) {
    prepareLocalHistoryReplay(entry)
    const renderVersion = store.sceneVersion
    const scheme = activeScheme.value!
    const history = scheme.history.value!

    if (scheme.source.value === 'cloud') {
      // 在云上，把快进重新打作一笔新交易向服务器推送
      const replayed = createReplayTransaction(entry.transaction, 'redo')

      // 因为向 Undo 栈归案保存是一个在未来不应该被视为合规的动作，需要附加上各种状态限制
      history.transactionUndoStack.push(
        markRaw(
          createTransactionEntry(
            {
              transaction: replayed,
              selectionBefore: entry.selectionBefore,
              selectionAfter: entry.selectionAfter,
              committed: false,
              stale: false,
            },
            history
          )
        )
      )
      trimToMaxSize(history.transactionUndoStack, history.maxSize)
      // 在本地施加变换效果并上传
      applyEditorTransactionToScheme(scheme, replayed)
      store.enqueuePendingTransaction(replayed)
    } else {
      // 把它从 redo 推回 undo
      history.transactionUndoStack.push(markRaw(createTransactionEntry(entry, history)))
      trimToMaxSize(history.transactionUndoStack, history.maxSize)
      // 施加正向转换计算效果
      applyEditorTransactionToScheme(scheme, entry.transaction)
    }

    // 由于是快进，所以把选区设置为当时的改变结束后（selectionAfter）的样子
    scheme.selectedItemIds.value = cloneSelection(entry.selectionAfter)
    if (transactionAffectsScene(entry.transaction)) store.triggerSceneUpdate()
    store.recordRenderTransaction(entry.transaction, renderVersion)
    store.triggerSelectionUpdate()
    store.triggerHistoryUpdate()
  }

  /**
   * 获取意向去倒退的步骤行为。此入口通常由快捷键 Ctrl+Z 点击调用。
   */
  function undo() {
    const scheme = activeScheme.value
    const history = scheme?.history.value
    if (!scheme || !history) {
      console.log('[History] 没有可撤销的操作或历史栈未就绪')
      return // 安全退出
    }

    // 请求解析最优的下一步应该撤销的内容（是选区，还是真正在发生物品变化的回退？）
    const target = getStackTarget(history.selectionUndoStack, history.transactionUndoStack)
    if (!target) {
      console.log('[History] 尚未存在任何可以撤销的新数据了。')
      return
    }

    // 只撤回调色、重选等虚假UI层的东西
    if (target.type === 'selection') {
      const entry = history.selectionUndoStack.pop()!
      // 将现有的推去“快进堆栈”备份
      history.selectionRedoStack.push(
        markRaw(createSelectionEntry(scheme.selectedItemIds.value, history))
      )
      trimToMaxSize(history.selectionRedoStack, history.maxSize)
      // 修改数据让UI响应
      restoreSelectionEntry(entry)
      store.triggerHistoryUpdate()
      return
    }

    // 真正地撤回物品数据
    const entry = history.transactionUndoStack.pop()!
    undoTransaction(entry)
  }

  /**
   * 获取意向去快进的步骤行为（也就是撤回的后悔药）。此入口通常由快捷键 Ctrl+Y / Shift+Ctrl+Z 调用。
   */
  function redo() {
    const scheme = activeScheme.value
    const history = scheme?.history.value
    if (!scheme || !history) {
      console.log('[History] 没有可重做的操作')
      return
    }

    const target = getStackTarget(history.selectionRedoStack, history.transactionRedoStack)
    if (!target) {
      console.log('[History] 没有可重做的操作')
      return
    }

    if (target.type === 'selection') {
      const entry = history.selectionRedoStack.pop()!
      history.selectionUndoStack.push(
        markRaw(createSelectionEntry(scheme.selectedItemIds.value, history))
      )
      trimToMaxSize(history.selectionUndoStack, history.maxSize)
      restoreSelectionEntry(entry)
      store.triggerHistoryUpdate()
      return
    }

    const entry = history.transactionRedoStack.pop()!
    redoTransaction(entry)
  }

  function canUndo(): boolean {
    const history = activeScheme.value?.history.value
    if (!history) return false
    return getStackTarget(history.selectionUndoStack, history.transactionUndoStack) !== null
  }

  function canRedo(): boolean {
    const history = activeScheme.value?.history.value
    if (!history) return false
    return getStackTarget(history.selectionRedoStack, history.transactionRedoStack) !== null
  }

  // ========== 云协同标记与脏数据状态关联 ==========

  /**
   * 将在协同服务器成功处理（并向你发出 Ack 的回复记录）进行状态变更：
   * 将它的 committed 字段设置为 true.
   *
   * 必须被设置为 true(不再处于 pending状态)才能让这步交易可撤回。
   */
  function markTransactionCommitted(
    schemeId: string,
    transactionId: string,
    authoritative?: EditorTransaction
  ) {
    const scheme = store.getSchemeById(schemeId)
    const history = scheme?.history.value
    if (!history) return

    for (const stackEntry of [...history.transactionUndoStack, ...history.transactionRedoStack]) {
      if (stackEntry.transaction.id === transactionId) {
        if (authoritative) stackEntry.transaction = structuredClone(authoritative)
        stackEntry.committed = true
      }
    }

    store.triggerHistoryUpdate()
  }

  /**
   * 重要！如果协同环境下某人在当前位置拉了你昨天放的沙发位置并且变大缩放它，
   * 系统需要知道自己先前的那些旧步骤可能“不能再被原封不动且合理地撤销了”。如果不加这种机制
   * 人们就会产生诡异的前往未来的“不可预测的时空错位”，这种问题称作 “Stale Undo (废旧过期撤销)”。
   * 此方法标记受到服务器覆盖冲突的历史节点为 stale: true。
   */
  function markTransactionsStale(
    schemeId: string,
    touchedItemIds: Set<string>,
    touchedGroupIds = new Set<number>(),
    treeChanged = false
  ) {
    if (!treeChanged && touchedItemIds.size === 0 && touchedGroupIds.size === 0) return

    const scheme = store.getSchemeById(schemeId)
    const history = scheme?.history.value
    if (!history) return

    let changed = false
    // 检查历史动作里，有谁关联的家具有在这个新发生的事件(受到别人的物品拖曳或添加事件)中被触摸过
    for (const stackEntry of [...history.transactionUndoStack, ...history.transactionRedoStack]) {
      if (
        treeChanged &&
        stackEntry.transaction.ops.some((op) => op.type === 'set_collection_tree')
      ) {
        stackEntry.stale = true
        changed = true
        continue
      }
      if (stackEntry.stale) continue // 如果本就废弃就无需二次标注

      if (
        stackEntry.transaction.ops.some(
          (op) => op.type === 'set_group_names' || op.type === 'set_group_origins'
        )
      ) {
        const groups = collectTransactionTouchedGroupIds(stackEntry.transaction)
        if ([...groups].some((id) => touchedGroupIds.has(id))) {
          stackEntry.stale = true
          changed = true
          continue
        }
      }

      const localTouchedIds = collectTransactionTouchedItemIds(
        stackEntry.transaction,
        scheme!.items.value
      )
      for (const itemId of touchedItemIds) {
        if (localTouchedIds.has(itemId)) {
          // 找到了：这笔自己的旧记录试图修改的部分，被别人(别人服务器端)截胡了
          stackEntry.stale = true
          changed = true
          break
        }
      }
    }

    if (changed) {
      store.triggerHistoryUpdate()
    }
  }

  // 供应用逻辑所挂载的接口面
  return {
    recordSelectionChange,
    recordTransaction,
    markTransactionCommitted,
    markTransactionsStale,
    undo,
    redo,
    canUndo,
    canRedo,
    initHistoryStack,
  }
}

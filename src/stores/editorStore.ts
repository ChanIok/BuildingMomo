import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AppItem,
  GameItem,
  GameDataFile,
  HomeScheme,
  TransformParams,
  HistorySnapshot,
  HistoryStack,
} from '../types/editor'
import { useTabStore } from './tabStore'
import { useSettingsStore } from './settingsStore'

// 生成简单的UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// 3D旋转：将点绕中心旋转（群组旋转）
function rotatePoint3D(
  point: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  rotation: { x?: number; y?: number; z?: number }
): { x: number; y: number; z: number } {
  // 转换为相对中心的坐标
  let px = point.x - center.x
  let py = point.y - center.y
  let pz = point.z - center.z

  // 依次应用旋转（顺序：X -> Y -> Z，对应 Roll -> Pitch -> Yaw）
  // 1. 绕X轴旋转（Roll）
  if (rotation.x) {
    const angleRad = (rotation.x * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const newPy = py * cos - pz * sin
    const newPz = py * sin + pz * cos
    py = newPy
    pz = newPz
  }

  // 2. 绕Y轴旋转（Pitch）
  if (rotation.y) {
    const angleRad = (rotation.y * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const newPx = px * cos + pz * sin
    const newPz = -px * sin + pz * cos
    px = newPx
    pz = newPz
  }

  // 3. 绕Z轴旋转（Yaw）
  if (rotation.z) {
    const angleRad = (rotation.z * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const newPx = px * cos - py * sin
    const newPy = px * sin + py * cos
    px = newPx
    py = newPy
  }

  // 转回世界坐标
  return {
    x: px + center.x,
    y: py + center.y,
    z: pz + center.z,
  }
}

export const useEditorStore = defineStore('editor', () => {
  // 多方案状态
  const schemes = ref<HomeScheme[]>([])
  const activeSchemeId = ref<string | null>(null)

  // 全局剪贴板（支持跨方案复制粘贴）
  const clipboard = ref<AppItem[]>([])

  // 计算属性：当前激活的方案
  const activeScheme = computed(
    () => schemes.value.find((s) => s.id === activeSchemeId.value) ?? null
  )

  // 向后兼容的计算属性（指向当前激活方案）
  const items = computed(() => activeScheme.value?.items ?? [])

  // 性能优化：建立 itemId -> item 的索引映射，避免频繁的 find 操作
  const itemsMap = computed(() => {
    const map = new Map<string, AppItem>()
    if (!activeScheme.value) return map

    activeScheme.value.items.forEach((item) => {
      map.set(item.internalId, item)
    })
    return map
  })

  // 性能优化：建立 groupId -> itemIds 的索引映射，加速组扩展
  const groupsMap = computed(() => {
    const map = new Map<number, Set<string>>()
    if (!activeScheme.value) return map

    activeScheme.value.items.forEach((item) => {
      const gid = item.originalData.GroupID
      if (gid > 0) {
        if (!map.has(gid)) {
          map.set(gid, new Set())
        }
        map.get(gid)!.add(item.internalId)
      }
    })
    return map
  })

  const selectedItemIds = computed(() => activeScheme.value?.selectedItemIds ?? new Set<string>())

  // 计算属性：边界框
  const bounds = computed(() => {
    if (items.value.length === 0) return null

    const xs = items.value.map((i) => i.x)
    const ys = items.value.map((i) => i.y)
    const zs = items.value.map((i) => i.z)

    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)

    return {
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      centerZ: (minZ + maxZ) / 2,
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ,
    }
  })

  // 计算属性：统计信息
  const stats = computed(() => {
    // 统计组信息
    const groups = new Map<number, number>() // groupId -> count
    items.value.forEach((item) => {
      const gid = item.originalData.GroupID
      if (gid > 0) {
        groups.set(gid, (groups.get(gid) || 0) + 1)
      }
    })

    const groupedItemsCount = Array.from(groups.values()).reduce((a, b) => a + b, 0)

    return {
      totalItems: items.value.length,
      selectedItems: selectedItemIds.value.size,
      groups: {
        totalGroups: groups.size,
        groupedItems: groupedItemsCount,
        ungroupedItems: items.value.length - groupedItemsCount,
      },
    }
  })

  // 计算属性：选中的物品列表
  const selectedItems = computed(() => {
    return items.value.filter((item) => selectedItemIds.value.has(item.internalId))
  })

  // ========== 重复物品检测 ==========

  // 计算属性：重复的物品组（按位置、旋转、缩放分组）
  const duplicateGroups = computed<AppItem[][]>(() => {
    const settingsStore = useSettingsStore()

    // 如果未启用检测或没有活动方案，返回空数组
    if (!settingsStore.settings.enableDuplicateDetection || !activeScheme.value) {
      return []
    }

    const startTime = performance.now()

    // Map索引：key = "gameId,x,y,z,pitch,yaw,roll,scaleX,scaleY,scaleZ", value = AppItem[]
    const itemMap = new Map<string, AppItem[]>()

    activeScheme.value.items.forEach((item) => {
      const rot = item.originalData.Rotation
      const scale = item.originalData.Scale
      const key = `${item.gameId},${item.x},${item.y},${item.z},${rot.Pitch},${rot.Yaw},${rot.Roll},${scale.X},${scale.Y},${scale.Z}`
      if (!itemMap.has(key)) {
        itemMap.set(key, [])
      }
      itemMap.get(key)!.push(item)
    })

    // 过滤出重复的组（count > 1）
    const duplicates = Array.from(itemMap.values()).filter((group) => group.length > 1)

    const elapsed = performance.now() - startTime
    if (import.meta.env.DEV && activeScheme.value.items.length > 100) {
      console.log(
        `[Duplicate Detection] ${elapsed.toFixed(2)}ms for ${activeScheme.value.items.length} items, found ${duplicates.length} duplicate groups`
      )
    }

    return duplicates
  })

  // 计算属性：是否存在重复物品
  const hasDuplicate = computed(() => duplicateGroups.value.length > 0)

  // 计算属性：重复物品总数（只计算多余的，不包括每组保留的第一个）
  const duplicateItemCount = computed(() => {
    return duplicateGroups.value.reduce((sum, group) => sum + (group.length - 1), 0)
  })

  // 选择所有重复的物品（保留每组的第一个）
  function selectDuplicateItems() {
    if (!activeScheme.value || duplicateGroups.value.length === 0) return

    // 保存历史（选择操作）
    saveHistory('selection')

    // 清空当前选择
    activeScheme.value.selectedItemIds.clear()

    // 选中除第一个之外的重复物品
    duplicateGroups.value.forEach((group) => {
      group.slice(1).forEach((item) => {
        activeScheme.value!.selectedItemIds.add(item.internalId)
      })
    })

    console.log(
      `[Duplicate Detection] Selected ${duplicateItemCount.value} duplicate items (excluding first of each group)`
    )
  }

  // ========== 历史记录管理 ==========

  // 初始化历史栈
  function initHistoryStack(): HistoryStack {
    return {
      undoStack: [],
      redoStack: [],
      maxSize: 50,
    }
  }

  // 深拷贝物品数组（使用 JSON 序列化，安全但性能稍低）
  function cloneItems(items: AppItem[]): AppItem[] {
    // 使用 JSON.parse(JSON.stringify()) 进行深拷贝
    // 这种方法可以安全地处理所有可序列化的数据
    return JSON.parse(JSON.stringify(items))
  }

  // 深拷贝选择集合
  function cloneSelection(selection: Set<string>): Set<string> {
    return new Set(selection)
  }

  // 保存历史记录
  function saveHistory(type: 'edit' | 'selection' = 'edit') {
    if (!activeScheme.value) return

    // 确保历史栈已初始化
    if (!activeScheme.value.history) {
      activeScheme.value.history = initHistoryStack()
    }

    const history = activeScheme.value.history

    // 方案A：选择操作合并策略
    // 如果是选择操作且栈顶也是选择操作，则替换而不是新增
    if (type === 'selection' && history.undoStack.length > 0) {
      const lastSnapshot = history.undoStack[history.undoStack.length - 1]
      if (lastSnapshot && lastSnapshot.type === 'selection') {
        // 仅更新选择集合和时间戳，避免重复深拷贝 items
        lastSnapshot.selectedItemIds = cloneSelection(activeScheme.value.selectedItemIds)
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
        selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds),
        timestamp: Date.now(),
        type,
      }
    } else {
      // 编辑操作：保存完整的物品数据和选择状态
      snapshot = {
        items: cloneItems(activeScheme.value.items),
        selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds),
        timestamp: Date.now(),
        type,
      }
    }

    // 推入撤销栈
    history.undoStack.push(snapshot)

    // 限制栈大小
    if (history.undoStack.length > history.maxSize) {
      history.undoStack.shift()
    }

    // 清空重做栈（新操作会使重做历史失效）
    history.redoStack = []
  }

  // 撤销操作
  function undo() {
    if (!activeScheme.value?.history) return
    const history = activeScheme.value.history

    if (history.undoStack.length === 0) {
      console.log('[History] 没有可撤销的操作')
      return
    }

    // 保存当前状态到重做栈
    const currentSnapshot: HistorySnapshot = {
      items: cloneItems(activeScheme.value.items),
      selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds),
      timestamp: Date.now(),
      type: 'edit', // 重做栈不区分类型
    }
    history.redoStack.push(currentSnapshot)

    // 从撤销栈弹出并恢复状态
    const snapshot = history.undoStack.pop()!

    if (snapshot.type === 'edit') {
      // 编辑操作：恢复物品和选择状态
      if (snapshot.items) {
        activeScheme.value.items = cloneItems(snapshot.items)
      }
      activeScheme.value.selectedItemIds = cloneSelection(snapshot.selectedItemIds)
    } else if (snapshot.type === 'selection') {
      // 选择操作：只恢复选择状态，避免不必要的物品深拷贝
      activeScheme.value.selectedItemIds = cloneSelection(snapshot.selectedItemIds)
    }

    console.log(`[History] 撤销操作 (类型: ${snapshot.type})`)
  }

  // 重做操作
  function redo() {
    if (!activeScheme.value?.history) return
    const history = activeScheme.value.history

    if (history.redoStack.length === 0) {
      console.log('[History] 没有可重做的操作')
      return
    }

    // 保存当前状态到撤销栈
    const currentSnapshot: HistorySnapshot = {
      items: cloneItems(activeScheme.value.items),
      selectedItemIds: cloneSelection(activeScheme.value.selectedItemIds),
      timestamp: Date.now(),
      type: 'edit',
    }
    history.undoStack.push(currentSnapshot)

    // 从重做栈弹出并恢复状态
    const snapshot = history.redoStack.pop()!

    if (snapshot.type === 'edit') {
      if (snapshot.items) {
        activeScheme.value.items = cloneItems(snapshot.items)
      }
      activeScheme.value.selectedItemIds = cloneSelection(snapshot.selectedItemIds)
    } else if (snapshot.type === 'selection') {
      activeScheme.value.selectedItemIds = cloneSelection(snapshot.selectedItemIds)
    }

    console.log('[History] 重做操作')
  }

  // 检查是否可以撤销
  function canUndo(): boolean {
    return (activeScheme.value?.history?.undoStack.length ?? 0) > 0
  }

  // 检查是否可以重做
  function canRedo(): boolean {
    return (activeScheme.value?.history?.redoStack.length ?? 0) > 0
  }

  // ========== 方案管理 ==========

  // 方案管理：创建新方案
  function createScheme(name: string = '未命名方案'): string {
    const newScheme: HomeScheme = {
      id: generateUUID(),
      name,
      items: [],
      selectedItemIds: new Set(),
    }

    schemes.value.push(newScheme)
    activeSchemeId.value = newScheme.id

    // 同步到 TabStore
    const tabStore = useTabStore()
    tabStore.openSchemeTab(newScheme.id, newScheme.name)

    return newScheme.id
  }

  // 导入JSON为新方案
  async function importJSONAsScheme(
    fileContent: string,
    fileName: string,
    fileLastModified?: number
  ): Promise<{ success: boolean; schemeId?: string; error?: string }> {
    try {
      const data: GameDataFile = JSON.parse(fileContent)

      // 检查基本结构
      if (!data.hasOwnProperty('PlaceInfo')) {
        throw new Error('Invalid JSON format: PlaceInfo field not found')
      }

      // 处理 PlaceInfo 的不同格式
      let placeInfoArray: GameItem[] = []
      if (Array.isArray(data.PlaceInfo)) {
        // PlaceInfo 是数组（正常情况）
        placeInfoArray = data.PlaceInfo
      } else if (typeof data.PlaceInfo === 'object' && data.PlaceInfo !== null) {
        // PlaceInfo 是空对象 {}（游戏未建造或清空时），视为空数组
        placeInfoArray = []
      } else {
        throw new Error('Invalid JSON format: PlaceInfo must be an array or object')
      }

      // 转换为内部数据格式（允许空数组，创建空白方案）
      const newItems: AppItem[] = placeInfoArray.map((gameItem: GameItem) => ({
        internalId: generateUUID(),
        gameId: gameItem.ItemID,
        instanceId: gameItem.InstanceID,
        x: gameItem.Location.X,
        y: gameItem.Location.Y,
        z: gameItem.Location.Z,
        originalData: gameItem,
      }))

      // 从文件名提取方案名称（去除.json后缀）
      const schemeName = fileName.replace(/\.json$/i, '')

      // 创建新方案
      const newScheme: HomeScheme = {
        id: generateUUID(),
        name: schemeName,
        filePath: fileName,
        items: newItems,
        selectedItemIds: new Set(),
        lastModified: fileLastModified,
      }

      schemes.value.push(newScheme)
      activeSchemeId.value = newScheme.id

      // 同步到 TabStore
      const tabStore = useTabStore()
      tabStore.openSchemeTab(newScheme.id, newScheme.name)

      return { success: true, schemeId: newScheme.id }
    } catch (error) {
      console.error('Failed to import JSON:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  // 方案管理：关闭方案
  function closeScheme(schemeId: string) {
    // 先从 TabStore 关闭标签
    const tabStore = useTabStore()
    const tab = tabStore.tabs.find((t) => t.schemeId === schemeId)
    if (tab) {
      tabStore.closeTab(tab.id)
    }

    const index = schemes.value.findIndex((s) => s.id === schemeId)
    if (index === -1) return

    schemes.value.splice(index, 1)

    // 如果关闭的是当前激活方案，切换到其他方案
    if (activeSchemeId.value === schemeId) {
      if (schemes.value.length > 0) {
        // 优先切换到前一个，否则切换到第一个
        const newIndex = Math.max(0, index - 1)
        const nextScheme = schemes.value[newIndex]
        if (nextScheme) {
          activeSchemeId.value = nextScheme.id
        }
      } else {
        activeSchemeId.value = null
      }
    }
  }

  // 方案管理：切换激活方案
  function setActiveScheme(schemeId: string) {
    if (schemes.value.some((s) => s.id === schemeId)) {
      activeSchemeId.value = schemeId
    }
  }

  // 方案管理：重命名方案
  function renameScheme(schemeId: string, newName: string) {
    const scheme = schemes.value.find((s) => s.id === schemeId)
    if (scheme) {
      scheme.name = newName

      // 同步到 TabStore
      const tabStore = useTabStore()
      tabStore.updateSchemeTabName(schemeId, newName)
    }
  }

  // 保存当前视图配置
  function saveCurrentViewConfig(config: { scale: number; x: number; y: number }) {
    if (!activeScheme.value) return
    activeScheme.value.currentViewConfig = config
  }

  // 获取保存的视图配置
  function getSavedViewConfig(): { scale: number; x: number; y: number } | null {
    if (!activeScheme.value) return null
    return activeScheme.value.currentViewConfig ?? null
  }

  // 清空数据
  function clearData() {
    schemes.value = []
    activeSchemeId.value = null
    clipboard.value = []
  }

  // 选择功能
  function toggleSelection(itemId: string, additive: boolean) {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    if (additive) {
      if (activeScheme.value.selectedItemIds.has(itemId)) {
        // 取消选择：如果是组，取消整组
        const groupId = getItemGroupId(itemId)
        if (groupId > 0) {
          const groupItems = getGroupItems(groupId)
          groupItems.forEach((item) => activeScheme.value!.selectedItemIds.delete(item.internalId))
        } else {
          activeScheme.value.selectedItemIds.delete(itemId)
        }
      } else {
        // 添加选择：如果是组，选中整组
        const groupId = getItemGroupId(itemId)
        if (groupId > 0) {
          const groupItems = getGroupItems(groupId)
          groupItems.forEach((item) => activeScheme.value!.selectedItemIds.add(item.internalId))
        } else {
          activeScheme.value.selectedItemIds.add(itemId)
        }
      }
    } else {
      activeScheme.value.selectedItemIds.clear()
      // 如果是组，选中整组
      const groupId = getItemGroupId(itemId)
      if (groupId > 0) {
        const groupItems = getGroupItems(groupId)
        groupItems.forEach((item) => activeScheme.value!.selectedItemIds.add(item.internalId))
      } else {
        activeScheme.value.selectedItemIds.add(itemId)
      }
    }
  }

  function updateSelection(itemIds: string[], additive: boolean) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    if (!additive) {
      activeScheme.value.selectedItemIds.clear()
    }

    // 扩展选择到整组(框选行为)
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)
    expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.add(id))
  }

  // 减选功能:从当前选择中移除指定物品
  function deselectItems(itemIds: string[]) {
    if (!activeScheme.value) return

    // 保存历史(选择操作,会合并)
    saveHistory('selection')

    // 扩展选择到整组(框选行为)
    const initialSelection = new Set(itemIds)
    const expandedSelection = expandSelectionToGroups(initialSelection)
    expandedSelection.forEach((id) => activeScheme.value!.selectedItemIds.delete(id))
  }

  function clearSelection() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    activeScheme.value.selectedItemIds.clear()
  }

  // 移动选中物品（注意：不在这里保存历史，由拖拽结束时统一保存）
  function moveSelectedItems(dx: number, dy: number) {
    if (!activeScheme.value) return

    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
          originalData: {
            ...item.originalData,
            Location: {
              ...item.originalData.Location,
              X: item.x + dx,
              Y: item.y + dy,
            },
          },
        }
      }
      return item
    })
  }

  // 3D 移动选中物品（XYZ），不在此保存历史，由调用方控制
  function moveSelectedItems3D(dx: number, dy: number, dz: number) {
    if (!activeScheme.value) {
      return
    }

    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return item
      }

      const newX = item.x + dx
      const newY = item.y + dy
      const newZ = item.z + dz

      return {
        ...item,
        x: newX,
        y: newY,
        z: newZ,
        originalData: {
          ...item.originalData,
          Location: {
            ...item.originalData.Location,
            X: newX,
            Y: newY,
            Z: newZ,
          },
        },
      }
    })
  }

  // 复制选中物品（带偏移）
  function duplicateSelected(offsetX: number = 0, offsetY: number = 0): string[] {
    if (!activeScheme.value) return []

    // 保存历史（编辑操作）
    saveHistory('edit')

    const newIds: string[] = []
    const duplicates: AppItem[] = []
    let nextInstanceId = getNextInstanceId()

    // 收集选中物品的所有组ID，为每个组分配新的 GroupID
    const groupIdMap = new Map<number, number>() // 旧GroupID -> 新GroupID

    activeScheme.value.items.forEach((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        const oldGroupId = item.originalData.GroupID
        if (oldGroupId > 0 && !groupIdMap.has(oldGroupId)) {
          groupIdMap.set(oldGroupId, getNextGroupId() + groupIdMap.size)
        }
      }
    })

    activeScheme.value.items.forEach((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        const newId = generateUUID()
        const newInstanceId = nextInstanceId++
        newIds.push(newId)

        const newX = item.x + offsetX
        const newY = item.y + offsetY

        // 如果物品有组，分配新的 GroupID
        const oldGroupId = item.originalData.GroupID
        const newGroupId = oldGroupId > 0 ? groupIdMap.get(oldGroupId)! : 0

        duplicates.push({
          ...item,
          internalId: newId,
          instanceId: newInstanceId,
          x: newX,
          y: newY,
          originalData: {
            ...item.originalData,
            InstanceID: newInstanceId,
            GroupID: newGroupId,
            Location: {
              ...item.originalData.Location,
              X: newX,
              Y: newY,
            },
          },
        })
      }
    })

    activeScheme.value.items.push(...duplicates)

    // 选中新副本
    activeScheme.value.selectedItemIds.clear()
    newIds.forEach((id) => activeScheme.value!.selectedItemIds.add(id))

    return newIds
  }

  // 删除选中物品
  function deleteSelected() {
    if (!activeScheme.value) return

    // 保存历史（编辑操作）
    saveHistory('edit')

    activeScheme.value.items = activeScheme.value.items.filter(
      (item) => !activeScheme.value!.selectedItemIds.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.clear()
  }

  // 全选可见物品
  function selectAll() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    activeScheme.value.selectedItemIds.clear()
    items.value.forEach((item) => {
      activeScheme.value!.selectedItemIds.add(item.internalId)
    })
  }

  // 反选
  function invertSelection() {
    if (!activeScheme.value) return

    // 保存历史（选择操作，会合并）
    saveHistory('selection')

    const newSelection = new Set<string>()
    items.value.forEach((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        newSelection.add(item.internalId)
      }
    })
    activeScheme.value.selectedItemIds = newSelection
  }

  // 获取下一个唯一的 InstanceID（自增策略）
  function getNextInstanceId(): number {
    if (!activeScheme.value || activeScheme.value.items.length === 0) return 1

    const maxId = activeScheme.value.items.reduce((max, item) => Math.max(max, item.instanceId), 0)
    return maxId + 1
  }

  // ========== 组编辑功能 ==========

  // 获取下一个唯一的 GroupID（自增策略）
  function getNextGroupId(): number {
    if (!activeScheme.value || activeScheme.value.items.length === 0) return 1

    const maxId = activeScheme.value.items.reduce(
      (max, item) => Math.max(max, item.originalData.GroupID),
      0
    )
    return maxId + 1
  }

  // 获取指定组的所有物品（使用 groupsMap 和 itemsMap 优化性能）
  function getGroupItems(groupId: number): AppItem[] {
    if (!activeScheme.value || groupId <= 0) return []

    const itemIds = groupsMap.value.get(groupId)
    if (!itemIds) return []

    // 使用 itemsMap 快速获取物品对象
    const items: AppItem[] = []
    itemIds.forEach((id) => {
      const item = itemsMap.value.get(id)
      if (item) items.push(item)
    })
    return items
  }

  // 获取物品的组ID（使用 itemsMap 优化性能）
  function getItemGroupId(itemId: string): number {
    if (!activeScheme.value) return 0
    const item = itemsMap.value.get(itemId)
    return item?.originalData.GroupID ?? 0
  }

  // 获取所有组ID列表（去重）（使用 groupsMap 优化性能）
  function getAllGroupIds(): number[] {
    return Array.from(groupsMap.value.keys()).sort((a, b) => a - b)
  }

  // 扩展选择到整组（内部辅助函数）
  function expandSelectionToGroups(itemIds: Set<string>): Set<string> {
    if (!activeScheme.value) return itemIds

    const expandedIds = new Set(itemIds)
    const groupsToExpand = new Set<number>()

    // 收集所有涉及的组ID
    itemIds.forEach((id) => {
      const groupId = getItemGroupId(id)
      if (groupId > 0) {
        groupsToExpand.add(groupId)
      }
    })

    // 扩展选择到整组（直接使用 groupsMap 获取 itemIds）
    groupsToExpand.forEach((groupId) => {
      const itemIds = groupsMap.value.get(groupId)
      if (itemIds) {
        itemIds.forEach((itemId) => expandedIds.add(itemId))
      }
    })

    return expandedIds
  }

  // 成组：将选中的物品成组
  function groupSelected() {
    if (!activeScheme.value) return
    if (activeScheme.value.selectedItemIds.size < 2) {
      console.warn('[Group] 至少需要选中2个物品才能成组')
      return
    }

    // 保存历史（编辑操作）
    saveHistory('edit')

    const newGroupId = getNextGroupId()

    // 更新所有选中物品的 GroupID
    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return {
          ...item,
          originalData: {
            ...item.originalData,
            GroupID: newGroupId,
          },
        }
      }
      return item
    })

    console.log(
      `[Group] 成功创建组 #${newGroupId}，包含 ${activeScheme.value.selectedItemIds.size} 个物品`
    )
  }

  // 取消组合：将选中的物品解散组
  function ungroupSelected() {
    if (!activeScheme.value) return
    if (activeScheme.value.selectedItemIds.size === 0) return

    // 检查是否有组
    const hasGroup = Array.from(activeScheme.value.selectedItemIds).some((id) => {
      const groupId = getItemGroupId(id)
      return groupId > 0
    })

    if (!hasGroup) {
      console.warn('[Group] 选中的物品没有组')
      return
    }

    // 保存历史（编辑操作）
    saveHistory('edit')

    // 将所有选中物品的 GroupID 设为 0
    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return {
          ...item,
          originalData: {
            ...item.originalData,
            GroupID: 0,
          },
        }
      }
      return item
    })

    console.log(`[Group] 已取消 ${activeScheme.value.selectedItemIds.size} 个物品的组合`)
  }

  // HSL 转 RGBA 的工具函数
  function hslToRgba(h: number, s: number, l: number, a: number = 1): string {
    s /= 100
    l /= 100

    const k = (n: number) => (n + h / 30) % 12
    const f = (n: number) =>
      l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))

    const r = Math.round(255 * f(0))
    const g = Math.round(255 * f(8))
    const b = Math.round(255 * f(4))

    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  // 根据 GroupID 计算组颜色（使用黄金角度分布）
  function getGroupColor(groupId: number): string {
    if (groupId <= 0) return 'rgba(0, 0, 0, 0)' // transparent
    const hue = (groupId * 137.5) % 360 // 黄金角度，分布更均匀
    return hslToRgba(hue, 70, 60, 0.8) // 直接返回带透明度的 RGBA
  }

  // 跨方案剪贴板：复制到剪贴板
  function copyToClipboard() {
    if (!activeScheme.value) return

    clipboard.value = activeScheme.value.items
      .filter((item) => activeScheme.value!.selectedItemIds.has(item.internalId))
      .map((item) => ({ ...item })) // 深拷贝
  }

  // 跨方案剪贴板：剪切到剪贴板
  function cutToClipboard() {
    // 保存历史（编辑操作）
    saveHistory('edit')

    copyToClipboard()
    // deleteSelected 内部已经保存历史，但因为我们已经保存了，需要避免重复
    // 直接删除，不再调用 deleteSelected
    if (!activeScheme.value) return
    activeScheme.value.items = activeScheme.value.items.filter(
      (item) => !activeScheme.value!.selectedItemIds.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.clear()
  }

  // 跨方案剪贴板：从剪贴板粘贴
  function pasteFromClipboard(offsetX: number = 0, offsetY: number = 0): string[] {
    if (!activeScheme.value || clipboard.value.length === 0) return []

    return pasteItems(clipboard.value, offsetX, offsetY)
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
      const oldGroupId = item.originalData.GroupID
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
      const oldGroupId = item.originalData.GroupID
      const newGroupId = oldGroupId > 0 ? groupIdMap.get(oldGroupId)! : 0

      newItems.push({
        ...item,
        internalId: newId,
        instanceId: newInstanceId,
        x: newX,
        y: newY,
        originalData: {
          ...item.originalData,
          InstanceID: newInstanceId,
          GroupID: newGroupId,
          Location: {
            ...item.originalData.Location,
            X: newX,
            Y: newY,
          },
        },
      })
    })

    activeScheme.value.items.push(...newItems)

    // 选中新粘贴的物品
    activeScheme.value.selectedItemIds.clear()
    newIds.forEach((id) => activeScheme.value!.selectedItemIds.add(id))

    return newIds
  }

  // 精确变换选中物品（位置和旋转）
  function updateSelectedItemsTransform(params: TransformParams) {
    if (!activeScheme.value) return

    // 保存历史（编辑操作）
    saveHistory('edit')

    const { mode, position, rotation } = params
    const selected = selectedItems.value

    if (selected.length === 0) return

    // 计算选区中心（用于旋转和绝对位置）
    const center = getSelectedItemsCenter()
    if (!center) return

    // 计算位置偏移量
    let positionOffset = { x: 0, y: 0, z: 0 }

    if (mode === 'absolute' && position) {
      // 绝对模式：移动到指定坐标
      positionOffset = {
        x: (position.x ?? center.x) - center.x,
        y: (position.y ?? center.y) - center.y,
        z: (position.z ?? center.z) - center.z,
      }
    } else if (mode === 'relative' && position) {
      // 相对模式：偏移指定距离
      positionOffset = {
        x: position.x ?? 0,
        y: position.y ?? 0,
        z: position.z ?? 0,
      }
    }

    // 更新物品
    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return item
      }

      let newX = item.x
      let newY = item.y
      let newZ = item.z
      const currentRotation = item.originalData.Rotation
      let newRoll = currentRotation.Roll
      let newPitch = currentRotation.Pitch
      let newYaw = currentRotation.Yaw

      // 应用旋转（群组旋转：位置绕中心旋转 + 朝向同步旋转）
      if (rotation && (rotation.x || rotation.y || rotation.z)) {
        // 1. 位置绕中心旋转（公转）
        const rotatedPos = rotatePoint3D({ x: item.x, y: item.y, z: item.z }, center, rotation)
        newX = rotatedPos.x
        newY = rotatedPos.y
        newZ = rotatedPos.z

        // 2. 朝向同步旋转（自转）
        newRoll += rotation.x ?? 0
        newPitch += rotation.y ?? 0
        newYaw += rotation.z ?? 0
      }

      // 应用位置偏移
      newX += positionOffset.x
      newY += positionOffset.y
      newZ += positionOffset.z

      return {
        ...item,
        x: newX,
        y: newY,
        z: newZ,
        originalData: {
          ...item.originalData,
          Location: {
            X: newX,
            Y: newY,
            Z: newZ,
          },
          Rotation: {
            Pitch: newPitch,
            Yaw: newYaw,
            Roll: newRoll,
          },
        },
      }
    })
  }

  // 获取选中物品的中心坐标（用于UI显示）
  function getSelectedItemsCenter(): { x: number; y: number; z: number } | null {
    const selected = selectedItems.value
    if (selected.length === 0) {
      return null
    }

    return {
      x: selected.reduce((sum, item) => sum + item.x, 0) / selected.length,
      y: selected.reduce((sum, item) => sum + item.y, 0) / selected.length,
      z: selected.reduce((sum, item) => sum + item.z, 0) / selected.length,
    }
  }

  return {
    // 多方案状态
    schemes,
    activeSchemeId,
    activeScheme,
    clipboard,

    // 向后兼容的计算属性
    items,
    bounds,
    stats,
    selectedItemIds,
    selectedItems,

    // 重复物品检测
    duplicateGroups,
    hasDuplicate,
    duplicateItemCount,
    selectDuplicateItems,

    // 方案管理
    createScheme,
    importJSONAsScheme,
    closeScheme,
    setActiveScheme,
    renameScheme,
    saveCurrentViewConfig,
    getSavedViewConfig,
    clearData,

    // 选择操作
    toggleSelection,
    updateSelection,
    deselectItems,
    clearSelection,
    selectAll,
    invertSelection,

    // 编辑操作
    moveSelectedItems,
    moveSelectedItems3D,
    duplicateSelected,
    deleteSelected,
    updateSelectedItemsTransform,
    getSelectedItemsCenter,

    // 跨方案剪贴板
    copyToClipboard,
    cutToClipboard,
    pasteFromClipboard,
    pasteItems,

    // 历史记录
    saveHistory,
    undo,
    redo,
    canUndo,
    canRedo,

    // 组编辑
    groupSelected,
    ungroupSelected,
    getGroupItems,
    getItemGroupId,
    getAllGroupIds,
    getGroupColor,
  }
})

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppItem, GameItem, GameDataFile, HomeScheme, TransformParams } from '../types/editor'
import { useTabStore } from './tabStore'
import { useSettingsStore } from './settingsStore'
import { useEditorHistory } from '../composables/editor/useEditorHistory'
import { useEditorValidation } from '../composables/editor/useEditorValidation'
import { useEditorGroups } from '../composables/editor/useEditorGroups'
import { useClipboard } from '../composables/useClipboard'

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
  const settingsStore = useSettingsStore()

  // 多方案状态
  const schemes = ref<HomeScheme[]>([])
  const activeSchemeId = ref<string | null>(null)

  // 全局剪贴板（支持跨方案复制粘贴）
  const clipboardRef = ref<AppItem[]>([])

  // 当前工具状态
  const currentTool = ref<'select' | 'hand'>('select')

  // 可建造区域数据
  const buildableAreas = ref<Record<string, number[][]> | null>(null)
  const isBuildableAreaLoaded = ref(false)

  // 加载可建造区域数据
  async function loadBuildableAreaData() {
    if (isBuildableAreaLoaded.value) return

    try {
      const response = await fetch('/assets/data/home-buildable-area.json')
      if (!response.ok) throw new Error('Failed to load buildable area data')
      const data = await response.json()
      buildableAreas.value = data.polygons
      isBuildableAreaLoaded.value = true
      console.log('[EditorStore] Buildable area data loaded')
    } catch (error) {
      console.error('[EditorStore] Failed to load buildable area data:', error)
    }
  }

  // 初始化时加载数据
  loadBuildableAreaData()

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

  // ========== 历史记录 (Composables) ==========
  const { saveHistory, undo, redo, canUndo, canRedo } = useEditorHistory(activeScheme)

  // ========== 组管理 (Composables) ==========
  const {
    groupSelected,
    ungroupSelected,
    getGroupItems,
    getItemGroupId,
    getAllGroupIds,
    getGroupColor,
    getNextGroupId,
  } = useEditorGroups(activeScheme, itemsMap, groupsMap, saveHistory)

  // 获取下一个唯一的 InstanceID（自增策略）
  function getNextInstanceId(): number {
    if (!activeScheme.value || activeScheme.value.items.length === 0) return 1

    const maxId = activeScheme.value.items.reduce((max, item) => Math.max(max, item.instanceId), 0)
    return maxId + 1
  }

  // ========== 剪贴板 (Composables) ==========
  const { copyToClipboard, cutToClipboard, pasteFromClipboard, pasteItems, clipboard } =
    useClipboard(activeScheme, clipboardRef, saveHistory, getNextGroupId, getNextInstanceId)

  // ========== 验证逻辑 (Composables + Worker) ==========
  const {
    duplicateGroups,
    hasDuplicate,
    duplicateItemCount,
    selectDuplicateItems,
    limitIssues,
    hasLimitIssues,
    selectOutOfBoundsItems,
    selectOversizedGroupItems,
  } = useEditorValidation(
    activeScheme,
    buildableAreas,
    isBuildableAreaLoaded,
    computed(() => settingsStore.settings),
    saveHistory
  )

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
    clipboardRef.value = []
  }

  // ========== 选择操作 ==========

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

  // ========== 编辑操作 ==========

  // 移动选中物品（XYZ），不在此保存历史，由调用方控制
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
            ...item.originalData.Location,
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
    clipboard, // 来自 useClipboard 的 computed
    currentTool,

    // 向后兼容的计算属性
    items,
    bounds,
    stats,
    selectedItemIds,
    selectedItems,

    // 重复物品检测 (来自 Composable)
    duplicateGroups,
    hasDuplicate,
    duplicateItemCount,
    selectDuplicateItems,

    // Limitation Detection (来自 Composable)
    limitIssues,
    hasLimitIssues,
    selectOutOfBoundsItems,
    selectOversizedGroupItems,

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
    moveSelectedItems3D,
    deleteSelected,
    updateSelectedItemsTransform,
    getSelectedItemsCenter,

    // 跨方案剪贴板 (来自 Composable)
    copyToClipboard,
    cutToClipboard,
    pasteFromClipboard,
    pasteItems,

    // 历史记录 (来自 Composable)
    saveHistory,
    undo,
    redo,
    canUndo,
    canRedo,

    // 组编辑 (来自 Composable)
    groupSelected,
    ungroupSelected,
    getGroupItems,
    getItemGroupId,
    getAllGroupIds,
    getGroupColor,
  }
})

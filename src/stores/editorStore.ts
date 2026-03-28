import { defineStore } from 'pinia'
import { ref, computed, shallowRef, triggerRef } from 'vue'

// 选择动作类型
export type SelectionAction = 'new' | 'add' | 'subtract' | 'intersect' | 'toggle'

import type {
  AppItem,
  GameItem,
  GameDataFile,
  HomeScheme,
  ClosedSchemeHistory,
  ClipboardData,
} from '../types/editor'
import { useTabStore } from './tabStore'
import { useI18n } from '../composables/useI18n'

// 生成简单的UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const useEditorStore = defineStore('editor', () => {
  const { t } = useI18n()

  // 多方案状态 - 使用 ShallowRef 优化列表性能
  const schemes = shallowRef<HomeScheme[]>([])
  const activeSchemeId = ref<string | null>(null)

  // 全局剪贴板（支持跨方案复制粘贴）- 使用 ShallowRef
  const clipboardRef = shallowRef<ClipboardData>({
    sourceSchemeId: null,
    items: [],
    groupOrigins: new Map(),
  })

  // 关闭方案历史记录（最多保留10条）
  const MAX_CLOSED_HISTORY = 10
  const closedSchemesHistory = ref<ClosedSchemeHistory[]>([])

  // 当前工具状态
  const currentTool = ref<'select' | 'hand'>('select')
  // 选择模式：方块/套索
  const selectionMode = ref<'box' | 'lasso'>('box')
  // 选择行为：新选区/加选/减选/交叉/切换
  const selectionAction = ref<'new' | 'add' | 'subtract' | 'intersect' | 'toggle'>('new')
  // Gizmo 模式：平移/旋转/不显示
  const gizmoMode = ref<'translate' | 'rotate' | null>('translate')

  // 计算属性：当前激活的方案
  const activeScheme = computed(
    () => schemes.value.find((s) => s.id === activeSchemeId.value) ?? null
  )

  // 性能优化：建立 itemId -> item 的索引映射
  // 由于 items 是 computed，当 items.value 触发更新时，此映射也会重建
  const itemsMap = computed(() => {
    const map = new Map<string, AppItem>()
    const list = activeScheme.value?.items.value ?? []
    // 使用 for 循环通常比 forEach 略快，适合大数组
    for (const item of list) {
      map.set(item.internalId, item)
    }
    return map
  })

  // 性能优化：建立 groupId -> itemIds 的索引映射
  const groupsMap = computed(() => {
    const map = new Map<number, Set<string>>()
    const list = activeScheme.value?.items.value ?? []

    for (const item of list) {
      const gid = item.groupId
      if (gid > 0) {
        let group = map.get(gid)
        if (!group) {
          group = new Set()
          map.set(gid, group)
        }
        group.add(item.internalId)
      }
    }
    return map
  })

  // 场景版本号，用于通知外部监听者（如 ValidationStore）场景内容发生了变更
  // 即使是原地修改 (In-Place Mutation) 也会触发此版本号更新
  const sceneVersion = ref(0)
  // 选择状态版本号，用于低开销监听选中变化
  const selectionVersion = ref(0)
  // 历史栈版本号：undo/redo 会原地修改 history.value，用此版本号驱动撤销/重做按钮的 enabled 更新
  const historyVersion = ref(0)

  // 手动触发更新的方法
  function triggerSceneUpdate() {
    if (activeScheme.value) {
      triggerRef(activeScheme.value.items)
      sceneVersion.value++
    }
  }

  function triggerSelectionUpdate() {
    if (activeScheme.value) {
      triggerRef(activeScheme.value.selectedItemIds)
      selectionVersion.value++
    }
  }

  function triggerHistoryUpdate() {
    if (activeScheme.value) {
      historyVersion.value++
    }
  }

  // ========== 方案管理 ==========

  // 方案管理：创建新方案
  function createScheme(name?: string): string {
    const newScheme: HomeScheme = {
      id: generateUUID(),
      name: ref(name || t('scheme.unnamed')),
      filePath: ref(undefined),
      lastModified: ref(undefined),
      items: shallowRef([]),
      selectedItemIds: shallowRef(new Set()),
      maxInstanceId: ref(999), // 初始值，首个物品将从 1000 开始
      maxGroupId: ref(0), // 初始值，首个组将从 1 开始
      currentViewConfig: ref(undefined),
      viewState: ref(undefined),
      groupOrigins: shallowRef(new Map()),
      history: shallowRef(undefined),
    }

    schemes.value = [...schemes.value, newScheme]
    activeSchemeId.value = newScheme.id

    // 同步到 TabStore
    const tabStore = useTabStore()
    tabStore.openSchemeTab(newScheme.id, newScheme.name.value)

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
        placeInfoArray = data.PlaceInfo
      } else if (typeof data.PlaceInfo === 'object' && data.PlaceInfo !== null) {
        placeInfoArray = []
      } else {
        throw new Error('Invalid JSON format: PlaceInfo must be an array or object')
      }

      // 转换为内部数据格式（允许空数组，创建空白方案）
      const newItems: AppItem[] = placeInfoArray.map((gameItem: GameItem) => {
        const { Location, Rotation, GroupID, ItemID, InstanceID, ...others } = gameItem
        return {
          internalId: generateUUID(),
          gameId: ItemID,
          instanceId: InstanceID,
          x: Location.X,
          y: Location.Y,
          z: Location.Z,
          rotation: {
            x: Rotation.Roll,
            y: Rotation.Pitch,
            z: Rotation.Yaw,
          },
          groupId: GroupID,
          extra: others,
        }
      })

      // 计算导入数据的最大 InstanceID 和 GroupID
      let maxInstId = 999
      let maxGrpId = 0
      for (const item of newItems) {
        if (item.instanceId > maxInstId) maxInstId = item.instanceId
        if (item.groupId > maxGrpId) maxGrpId = item.groupId
      }

      // 从文件名提取方案名称
      const schemeName = t('scheme.defaultName', { n: schemes.value.length + 1 })

      // 创建新方案
      const newScheme: HomeScheme = {
        id: generateUUID(),
        name: ref(schemeName),
        filePath: ref(fileName),
        items: shallowRef(newItems),
        selectedItemIds: shallowRef(new Set()),
        maxInstanceId: ref(maxInstId), // 记录导入的最大 InstanceID
        maxGroupId: ref(maxGrpId), // 记录导入的最大 GroupID
        lastModified: ref(fileLastModified),
        currentViewConfig: ref(undefined),
        viewState: ref(undefined),
        groupOrigins: shallowRef(new Map()),
        history: shallowRef(undefined),
      }

      schemes.value = [...schemes.value, newScheme]
      activeSchemeId.value = newScheme.id

      // 同步到 TabStore
      const tabStore = useTabStore()
      tabStore.openSchemeTab(newScheme.id, newScheme.name.value)

      return { success: true, schemeId: newScheme.id }
    } catch (error) {
      console.error('Failed to import JSON:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  // 方案管理：关闭方案
  function closeScheme(schemeId: string) {
    const scheme = schemes.value.find((s) => s.id === schemeId)
    if (!scheme) return

    // 📌 新增：导出方案数据并保存到历史
    try {
      const gameData: GameDataFile = {
        PlaceInfo: scheme.items.value.map((item) => ({
          ItemID: item.gameId,
          InstanceID: item.instanceId,
          Location: { X: item.x, Y: item.y, Z: item.z },
          Rotation: {
            Roll: item.rotation.x,
            Pitch: item.rotation.y,
            Yaw: item.rotation.z,
          },
          GroupID: item.groupId,
          ...item.extra, // 其他字段（Scale, AttachID, ColorMap, TempInfo 等）
        })),
      }

      // 保存到历史记录
      closedSchemesHistory.value.unshift({
        id: scheme.id,
        name: scheme.name.value,
        fileName: scheme.filePath.value,
        gameData: gameData,
        lastModified: scheme.lastModified.value,
        closedAt: Date.now(),
      })

      // 限制历史长度
      if (closedSchemesHistory.value.length > MAX_CLOSED_HISTORY) {
        closedSchemesHistory.value.pop()
      }
    } catch (error) {
      console.error('Failed to save scheme snapshot:', error)
    }

    // 先从 TabStore 关闭标签
    const tabStore = useTabStore()
    const tab = tabStore.tabs.find((t) => t.schemeId === schemeId)
    if (tab) {
      tabStore.closeTab(tab.id)
    }

    const index = schemes.value.findIndex((s) => s.id === schemeId)
    if (index === -1) return

    // 使用 filter 创建新数组以触发更新 (ShallowRef)
    const newSchemes = [...schemes.value]
    newSchemes.splice(index, 1)
    schemes.value = newSchemes

    // 如果关闭的是当前激活方案，切换到其他方案
    if (activeSchemeId.value === schemeId) {
      if (schemes.value.length > 0) {
        // 优先切换到前一个
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

  // 方案管理：更新方案信息（名称、文件路径）
  function updateSchemeInfo(schemeId: string, info: { name?: string; filePath?: string }) {
    const scheme = schemes.value.find((s) => s.id === schemeId)
    if (scheme) {
      if (info.name !== undefined) {
        scheme.name.value = info.name
        // 同步到 TabStore
        const tabStore = useTabStore()
        tabStore.updateSchemeTabName(schemeId, info.name)
      }

      if (info.filePath !== undefined) {
        scheme.filePath.value = info.filePath
      }
    }
  }

  // 方案管理：重命名方案（向后兼容）
  function renameScheme(schemeId: string, newName: string) {
    updateSchemeInfo(schemeId, { name: newName })
  }

  // 保存当前视图配置
  function saveCurrentViewConfig(config: { scale: number; x: number; y: number }) {
    if (!activeScheme.value) return
    activeScheme.value.currentViewConfig.value = config
  }

  // 获取保存的视图配置
  function getSavedViewConfig(): { scale: number; x: number; y: number } | null {
    if (!activeScheme.value) return null
    return activeScheme.value.currentViewConfig.value ?? null
  }

  // 清空数据
  function clearData() {
    schemes.value = []
    activeSchemeId.value = null
    clipboardRef.value = {
      sourceSchemeId: null,
      items: [],
      groupOrigins: new Map(),
    }
  }

  // 重新打开已关闭的方案
  async function reopenClosedScheme(historyIndex: number = 0) {
    const history = closedSchemesHistory.value[historyIndex]
    if (!history) return { success: false, error: 'No history found' }

    try {
      // 将 GameDataFile 转换为 JSON 字符串
      const fileContent = JSON.stringify(history.gameData, null, 2)

      // 复用现有的导入逻辑
      const result = await importJSONAsScheme(
        fileContent,
        history.fileName || history.name,
        history.lastModified
      )

      if (result.success) {
        // 从历史记录中移除（避免重复恢复）
        closedSchemesHistory.value.splice(historyIndex, 1)
      }

      return result
    } catch (error) {
      console.error('Failed to reopen scheme:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // ========== 编辑操作 ==========

  // Gizmo 模式切换（互斥逻辑）
  function setGizmoMode(mode: 'translate' | 'rotate' | null) {
    // 如果点击当前激活的模式，则关闭；否则切换到新模式
    if (gizmoMode.value === mode) {
      gizmoMode.value = null
    } else {
      gizmoMode.value = mode
    }
  }

  // ========== 组合工具函数 ==========

  /**
   * 检查当前选区是否完整选中了某个组的所有成员
   * @param selectedIds 选中的物品 ID 集合
   * @returns 组 ID，如果不是完整组选择则返回 null
   */
  function getGroupIdIfEntireGroupSelected(selectedIds: Set<string>): number | null {
    if (selectedIds.size === 0) return null

    // 收集选中物品的组 ID
    const groupIds = new Set<number>()
    selectedIds.forEach((id) => {
      const item = itemsMap.value.get(id)
      if (item && item.groupId > 0) {
        groupIds.add(item.groupId)
      }
    })

    // 必须所有选中物品都属于同一个组
    if (groupIds.size !== 1) return null

    const groupId = Array.from(groupIds)[0]!
    const groupMemberIds = groupsMap.value.get(groupId)

    // 检查是否选中了组的所有成员
    if (!groupMemberIds || groupMemberIds.size !== selectedIds.size) return null

    for (const memberId of groupMemberIds) {
      if (!selectedIds.has(memberId)) return null
    }

    return groupId
  }

  return {
    // 多方案状态
    schemes,
    activeSchemeId,
    activeScheme,
    itemsMap,
    groupsMap,
    clipboardList: clipboardRef,
    currentTool,
    selectionMode,
    selectionAction,
    gizmoMode,
    setGizmoMode,

    // 方案管理
    createScheme,
    importJSONAsScheme,
    closeScheme,
    setActiveScheme,
    renameScheme,
    updateSchemeInfo,
    saveCurrentViewConfig,
    getSavedViewConfig,
    clearData,

    // 关闭方案历史
    closedSchemesHistory,
    reopenClosedScheme,

    // 手动触发更新 (Crucial for ShallowRef pattern)
    sceneVersion,
    selectionVersion,
    historyVersion,
    triggerSceneUpdate,
    triggerSelectionUpdate,
    triggerHistoryUpdate,

    // 组合工具函数
    getGroupIdIfEntireGroupSelected,
  }
})

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppItem, GameItem, GameDataFile, HomeScheme } from '../types/editor'
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

  // 多方案状态
  const schemes = ref<HomeScheme[]>([])
  const activeSchemeId = ref<string | null>(null)

  // 全局剪贴板（支持跨方案复制粘贴）
  const clipboardRef = ref<AppItem[]>([])

  // 当前工具状态
  const currentTool = ref<'select' | 'hand'>('select')
  // 选择模式：方块/套索
  const selectionMode = ref<'box' | 'lasso'>('box')
  // 选择行为：新选区/加选/减选/交叉
  const selectionAction = ref<'new' | 'add' | 'subtract' | 'intersect'>('new')

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
      const gid = item.groupId
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
    return {
      totalItems: items.value.length,
      selectedItems: selectedItemIds.value.size,
      totalGroups: groupsMap.value.size,
    }
  })

  // 计算属性：选中的物品列表
  const selectedItems = computed(() => {
    return items.value.filter((item) => selectedItemIds.value.has(item.internalId))
  })

  // 获取下一个唯一的 InstanceID（自增策略）
  function getNextInstanceId(): number {
    if (!activeScheme.value || activeScheme.value.items.length === 0) return 1

    const maxId = activeScheme.value.items.reduce((max, item) => Math.max(max, item.instanceId), 0)
    return maxId + 1
  }

  // ========== 方案管理 ==========

  // 方案管理：创建新方案
  function createScheme(name?: string): string {
    const newScheme: HomeScheme = {
      id: generateUUID(),
      name: name || t('scheme.unnamed'),
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

      // 从文件名提取方案名称（默认使用“方案 N”形式，避免重复）
      const schemeName = t('scheme.defaultName', { n: schemes.value.length + 1 })

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

  // 方案管理：更新方案信息（名称、文件路径）
  function updateSchemeInfo(schemeId: string, info: { name?: string; filePath?: string }) {
    const scheme = schemes.value.find((s) => s.id === schemeId)
    if (scheme) {
      if (info.name !== undefined) {
        scheme.name = info.name
        // 同步到 TabStore
        const tabStore = useTabStore()
        tabStore.updateSchemeTabName(schemeId, info.name)
      }

      if (info.filePath !== undefined) {
        scheme.filePath = info.filePath
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

  // ========== 编辑操作 ==========

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
    itemsMap, // 导出以便 Composables 使用
    groupsMap, // 导出以便 Composables 使用
    buildableAreas,
    isBuildableAreaLoaded,
    clipboardList: clipboardRef, // 导出给 useClipboard 使用
    currentTool,
    selectionMode,
    selectionAction,

    // 向后兼容的计算属性
    items,
    bounds,
    stats,
    selectedItemIds,
    selectedItems,

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

    // 编辑操作
    getSelectedItemsCenter,
    getNextInstanceId, // 导出以便 Composables 使用
  }
})

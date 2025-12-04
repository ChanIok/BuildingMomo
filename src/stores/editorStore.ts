import { defineStore } from 'pinia'
import { ref, computed, shallowRef, triggerRef } from 'vue'
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

  // 多方案状态 - 使用 ShallowRef 优化列表性能
  const schemes = shallowRef<HomeScheme[]>([])
  const activeSchemeId = ref<string | null>(null)

  // 全局剪贴板（支持跨方案复制粘贴）- 使用 ShallowRef
  const clipboardRef = shallowRef<AppItem[]>([])

  // 当前工具状态
  const currentTool = ref<'select' | 'hand'>('select')
  // 选择模式：方块/套索
  const selectionMode = ref<'box' | 'lasso'>('box')
  // 选择行为：新选区/加选/减选/交叉
  const selectionAction = ref<'new' | 'add' | 'subtract' | 'intersect'>('new')

  // 可建造区域数据
  const buildableAreas = shallowRef<Record<string, number[][]> | null>(null)
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

  // 获取下一个唯一的 InstanceID（自增策略）
  function getNextInstanceId(): number {
    const list = activeScheme.value?.items.value ?? []
    if (list.length === 0) return 1
    // 简单遍历查找最大值
    let max = 0
    for (const item of list) {
      if (item.instanceId > max) max = item.instanceId
    }
    return max + 1
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
      currentViewConfig: ref(undefined),
      viewState: ref(undefined),
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

      // 从文件名提取方案名称
      const schemeName = t('scheme.defaultName', { n: schemes.value.length + 1 })

      // 创建新方案
      const newScheme: HomeScheme = {
        id: generateUUID(),
        name: ref(schemeName),
        filePath: ref(fileName),
        items: shallowRef(newItems),
        selectedItemIds: shallowRef(new Set()),
        lastModified: ref(fileLastModified),
        currentViewConfig: ref(undefined),
        viewState: ref(undefined),
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
    clipboardRef.value = []
  }

  // ========== 编辑操作 ==========\

  return {
    // 多方案状态
    schemes,
    activeSchemeId,
    activeScheme,
    itemsMap,
    groupsMap,
    buildableAreas,
    isBuildableAreaLoaded,
    clipboardList: clipboardRef,
    currentTool,
    selectionMode,
    selectionAction,

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
    getNextInstanceId,

    // 手动触发更新 (Crucial for ShallowRef pattern)
    sceneVersion,
    selectionVersion,
    triggerSceneUpdate,
    triggerSelectionUpdate,
  }
})

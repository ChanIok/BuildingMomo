import { ref, shallowRef, toRaw, watch, onUnmounted, computed } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { get } from 'idb-keyval'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useTabStore } from '../stores/tabStore'
import { useGameDataStore } from '../stores/gameDataStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useValidationStore } from '../stores/validationStore'
import { workerApi } from '../workers/client'
import type { HomeScheme } from '../types/editor'
import type { WorkspaceSnapshot, HomeSchemeSnapshot } from '../types/persistence'

const STORAGE_KEY = 'workspace_snapshot'
const CURRENT_VERSION = 1

const SESSION_MARKER_KEY = 'has_unsaved_session'

export function useWorkspaceWorker() {
  const editorStore = useEditorStore()
  const tabStore = useTabStore()
  const settingsStore = useSettingsStore()
  const validationStore = useValidationStore()

  const gameDataStore = useGameDataStore()
  const { buildableAreas, isBuildableAreaLoaded } = storeToRefs(gameDataStore)

  const isRestoring = ref(false)

  // 辅助：更新会话标记 (Local Storage)
  // 用于 App 启动时快速判断是否需要恢复数据，避免不必要的 IndexedDB 等待
  const updateSessionMarker = () => {
    const hasTabs = tabStore.tabs.length > 0
    if (hasTabs) {
      localStorage.setItem(SESSION_MARKER_KEY, 'true')
    } else {
      localStorage.removeItem(SESSION_MARKER_KEY)
    }
  }

  // --- 增量同步 (主线程 -> Worker) ---

  // 统一同步逻辑：结构 + 内容
  const syncWorkspace = async (immediate = false) => {
    if (isRestoring.value) return

    // 0. 更新轻量级标记
    updateSessionMarker()

    // 1. 准备元数据 (Meta)
    const meta = {
      activeSchemeId: editorStore.activeSchemeId || '',
      tabs: tabStore.tabs.map((t) => toRaw(t)),
      activeTabId: tabStore.activeTabId || '',
      schemes: editorStore.schemes.map((s) => ({
        id: s.id,
        name: s.name.value,
        filePath: s.filePath.value,
        lastModified: s.lastModified.value,
      })),
    }

    // 2. 准备当前激活方案的内容 (Active Scheme Data)
    let activeSchemeData = undefined
    if (editorStore.activeScheme) {
      const scheme = editorStore.activeScheme
      activeSchemeData = {
        id: scheme.id,
        items: toRaw(scheme.items.value),
        selectedItemIds: toRaw(scheme.selectedItemIds.value),
        currentViewConfig: toRaw(scheme.currentViewConfig.value),
        viewState: toRaw(scheme.viewState.value),
      }
    }

    try {
      // 3. 发送统一指令
      const result = await workerApi.updateState({
        meta,
        activeSchemeData,
        immediate,
      })

      // 4. 更新验证状态 (如果有)
      if (result.validation) {
        validationStore.setValidationResults(result.validation)
      }
    } catch (error) {
      console.error('[Persistence] Failed to sync workspace to worker:', error)
    }
  }

  // --- 防抖控制 ---

  // 统一防抖 (300ms) - 任何变化都归流到这一个出口
  const debouncedSyncWorkspace = useDebounceFn(syncWorkspace, 300)

  // 3. 同步设置 (特别是 AutoSave)
  const syncSettings = async () => {
    const s = settingsStore.settings
    try {
      // 1. 发送命令：更新设置
      const result = await workerApi.updateSettings({
        enableDuplicateDetection: s.enableDuplicateDetection,
        enableLimitDetection: s.enableLimitDetection,
        enableAutoSave: s.enableAutoSave,
      })

      // 2. 更新 UI
      if (result.validation) {
        validationStore.setValidationResults(result.validation)
      } else {
        // 如果验证被关闭，清空验证结果
        validationStore.clearResults()
      }
    } catch (error) {
      console.error('[Persistence] Failed to sync settings to worker:', error)
    }
  }

  // 4. 同步可建造区域
  const syncBuildableAreas = async () => {
    if (!isBuildableAreaLoaded.value) return
    try {
      // 1. 发送命令
      const result = await workerApi.updateBuildableAreas(toRaw(buildableAreas.value))

      // 2. 更新 UI
      if (result.validation) {
        validationStore.setValidationResults(result.validation)
      }
    } catch (error) {
      console.error('[Persistence] Failed to sync buildable areas to worker:', error)
    }
  }

  const cleanupFns: (() => void)[] = []
  const isMonitoring = ref(false)

  // 计算属性：Worker 是否应该处于活跃状态
  const isWorkerActive = computed(
    () =>
      settingsStore.settings.enableAutoSave ||
      settingsStore.settings.enableDuplicateDetection ||
      settingsStore.settings.enableLimitDetection
  )

  const isWorkerInitialized = ref(false)

  function stopMonitoring() {
    if (!isMonitoring.value) return
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0
    isMonitoring.value = false
  }

  async function startMonitoring() {
    if (isMonitoring.value) return

    isMonitoring.value = true

    // 0. 确保 Worker 已初始化 (拥有数据副本)
    // 无论是否从存储恢复，Worker 都需要一份当前状态的副本才能工作
    if (!isWorkerInitialized.value) {
      try {
        const snapshot = createCurrentSnapshot()
        await workerApi.initWorkspace(snapshot)
        isWorkerInitialized.value = true
        console.log('[Persistence] Worker initialized with current state')
      } catch (error) {
        console.error('[Persistence] Failed to initialize worker:', error)
        // 初始化失败不应阻断后续监控，但可能会导致验证失效
      }
    }

    // 1. 初始同步
    // 此时 Worker 已有 Snapshot，可以正确响应设置更新带来的验证请求
    syncSettings()
    syncBuildableAreas()

    // 2. 监听状态变化 (拆分为结构性和内容性)

    // 2a. 结构性变化 (Tabs, ActiveTab) -> 立即保存 (Worker 端跳过 2s 节流)
    const unwatchStructure = watch(
      [() => tabStore.tabs, () => tabStore.activeTabId],
      () => {
        debouncedSyncWorkspace(true)
      },
      { deep: true }
    )
    cleanupFns.push(unwatchStructure)

    // 2b. 内容性变化 (Scene, Selection) -> 延迟保存 (Worker 端保持 2s 节流)
    const unwatchContent = watch(
      [() => editorStore.sceneVersion, () => editorStore.selectionVersion],
      () => {
        debouncedSyncWorkspace(false)
      }
    )
    cleanupFns.push(unwatchContent)

    // 2c. 监听可建造区域变化 (独立逻辑)
    const unwatchAreas = watch(
      [isBuildableAreaLoaded, buildableAreas],
      () => {
        syncBuildableAreas()
      },
      { deep: true }
    )
    cleanupFns.push(unwatchAreas)

    // 初始同步
    debouncedSyncWorkspace()
  }

  // 统一监听 Worker 激活状态
  watch(isWorkerActive, (active) => {
    if (active) {
      startMonitoring()
    } else {
      stopMonitoring()
    }
  })

  // 监听设置变化 (即使 Worker 不活跃，也要同步设置，以便 Worker 正确响应)
  watch(
    () => settingsStore.settings,
    () => {
      syncSettings()
    },
    { deep: true }
  )

  onUnmounted(() => {
    stopMonitoring()
  })

  const hydrate = (snapshot: WorkspaceSnapshot) => {
    const restoredSchemes: HomeScheme[] = snapshot.editor.schemes.map((s) => {
      // 计算最大的 InstanceID 和 GroupID
      let maxInstId = 999
      let maxGrpId = 0
      for (const item of s.items) {
        if (item.instanceId > maxInstId) maxInstId = item.instanceId
        if (item.groupId > maxGrpId) maxGrpId = item.groupId
      }

      return {
        id: s.id,
        name: ref(s.name),
        filePath: ref(s.filePath),
        lastModified: ref(s.lastModified),
        items: shallowRef(s.items),
        selectedItemIds: shallowRef(s.selectedItemIds),
        maxInstanceId: ref(maxInstId),
        maxGroupId: ref(maxGrpId),
        currentViewConfig: ref(s.currentViewConfig),
        viewState: ref(s.viewState),
        history: shallowRef(undefined),
      }
    })

    editorStore.schemes = restoredSchemes
    editorStore.activeSchemeId = snapshot.editor.activeSchemeId

    tabStore.tabs = snapshot.tab.tabs
    tabStore.activeTabId = snapshot.tab.activeTabId

    // 恢复完成后，确认一下标记状态 (防止极端情况下的不一致)
    updateSessionMarker()
  }

  async function restore() {
    isRestoring.value = true
    try {
      const snapshot = await get<WorkspaceSnapshot>(STORAGE_KEY)

      if (snapshot) {
        if (snapshot.version === CURRENT_VERSION) {
          hydrate(snapshot)
          console.log(
            '[Persistence] Workspace restored, last updated:',
            new Date(snapshot.updatedAt).toLocaleString()
          )
        } else {
          console.warn('[Persistence] Version mismatch, skipping restore')
        }
      } else {
        console.log('[Persistence] No snapshot found')
      }
    } catch (error) {
      console.error('[Persistence] Failed to restore workspace:', error)
    } finally {
      isRestoring.value = false
    }
  }

  // 辅助：从当前状态构建完整快照 (用于初始化 Worker)
  const createCurrentSnapshot = (): WorkspaceSnapshot => {
    const schemesValue = editorStore.schemes || []
    const schemesSnapshot: HomeSchemeSnapshot[] = schemesValue.map((scheme) => ({
      id: scheme.id,
      name: scheme.name.value,
      filePath: scheme.filePath.value,
      lastModified: scheme.lastModified.value,
      items: toRaw(scheme.items.value),
      selectedItemIds: toRaw(scheme.selectedItemIds.value),
      currentViewConfig: toRaw(scheme.currentViewConfig.value),
      viewState: toRaw(scheme.viewState.value),
    }))

    return {
      version: CURRENT_VERSION,
      updatedAt: Date.now(),
      editor: {
        schemes: schemesSnapshot,
        activeSchemeId: editorStore.activeSchemeId,
      },
      tab: {
        tabs: tabStore.tabs.map((t) => toRaw(t)),
        activeTabId: tabStore.activeTabId,
      },
    }
  }

  return {
    restore,
    isWorkerActive,
    startMonitoring,
  }
}

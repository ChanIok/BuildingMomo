import { ref, shallowRef, toRaw, watch, onUnmounted } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { get } from 'idb-keyval'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editorStore'
import { useTabStore } from '../stores/tabStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useValidationStore } from '../stores/validationStore'
import { workerApi } from '../workers/client'
import type { HomeScheme } from '../types/editor'
import type { WorkspaceSnapshot, HomeSchemeSnapshot } from '../types/persistence'

const STORAGE_KEY = 'workspace_snapshot'
const CURRENT_VERSION = 1

const SESSION_MARKER_KEY = 'has_unsaved_session'

export function useWorkspacePersistence() {
  const editorStore = useEditorStore()
  const tabStore = useTabStore()
  const settingsStore = useSettingsStore()
  const validationStore = useValidationStore()

  const { buildableAreas, isBuildableAreaLoaded } = storeToRefs(editorStore)

  const isRestoring = ref(false)
  const lastSavedTime = ref(0)

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
      const validationResults = await workerApi.syncWorkspace({
        meta,
        activeSchemeData,
        immediate,
      })

      // 4. 更新验证状态
      validationStore.setValidationResults(validationResults)
      // console.log('[Persistence] Workspace synced')
    } catch (error) {
      console.error('[Persistence] Failed to sync workspace to worker:', error)
    }
  }

  // --- 防抖控制 ---

  // 统一防抖 (300ms) - 任何变化都归流到这一个出口
  const debouncedSyncWorkspace = useDebounceFn(syncWorkspace, 300)

  // 3. 同步设置 (特别是 AutoSave)
  // 这确保了 Worker 知道是否应该保存数据，并返回最新的验证结果
  const syncSettings = async () => {
    const s = settingsStore.settings
    try {
      // 1. 发送命令：更新设置
      await workerApi.updateSettings({
        enableDuplicateDetection: s.enableDuplicateDetection,
        enableLimitDetection: s.enableLimitDetection,
        enableAutoSave: s.enableAutoSave,
      })

      // 2. 发送查询：获取最新的验证结果
      const results = await workerApi.revalidate()

      // 3. 更新 UI
      validationStore.setValidationResults(results)
    } catch (error) {
      console.error('[Persistence] Failed to sync settings to worker:', error)
    }
  }

  // 4. 同步可建造区域
  // 移至此处统一管理
  const syncBuildableAreas = async () => {
    if (!isBuildableAreaLoaded.value) return
    try {
      // 1. 发送命令
      await workerApi.updateBuildableAreas(toRaw(buildableAreas.value))

      // 2. 发送查询
      const results = await workerApi.revalidate()

      // 3. 更新 UI
      validationStore.setValidationResults(results)
    } catch (error) {
      console.error('[Persistence] Failed to sync buildable areas to worker:', error)
    }
  }

  const cleanupFns: (() => void)[] = []
  const isMonitoring = ref(false)

  function startMonitoring() {
    if (isMonitoring.value) return

    console.log('[Persistence] 监控已启动 (增量模式)')
    isMonitoring.value = true

    // 1. 初始同步
    syncSettings()
    syncBuildableAreas()

    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0

    // 2. 监听状态变化 (拆分为结构性和内容性)

    // 2a. 结构性变化 (Tabs, ActiveTab) -> 立即保存 (Worker 端跳过 2s 节流)
    // 这种变化频率低，但用户期望即时生效（如关闭标签）
    const unwatchStructure = watch(
      [() => tabStore.tabs, () => tabStore.activeTabId],
      () => {
        debouncedSyncWorkspace(true)
      },
      { deep: true } // 深度监听，因为 tabs 内部属性可能变化
    )
    cleanupFns.push(unwatchStructure)

    // 2b. 内容性变化 (Scene, Selection) -> 延迟保存 (Worker 端保持 2s 节流)
    // 这种变化频率高，且可以容忍轻微延迟
    const unwatchContent = watch(
      [() => editorStore.sceneVersion, () => editorStore.selectionVersion],
      () => {
        debouncedSyncWorkspace(false)
      }
    )
    cleanupFns.push(unwatchContent)

    // 3. 监听设置变化 (独立逻辑，保持不变)
    const unwatchSettings = watch(
      () => settingsStore.settings,
      () => {
        syncSettings()
      },
      { deep: true }
    )
    cleanupFns.push(unwatchSettings)

    // 4. 监听可建造区域变化 (独立逻辑，保持不变)
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

  onUnmounted(() => {
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0
    isMonitoring.value = false
  })

  // --- 恢复 (主线程 -> 运行时) ---

  const hydrate = (snapshot: WorkspaceSnapshot) => {
    const restoredSchemes: HomeScheme[] = snapshot.editor.schemes.map((s) => ({
      id: s.id,
      name: ref(s.name),
      filePath: ref(s.filePath),
      lastModified: ref(s.lastModified),
      items: shallowRef(s.items),
      selectedItemIds: shallowRef(s.selectedItemIds),
      currentViewConfig: ref(s.currentViewConfig),
      viewState: ref(s.viewState),
      history: shallowRef(undefined),
    }))

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

          // 重要：恢复后，必须把全量数据初始化给 Worker
          // 这样 Worker 才能作为 Source of Truth 进行后续的增量更新
          await workerApi.initWorkspace(snapshot)
        } else {
          console.warn('[Persistence] Version mismatch, skipping restore')
        }
      } else {
        console.log('[Persistence] No snapshot found')
        // 如果没有快照，初始化一个空的给 Worker
        const initialSnapshot = createCurrentSnapshot()
        await workerApi.initWorkspace(initialSnapshot)
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

  // 自动监听设置开启，动态启动监控
  // 即使初始化时没开，后续开启也应该自动启动监控
  watch(
    () => settingsStore.settings.enableAutoSave,
    (enabled) => {
      if (enabled) {
        startMonitoring()
      }
    }
  )

  return {
    restore,
    startMonitoring,
    lastSavedTime,
  }
}

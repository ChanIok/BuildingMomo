import { ref, shallowRef, onUnmounted, toRaw, watch } from 'vue'
import { useEventListener, useDebounceFn } from '@vueuse/core'
import { get } from 'idb-keyval'
import { useEditorStore } from '../stores/editorStore'
import { useTabStore } from '../stores/tabStore'
import { useValidationStore } from '../stores/validationStore'
import { workerApi } from '../workers/client'
import type { HomeScheme } from '../types/editor'
import type { WorkspaceSnapshot, HomeSchemeSnapshot } from '../types/persistence'

const STORAGE_KEY = 'workspace_snapshot'
const CURRENT_VERSION = 1

export function useWorkspacePersistence() {
  const editorStore = useEditorStore()
  const tabStore = useTabStore()
  const validationStore = useValidationStore()

  const isRestoring = ref(false)
  const lastSavedTime = ref(0)

  // --- 序列化（主线程 -> 工作线程）---
  // 只是组装快照。因为我们使用 ShallowRef 和普通对象，
  const createSnapshot = (): WorkspaceSnapshot => {
    const schemesValue = editorStore.schemes || []
    const schemesSnapshot: HomeSchemeSnapshot[] = schemesValue.map((scheme) => ({
      id: scheme.id,
      name: scheme.name.value,
      filePath: scheme.filePath.value,
      lastModified: scheme.lastModified.value,
      // items.value 是 ShallowRef<AppItem[]>。数组和项目都是普通对象。
      // toRaw 确保我们不会传递 Proxy（如果它变成了 Proxy）。
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

  // --- 同步到工作线程 ---
  const syncToWorker = async () => {
    if (isRestoring.value) return

    try {
      const snapshot = createSnapshot()

      // 发送到工作线程
      // 这会触发验证并在工作线程中安排保存
      const validationResults = await workerApi.syncWorkspace(snapshot)

      // 用结果更新验证存储
      validationStore.setValidationResults(validationResults)

      lastSavedTime.value = Date.now()
    } catch (error) {
      console.error('[Persistence] Failed to sync to worker:', error)
    }
  }

  // 防抖同步，避免在每个像素拖动时阻塞工作线程通道
  // 但我们希望它足够快以获得验证反馈。
  // 200ms 是"实时"感觉和避免 60fps 垃圾邮件的良好平衡。
  // 对于"保存"，工作线程有自己的 2 秒防抖。
  const debouncedSync = useDebounceFn(syncToWorker, 200)

  const cleanupFns: (() => void)[] = []

  function startMonitoring() {
    console.log('[Persistence] 监控已启动（基于工作线程）')

    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0

    // 用户交互结束的事件监听器
    cleanupFns.push(useEventListener(window, 'pointerup', debouncedSync))
    cleanupFns.push(useEventListener(window, 'keyup', debouncedSync))
    cleanupFns.push(useEventListener(window, 'blur', debouncedSync))

    // 监视数据变化（撤消/重做，属性更改）
    const unwatch = watch(
      () => editorStore.sceneVersion,
      () => {
        debouncedSync()
      }
    )
    cleanupFns.push(unwatch)

    // 还要触发初始同步以确保工作线程有数据
    debouncedSync()
  }

  onUnmounted(() => {
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0
  })

  // --- 恢复（主线程 -> 运行时）---
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
          // 将恢复的数据同步到工作线程，以便它可以验证/保存未来的更改
          debouncedSync()
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

  return {
    restore,
    startMonitoring,
    lastSavedTime,
  }
}

import { ref, onUnmounted } from 'vue'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { get, set } from 'idb-keyval'
import { useEditorStore } from '../stores/editorStore'
import { useTabStore } from '../stores/tabStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { HomeScheme } from '../types/editor'
import type { Tab } from '../types/tab'

interface WorkspaceSnapshot {
  version: number
  updatedAt: number
  editor: {
    schemes: HomeScheme[]
    activeSchemeId: string | null
  }
  tab: {
    tabs: Tab[]
    activeTabId: string | null
  }
}

const STORAGE_KEY = 'workspace_snapshot'
const CURRENT_VERSION = 1

export function useWorkspacePersistence() {
  const editorStore = useEditorStore()
  const tabStore = useTabStore()
  const settingsStore = useSettingsStore()

  const isRestoring = ref(false) // Default to false to avoid blocking if restore fails to start
  const lastSavedTime = ref(0)

  // 执行保存逻辑
  const performSave = async () => {
    // 如果正在恢复数据，或者开关未开启，则不保存
    if (isRestoring.value || !settingsStore.settings.enableAutoSave) {
      return
    }

    // 使用 requestIdleCallback 在空闲时保存
    // 注意：requestIdleCallback 在 Safari 中可能不支持，需要 Polyfill 或降级
    const idleCallback = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1))

    idleCallback(
      async () => {
        try {
          const snapshot: WorkspaceSnapshot = {
            version: CURRENT_VERSION,
            updatedAt: Date.now(),
            editor: {
              schemes: editorStore.schemes,
              activeSchemeId: editorStore.activeSchemeId,
            },
            tab: {
              tabs: tabStore.tabs,
              activeTabId: tabStore.activeTabId,
            },
          }

          await set(STORAGE_KEY, snapshot)
          lastSavedTime.value = Date.now()
          console.log('[Persistence] Snapshot saved', new Date().toLocaleTimeString())
        } catch (error) {
          console.error('[Persistence] Failed to save snapshot:', error)
        }
      },
      { timeout: 12000 } // 如果 2秒内没空闲，强制执行
    )
  }

  // 2秒防抖，避免频繁写入
  const debouncedSave = useDebounceFn(performSave, 12000)

  // 监听器清理函数集合
  const cleanupFns: (() => void)[] = []

  // 监听用户交互事件
  function startMonitoring() {
    console.log('[Persistence] Monitoring started (Event-driven)')

    // 清理旧的监听器（防止多次调用堆积）
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0

    // 使用事件驱动代替数据驱动 ($subscribe)
    // 监听鼠标抬起、键盘按键抬起、窗口失焦等操作结束事件
    // 这样在拖拽过程中（mousemove）不会触发任何逻辑，彻底解决卡顿
    cleanupFns.push(useEventListener(window, 'pointerup', debouncedSave))
    cleanupFns.push(useEventListener(window, 'keyup', debouncedSave))
    cleanupFns.push(useEventListener(window, 'blur', debouncedSave))
  }

  // 组件销毁时自动清理全局监听器
  onUnmounted(() => {
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0
  })

  // 恢复数据
  async function restore() {
    isRestoring.value = true
    console.error('[Persistence] Restoring workspace...') // Use error to force visibility
    try {
      const snapshot = await get<WorkspaceSnapshot>(STORAGE_KEY)

      if (snapshot) {
        // 简单的版本检查
        if (snapshot.version === CURRENT_VERSION) {
          // 使用 $patch 更新 Store
          // 显式赋值而不是整个对象 $patch，有时能减少不必要的副作用
          editorStore.schemes = snapshot.editor.schemes
          editorStore.activeSchemeId = snapshot.editor.activeSchemeId

          tabStore.tabs = snapshot.tab.tabs
          tabStore.activeTabId = snapshot.tab.activeTabId

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

  return {
    restore,
    startMonitoring,
    lastSavedTime,
  }
}

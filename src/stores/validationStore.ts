import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as Comlink from 'comlink'
import { useDebounceFn } from '@vueuse/core'
import type { AppItem } from '../types/editor'
import type { ValidationWorkerApi } from '../workers/editorValidation.worker'
import Worker from '../workers/editorValidation.worker?worker'
import { useEditorStore } from './editorStore'
import { useSettingsStore } from './settingsStore'
import { useEditorHistory } from '../composables/editor/useEditorHistory'
import { deepToRaw } from '../lib/deepToRaw'

export const useValidationStore = defineStore('validation', () => {
  const editorStore = useEditorStore()
  const settingsStore = useSettingsStore()
  const { saveHistory } = useEditorHistory()

  const { activeScheme, buildableAreas, isBuildableAreaLoaded } = storeToRefs(editorStore)
  const settings = computed(() => settingsStore.settings)

  // Worker 实例
  const worker = new Worker()
  const workerApi = Comlink.wrap<ValidationWorkerApi>(worker)

  // 响应式状态
  const duplicateGroups = ref<AppItem[][]>([])
  const limitIssues = ref<{ outOfBoundsItemIds: string[]; oversizedGroups: number[] }>({
    outOfBoundsItemIds: [],
    oversizedGroups: [],
  })
  const isValidating = ref(false)

  // 计算属性：是否存在重复物品
  const hasDuplicate = computed(() => duplicateGroups.value.length > 0)

  // 计算属性：重复物品总数
  const duplicateItemCount = computed(() => {
    return duplicateGroups.value.reduce((sum, group) => sum + (group.length - 1), 0)
  })

  // 计算属性：是否存在限制问题
  const hasLimitIssues = computed(() => {
    return (
      limitIssues.value.outOfBoundsItemIds.length > 0 ||
      limitIssues.value.oversizedGroups.length > 0
    )
  })

  // 核心验证函数 (运行在 Worker 中)
  const runValidation = async () => {
    if (!activeScheme.value) {
      duplicateGroups.value = []
      limitIssues.value = { outOfBoundsItemIds: [], oversizedGroups: [] }
      return
    }

    isValidating.value = true
    const startTime = performance.now()

    try {
      // 准备数据 (使用 deepToRaw 彻底去除 Proxy，避免 DataCloneError)
      // 注意：postMessage 会自动执行结构化克隆，所以这里只需去除 Proxy 即可，无需手动 structuredClone
      const items = deepToRaw(activeScheme.value.items)
      const areas =
        isBuildableAreaLoaded.value && buildableAreas.value ? deepToRaw(buildableAreas.value) : null
      const enableDup = settings.value.enableDuplicateDetection

      // 并行执行两个任务
      const [duplicates, limits] = await Promise.all([
        workerApi.detectDuplicates(items, enableDup),
        workerApi.checkLimits(items, isBuildableAreaLoaded.value ? areas : null),
      ])

      duplicateGroups.value = duplicates
      limitIssues.value = limits

      const duration = performance.now() - startTime
      console.log(`[EditorValidation] Validation completed in ${duration.toFixed(2)}ms`)
    } catch (err) {
      console.error('[EditorValidation] Validation failed:', err)
    } finally {
      isValidating.value = false
    }
  }

  // 防抖监听
  const debouncedValidation = useDebounceFn(runValidation, 500)

  watch(
    [
      () => activeScheme.value?.items, // 监听物品变化
      () => settings.value.enableDuplicateDetection,
      isBuildableAreaLoaded,
    ],
    () => {
      debouncedValidation()
    },
    { deep: true } // 深度监听 items 变化 (如坐标改变)
  )

  // 选择所有重复的物品
  function selectDuplicateItems() {
    if (!activeScheme.value || duplicateGroups.value.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.clear()

    duplicateGroups.value.forEach((group) => {
      // Skip the first one, select the rest
      group.slice(1).forEach((item) => {
        // item.internalId 来自 Worker 的 copy，但这 ID 是唯一的，可以用来选中 Store 里的 item
        activeScheme.value!.selectedItemIds.add(item.internalId)
      })
    })

    console.log(
      `[Duplicate Detection] Selected ${duplicateItemCount.value} duplicate items (excluding first of each group)`
    )
  }

  // 选择超出限制的物品
  function selectOutOfBoundsItems() {
    if (!activeScheme.value || limitIssues.value.outOfBoundsItemIds.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.clear()

    limitIssues.value.outOfBoundsItemIds.forEach((id) => {
      activeScheme.value!.selectedItemIds.add(id)
    })
  }

  // 选择超大组的物品
  function selectOversizedGroupItems() {
    if (!activeScheme.value || limitIssues.value.oversizedGroups.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.clear()

    const targetGroups = new Set(limitIssues.value.oversizedGroups)
    activeScheme.value.items.forEach((item) => {
      if (targetGroups.has(item.originalData.GroupID)) {
        activeScheme.value!.selectedItemIds.add(item.internalId)
      }
    })
  }

  return {
    duplicateGroups,
    hasDuplicate,
    duplicateItemCount,
    limitIssues,
    hasLimitIssues,
    isValidating,
    selectDuplicateItems,
    selectOutOfBoundsItems,
    selectOversizedGroupItems,
  }
})

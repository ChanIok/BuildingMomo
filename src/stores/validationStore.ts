import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { ValidationResult } from '../types/persistence'
import { workerApi } from '../workers/client'
import { useEditorStore } from './editorStore'
import { useSettingsStore } from './settingsStore'
import { useEditorHistory } from '../composables/editor/useEditorHistory'

export const useValidationStore = defineStore('validation', () => {
  const editorStore = useEditorStore()
  const settingsStore = useSettingsStore()
  const { saveHistory } = useEditorHistory()

  const { activeScheme, buildableAreas, isBuildableAreaLoaded } = storeToRefs(editorStore)
  const settings = computed(() => settingsStore.settings)

  // 响应式状态
  const duplicateGroups = ref<string[][]>([])
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

  // 接收外部（Persistence/Worker）传来的验证结果
  function setValidationResults(results: ValidationResult) {
    duplicateGroups.value = results.duplicateGroups
    limitIssues.value = results.limitIssues
  }

  // 监听设置变化，通知 Worker 更新设置并重新验证
  watch(
    [() => settings.value.enableDuplicateDetection, () => settings.value.enableLimitDetection],
    async ([enableDup, enableLimit]) => {
      isValidating.value = true
      try {
        const results = await workerApi.updateSettings({
          enableDuplicateDetection: enableDup,
          enableLimitDetection: enableLimit,
        })
        setValidationResults(results)
      } finally {
        isValidating.value = false
      }
    }
  )

  // 监听可建造区域变化
  watch([isBuildableAreaLoaded, buildableAreas], async ([loaded, areas]) => {
    if (loaded && areas) {
      isValidating.value = true
      try {
        const results = await workerApi.updateBuildableAreas(areas)
        setValidationResults(results)
      } finally {
        isValidating.value = false
      }
    }
  })

  // 选择所有重复的物品
  function selectDuplicateItems() {
    if (!activeScheme.value || duplicateGroups.value.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.value.clear()

    duplicateGroups.value.forEach((group) => {
      // Skip the first one, select the rest
      group.slice(1).forEach((internalId) => {
        activeScheme.value!.selectedItemIds.value.add(internalId)
      })
    })

    console.log(
      `[Duplicate Detection] Selected ${duplicateItemCount.value} duplicate items (excluding first of each group)`
    )
    editorStore.triggerSelectionUpdate()
  }

  // 选择超出限制的物品
  function selectOutOfBoundsItems() {
    if (!activeScheme.value || limitIssues.value.outOfBoundsItemIds.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.value.clear()

    limitIssues.value.outOfBoundsItemIds.forEach((id) => {
      activeScheme.value!.selectedItemIds.value.add(id)
    })
    editorStore.triggerSelectionUpdate()
  }

  // 选择超大组的物品
  function selectOversizedGroupItems() {
    if (!activeScheme.value || limitIssues.value.oversizedGroups.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.value.clear()

    const targetGroups = new Set(limitIssues.value.oversizedGroups)
    // items 是 ShallowRef
    activeScheme.value.items.value.forEach((item) => {
      if (targetGroups.has(item.groupId)) {
        activeScheme.value!.selectedItemIds.value.add(item.internalId)
      }
    })
    editorStore.triggerSelectionUpdate()
  }

  return {
    duplicateGroups,
    hasDuplicate,
    duplicateItemCount,
    limitIssues,
    hasLimitIssues,
    isValidating,
    setValidationResults, // Exported action
    selectDuplicateItems,
    selectOutOfBoundsItems,
    selectOversizedGroupItems,
  }
})

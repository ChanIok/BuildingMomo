import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { ValidationResult } from '../types/persistence'
import { useEditorStore } from './editorStore'
import { useEditorHistory } from '../composables/editor/useEditorHistory'

export const useValidationStore = defineStore('validation', () => {
  const editorStore = useEditorStore()
  const { saveHistory } = useEditorHistory()

  const { activeScheme } = storeToRefs(editorStore)

  // 响应式状态
  const duplicateGroups = ref<string[][]>([])
  const limitIssues = ref<{
    outOfBoundsItemIds: string[]
    oversizedGroups: number[]
    invalidScaleItemIds: string[]
    invalidRotationItemIds: string[]
  }>({
    outOfBoundsItemIds: [],
    oversizedGroups: [],
    invalidScaleItemIds: [],
    invalidRotationItemIds: [],
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
      limitIssues.value.oversizedGroups.length > 0 ||
      limitIssues.value.invalidScaleItemIds.length > 0 ||
      limitIssues.value.invalidRotationItemIds.length > 0
    )
  })

  // 接收外部（Persistence/Worker）传来的验证结果
  function setValidationResults(results: ValidationResult) {
    duplicateGroups.value = results.duplicateGroups
    limitIssues.value = results.limitIssues
  }

  function clearResults() {
    duplicateGroups.value = []
    limitIssues.value = {
      outOfBoundsItemIds: [],
      oversizedGroups: [],
      invalidScaleItemIds: [],
      invalidRotationItemIds: [],
    }
  }

  // 监听方案切换，重置或重新获取验证结果
  // (由于方案切换也会触发 Persistence 的 syncScheme，这里其实也可以简化，
  // 但为了 UI 响应速度，可以先保留或清理旧状态)
  watch(
    () => editorStore.activeSchemeId,
    () => {
      // 切换时先清空旧的验证结果，避免显示错误的警告
      setValidationResults({
        duplicateGroups: [],
        limitIssues: {
          outOfBoundsItemIds: [],
          oversizedGroups: [],
          invalidScaleItemIds: [],
          invalidRotationItemIds: [],
        },
      })
      // 新方案的验证结果会随后由 Persistence 的 syncScheme 带回
    }
  )

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

  // 选择缩放超限的物品
  function selectInvalidScaleItems() {
    if (!activeScheme.value || limitIssues.value.invalidScaleItemIds.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.value.clear()

    limitIssues.value.invalidScaleItemIds.forEach((id) => {
      activeScheme.value!.selectedItemIds.value.add(id)
    })
    editorStore.triggerSelectionUpdate()
  }

  // 选择旋转违规的物品
  function selectInvalidRotationItems() {
    if (!activeScheme.value || limitIssues.value.invalidRotationItemIds.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.value.clear()

    limitIssues.value.invalidRotationItemIds.forEach((id) => {
      activeScheme.value!.selectedItemIds.value.add(id)
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
    clearResults,
    selectDuplicateItems,
    selectOutOfBoundsItems,
    selectOversizedGroupItems,
    selectInvalidScaleItems,
    selectInvalidRotationItems,
  }
})

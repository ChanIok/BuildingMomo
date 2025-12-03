import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as Comlink from 'comlink'
import { useDebounceFn } from '@vueuse/core'
import type { ValidationItem } from '../types/editor'
import type { ValidationWorkerApi } from '../workers/editorValidation.worker'
import Worker from '../workers/editorValidation.worker?worker'
import { useEditorStore } from './editorStore'
import { useSettingsStore } from './settingsStore'
import { useEditorHistory } from '../composables/editor/useEditorHistory'

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
      // 准备数据: 构造轻量级的 ValidationItem 数组
      // 避免使用 deepToRaw 递归去代理，避免 Worker 结构化克隆大量无用数据
      // 这里的 map 操作虽然在主线程，但对于 10k items 也是毫秒级的
      // items 是 ShallowRef，需要访问 .value
      const items: ValidationItem[] = activeScheme.value.items.value.map((item) => ({
        internalId: item.internalId,
        gameId: item.gameId,
        x: item.x,
        y: item.y,
        z: item.z,
        groupId: item.groupId,
        scale: {
          X: item.extra.Scale.X,
          Y: item.extra.Scale.Y,
          Z: item.extra.Scale.Z,
        },
        rotation: {
          Pitch: item.rotation.y,
          Yaw: item.rotation.z,
          Roll: item.rotation.x,
        },
      }))

      const areas =
        isBuildableAreaLoaded.value && buildableAreas.value ? buildableAreas.value : null
      const enableDup = settings.value.enableDuplicateDetection
      const enableLimit = settings.value.enableLimitDetection

      // 并行执行任务
      const promises: Promise<any>[] = [workerApi.detectDuplicates(items, enableDup)]

      // 只有开启了限制检测才执行检查
      if (enableLimit) {
        // Z 轴范围限制
        const zRange = { min: -3500, max: 10200 }
        promises.push(
          workerApi.checkLimits(items, isBuildableAreaLoaded.value ? areas : null, zRange)
        )
      } else {
        promises.push(Promise.resolve({ outOfBoundsItemIds: [], oversizedGroups: [] }))
      }

      const [duplicates, limits] = await Promise.all(promises)

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
      () => activeScheme.value?.items.value, // 监听 items.value (ShallowRef) 引用变化
      () => editorStore.sceneVersion, // 监听场景版本号（处理原地修改）
      () => settings.value.enableDuplicateDetection,
      () => settings.value.enableLimitDetection,
      isBuildableAreaLoaded,
    ],
    () => {
      debouncedValidation()
    },
    { deep: false }
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
  }

  // 选择超出限制的物品
  function selectOutOfBoundsItems() {
    if (!activeScheme.value || limitIssues.value.outOfBoundsItemIds.length === 0) return

    saveHistory('selection')
    activeScheme.value.selectedItemIds.value.clear()

    limitIssues.value.outOfBoundsItemIds.forEach((id) => {
      activeScheme.value!.selectedItemIds.value.add(id)
    })
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

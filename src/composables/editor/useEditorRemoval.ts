import { computed } from 'vue'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorStore } from '@/stores/editorStore'
import {
  getEmptyCollectionIds,
  hasOperationTargets,
  resolveEditorOperationTargets,
  type EditorOperationTargets,
} from '@/lib/scheme/collectionTargets'
import { UNCLASSIFIED } from '@/lib/scheme/collectionTree'
import { reconcileGroupOrigins, setSchemeItems } from '@/lib/scheme/groupState'
import type { CollectionEntry, HomeScheme } from '@/types/editor'
import { useEditorHistory } from './useEditorHistory'

type RemovalTarget = EditorOperationTargets & { scheme: HomeScheme }

/** 删除与剪切共享目标、权限和移除过程；事务由具体命令拥有。 */
export function useEditorRemoval() {
  const store = useEditorStore()
  const cloud = useCloudSchemeStore()
  const { recordTransaction } = useEditorHistory()
  const emptyCollectionCount = computed(() => {
    const scheme = store.activeScheme
    return scheme
      ? getEmptyCollectionIds(scheme.collectionTree.value, scheme.items.value).length
      : 0
  })

  function getRemovalTarget(entries?: readonly CollectionEntry[]): RemovalTarget | null {
    const scheme = store.activeScheme
    if (!scheme) return null
    const target = resolveEditorOperationTargets(scheme, store.isItemEditable, entries)
    if (!target || !hasOperationTargets(target)) return null
    // 节点操作要求目录编辑能力；原有画布家具操作仍可离线记入事务。
    if (
      (target.entries?.length ?? 0) > 0 &&
      scheme.source.value === 'cloud' &&
      (!scheme.collectionsSupported.value || !cloud.isConnected || cloud.schemeId !== scheme.id)
    )
      return null
    return { ...target, scheme }
  }

  function canRemove(entries?: readonly CollectionEntry[]) {
    return getRemovalTarget(entries) !== null
  }

  /** 仅在调用方的事务内执行，不另开历史记录。 */
  function applyRemoval(target: RemovalTarget) {
    const { scheme, collectionIds, items } = target
    const removed = new Set(items.map((item) => item.internalId))
    const nextItems = removed.size
      ? scheme.items.value.filter((item) => !removed.has(item.internalId))
      : scheme.items.value
    const liveGroups = new Set(nextItems.map((item) => item.groupId))
    const assignments = new Map(
      scheme.collectionTree.value.groups.map((group) => [group.groupId, group.collectionId])
    )
    const hasUnclassified = nextItems.some(
      (item) => item.groupId > 0 && !assignments.get(item.groupId)
    )

    // 先清理节点选择，避免面板同步 watcher 在结构更新途中回退为画布选择。
    if (scheme.selectedEntries.value !== null) {
      scheme.selectedEntries.value = scheme.selectedEntries.value.filter((entry) =>
        entry.kind === 'collection'
          ? entry.id === UNCLASSIFIED
            ? hasUnclassified
            : !collectionIds.has(entry.id)
          : liveGroups.has(entry.kind === 'ungrouped' ? 0 : entry.id)
      )
    }
    scheme.selectedItemIds.value = new Set(
      [...scheme.selectedItemIds.value].filter((id) => !removed.has(id))
    )
    if (removed.size) {
      setSchemeItems(scheme, nextItems)
      scheme.groupOrigins.value = reconcileGroupOrigins(scheme.groupOrigins.value, nextItems)
    }
    if (collectionIds.size) {
      const tree = scheme.collectionTree.value
      scheme.collectionTree.value = {
        nodes: tree.nodes.filter((node) => !collectionIds.has(node.id)),
        groups: tree.groups.filter((group) => !collectionIds.has(group.collectionId ?? '')),
      }
    }
    if (
      scheme.activeCollectionId.value &&
      (collectionIds.has(scheme.activeCollectionId.value) ||
        (scheme.activeCollectionId.value === UNCLASSIFIED && !hasUnclassified))
    )
      scheme.activeCollectionId.value = null
    if (removed.size) store.triggerSceneUpdate()
    store.triggerSelectionUpdate()
  }

  function remove(entries?: readonly CollectionEntry[]) {
    const target = getRemovalTarget(entries)
    if (!target) return false
    recordTransaction('selection.delete', () => applyRemoval(target), target.scheme)
    return true
  }

  function cleanEmptyCollections() {
    const scheme = store.activeScheme
    if (!scheme) return 0
    // 点击时重新解析当前方案，不使用按钮显示的计数或当前选区作为删除依据。
    const entries = getEmptyCollectionIds(scheme.collectionTree.value, scheme.items.value).map(
      (id) => ({ kind: 'collection' as const, id })
    )
    const target = getRemovalTarget(entries)
    if (!target) return 0
    recordTransaction('collection.cleanup_empty', () => applyRemoval(target), scheme)
    return target.collectionIds.size
  }

  return {
    canRemove,
    remove,
    getRemovalTarget,
    applyRemoval,
    emptyCollectionCount,
    cleanEmptyCollections,
  }
}

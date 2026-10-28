import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorHistory } from './useEditorHistory'
import { reconcileGroupOrigins, setSchemeItems } from '@/lib/groupState'
import {
  isCollectionTree,
  restrictedCollectionGroups,
  type CollectionTree,
} from '@/lib/collectionTree'
import { readOrganizeItems } from '@/lib/sceneAnalysis/organizeItems'
import { SceneAnalysisError, type OrganizationChanges } from '@/lib/sceneAnalysis/types'
import { freezeAnalysisValue, invalidInput } from '@/lib/sceneAnalysis/validation'

/** Explicit member IDs, never the changing UI selection. One call, one history entry. */
export function useEditorOrganization() {
  const editor = useEditorStore()
  const cloud = useCloudSchemeStore()
  const { recordTransaction } = useEditorHistory()

  function organize(
    parameters: unknown,
    expected: { schemeId: string; sceneVersion: number }
  ): OrganizationChanges {
    const scheme = editor.getSchemeById(expected.schemeId)
    function assertCurrent() {
      if (
        !scheme ||
        editor.getSchemeById(expected.schemeId) !== scheme ||
        scheme.id !== expected.schemeId ||
        editor.sceneVersion !== expected.sceneVersion
      ) {
        throw new SceneAnalysisError('stale_snapshot', 'Scene changed before organizing items')
      }
    }
    assertCurrent()
    if (!scheme) throw new SceneAnalysisError('unavailable', 'No active scheme')
    if (
      scheme.source.value === 'cloud' &&
      (!scheme.collectionsSupported.value || !cloud.isConnected || cloud.schemeId !== scheme.id)
    ) {
      throw new SceneAnalysisError(
        'unavailable',
        'Cloud collection editing is not available for this scheme'
      )
    }
    const command = readOrganizeItems(
      {
        itemIds: scheme.items.value.map((item) => item.internalId),
        collections: scheme.collectionTree.value.nodes,
      },
      parameters
    )
    const members = command.groups.flatMap((group) => group.itemIds)
    const editable = editor.getEditableItemIds(scheme)
    if (members.some((id) => !editable.has(id))) {
      throw new SceneAnalysisError('out_of_scope', 'Scope contains missing, hidden or locked items')
    }
    const currentTree = scheme.collectionTree.value
    if (!isCollectionTree(currentTree)) invalidInput('Invalid current collection hierarchy')
    const localIds = new Map(
      command.collections.map((node) => [node.id, crypto.randomUUID() as string])
    )
    const resolveCollection = (id: string | null) => (id === null ? null : (localIds.get(id) ?? id))
    const nodes = command.collections.map((node) => ({
      ...node,
      id: localIds.get(node.id)!,
      parentId: resolveCollection(node.parentId),
    }))
    let maxGroupId = scheme.maxGroupId.value
    for (const item of scheme.items.value) maxGroupId = Math.max(maxGroupId, item.groupId)
    if (!Number.isSafeInteger(maxGroupId + command.groups.length))
      invalidInput('Group ID allocator exhausted')
    const assignments = new Map<string, number>()
    const groups = command.groups.map((group) => {
      const groupId = ++maxGroupId
      for (const id of group.itemIds) assignments.set(id, groupId)
      return {
        groupId,
        name: group.name,
        collectionId: resolveCollection(group.collectionId),
        order: group.order,
      }
    })
    const items = scheme.items.value.map((item) => {
      const groupId = assignments.get(item.internalId)
      return groupId === undefined ? item : { ...item, groupId }
    })
    const live = new Set(items.map((item) => item.groupId))
    const nextTree: CollectionTree = {
      nodes: [...currentTree.nodes, ...nodes],
      groups: [...currentTree.groups.filter((group) => live.has(group.groupId)), ...groups],
    }
    if (!isCollectionTree(nextTree)) invalidInput('Invalid resulting collection hierarchy')
    // A destination may not make newly grouped items hidden/locked, including
    // the unclassified root. Restrictions are inherited with the shared rules.
    for (const flags of [scheme.hiddenCollectionIds.value, scheme.lockedCollectionIds.value]) {
      if (
        restrictedCollectionGroups(
          nextTree,
          flags,
          groups.map((group) => group.groupId)
        ).size
      ) {
        throw new SceneAnalysisError('out_of_scope', 'Destination collection is hidden or locked')
      }
    }
    const origins = reconcileGroupOrigins(scheme.groupOrigins.value, items)
    const movedByGroup = new Map<number, number>(),
      previousCounts = new Map<number, number>()
    for (const item of scheme.items.value) {
      if (item.groupId <= 0) continue
      previousCounts.set(item.groupId, (previousCounts.get(item.groupId) ?? 0) + 1)
      if (assignments.has(item.internalId))
        movedByGroup.set(item.groupId, (movedByGroup.get(item.groupId) ?? 0) + 1)
    }
    const result: OrganizationChanges = freezeAnalysisValue({
      collections: command.collections.map((node) => ({
        id: node.id,
        collectionId: localIds.get(node.id)!,
      })),
      groups: command.groups.map((group, index) => ({
        id: group.id,
        groupId: groups[index]!.groupId,
        itemCount: group.itemIds.length,
      })),
      regroupedItemCount: assignments.size,
      affectedGroups: [...movedByGroup].map(([groupId, movedItemCount]) => ({
        groupId,
        movedItemCount,
        remainingMemberCount: previousCounts.get(groupId)! - movedItemCount,
        originCleared: scheme.groupOrigins.value.has(groupId) && !origins.has(groupId),
      })),
    })
    // All fallible input/structure calculations precede the synchronous commit.
    assertCurrent()
    recordTransaction(
      'items.organize',
      () => {
        setSchemeItems(scheme, items)
        scheme.collectionTree.value = nextTree
        scheme.groupOrigins.value = origins
        scheme.maxGroupId.value = maxGroupId
        editor.triggerSceneUpdate(scheme)
      },
      scheme
    )
    const entries = scheme.history.value?.transactionUndoStack
    const transactionId = entries?.[entries.length - 1]?.transaction.id
    return { ...result, transactionId }
  }

  return { organize }
}

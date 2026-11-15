import { collectionAncestors, UNCLASSIFIED, type CollectionTree } from './collectionTree.ts'
import type { AppItem, CollectionEntry, HomeScheme } from '@/types/editor'

export interface EditorOperationTargets {
  entries: readonly CollectionEntry[] | null
  items: AppItem[]
  collectionIds: Set<string>
}

/** 无参解析当前节点选区及额外画布家具；传入节点时严格限定范围。 */
export function resolveEditorOperationTargets(
  scheme: Pick<HomeScheme, 'items' | 'collectionTree' | 'selectedEntries' | 'selectedItemIds'>,
  isItemEditable: (id: string) => boolean,
  entries?: readonly CollectionEntry[]
): EditorOperationTargets | null {
  const includeCanvasSelection = entries === undefined
  const selectedEntries = entries ?? scheme.selectedEntries.value
  const nodeEntries = selectedEntries ?? []
  const nodes = new Set(scheme.collectionTree.value.nodes.map((node) => node.id))
  const groups = new Set(scheme.items.value.map((item) => item.groupId))
  if (
    nodeEntries.some((entry) =>
      entry.kind === 'group'
        ? !groups.has(entry.id)
        : entry.kind === 'collection' && entry.id !== UNCLASSIFIED && !nodes.has(entry.id)
    )
  )
    return null

  const target = resolveCollectionTargets(
    scheme.collectionTree.value,
    scheme.items.value,
    nodeEntries
  )
  if (!includeCanvasSelection) return { ...target, entries: selectedEntries }
  const nodeItems = new Set(target.items.map((item) => item.internalId))
  return {
    ...target,
    entries: selectedEntries,
    items: scheme.items.value.filter(
      (item) =>
        nodeItems.has(item.internalId) ||
        (scheme.selectedItemIds.value.has(item.internalId) && isItemEditable(item.internalId))
    ),
  }
}

export function hasOperationTargets(target: EditorOperationTargets | null): boolean {
  return !!target && (target.items.length > 0 || target.collectionIds.size > 0)
}

/** 节点操作按完整结构解析，不受画布选择、显隐、锁定、搜索或折叠状态影响。 */
export function resolveCollectionTargets(
  tree: CollectionTree,
  items: readonly AppItem[],
  entries: readonly CollectionEntry[]
) {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]))
  const folders = new Set(entries.filter((entry) => entry.kind === 'collection').map((e) => e.id))
  const collectionIds = new Set(
    tree.nodes
      .filter((node) => collectionAncestors(nodes, node.id).some((id) => folders.has(id)))
      .map((node) => node.id)
  )
  const groupIds = new Set(entries.filter((e) => e.kind === 'group').map((e) => e.id))
  const assignments = new Map(tree.groups.map((group) => [group.groupId, group.collectionId]))
  const includeUngrouped = entries.some((entry) => entry.kind === 'ungrouped')
  return {
    collectionIds,
    items: items.filter((item) => {
      if (item.groupId === 0) return includeUngrouped
      const parent = assignments.get(item.groupId)
      return (
        groupIds.has(item.groupId) ||
        (parent ? collectionIds.has(parent) : folders.has(UNCLASSIFIED))
      )
    }),
  }
}

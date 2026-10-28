import { collectionAncestors, UNCLASSIFIED, type CollectionTree } from './collectionTree.ts'
import type { AppItem, CollectionEntry, HomeScheme } from '@/types/editor'

/** 节点操作按完整结构解析，不受画布选择、显隐、锁定、搜索或折叠状态影响。 */
export function resolveCollectionEntries(
  scheme: Pick<HomeScheme, 'items' | 'collectionTree'>,
  entries: readonly CollectionEntry[]
) {
  return resolveCollectionTargets(scheme.collectionTree.value, scheme.items.value, entries)
}

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

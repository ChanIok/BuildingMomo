import { collectionAncestors, UNCLASSIFIED } from './collectionTree'
import type { CollectionEntry, HomeScheme } from '@/types/editor'

/** 节点操作按完整结构解析，不受画布选择、显隐、锁定、搜索或折叠状态影响。 */
export function resolveCollectionEntries(scheme: HomeScheme, entries: readonly CollectionEntry[]) {
  const tree = scheme.collectionTree.value
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
    items: scheme.items.value.filter((item) => {
      if (item.groupId === 0) return includeUngrouped
      const parent = assignments.get(item.groupId)
      return (
        groupIds.has(item.groupId) ||
        (parent ? collectionIds.has(parent) : folders.has(UNCLASSIFIED))
      )
    }),
  }
}

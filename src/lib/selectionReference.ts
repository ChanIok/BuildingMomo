import { collectionAncestors, type CollectionTree } from './collectionTree.ts'
import { resolveCollectionTargets } from './collectionTargets.ts'
import type { AppItem, CollectionEntry, HomeScheme } from '@/types/editor'

/** 结构范围始终包含全部成员，不受显隐、锁定或面板过滤影响。 */
export function getCollectionItems(tree: CollectionTree, items: readonly AppItem[], id: string) {
  return resolveCollectionTargets(tree, items, [{ kind: 'collection', id }]).items
}

/** 仅在操作最终状态上协调引用；不猜测替代家具。 */
export function reconcileCollectionOrigins(
  tree: CollectionTree,
  items: readonly AppItem[]
): CollectionTree {
  if (!tree.nodes.some((node) => node.originItemId !== undefined)) return tree
  const parents = new Map(tree.nodes.map((node) => [node.id, node]))
  const assignments = new Map(tree.groups.map((group) => [group.groupId, group.collectionId]))
  const byId = new Map(items.map((item) => [item.internalId, item]))
  let changed = false
  const nodes = tree.nodes.map((node) => {
    if (node.originItemId === undefined) return node
    const item = byId.get(node.originItemId)
    if (
      item &&
      collectionAncestors(parents, assignments.get(item.groupId) ?? null).includes(node.id)
    )
      return node
    changed = true
    const { originItemId: _origin, ...rest } = node
    return rest
  })
  return changed ? { ...tree, nodes } : tree
}

export function remapCollectionOrigins(
  tree: CollectionTree,
  itemIds: ReadonlyMap<string, string>
): CollectionTree {
  return {
    ...tree,
    nodes: tree.nodes.map((node) => {
      if (node.originItemId === undefined) return node
      const { originItemId: previous, ...rest } = node
      const originItemId = itemIds.get(previous)
      return originItemId ? { ...rest, originItemId } : rest
    }),
  }
}

export function sameSelectionEntries(
  a: readonly CollectionEntry[] | null,
  b: readonly CollectionEntry[] | null
) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.length === b.length &&
      a.every((entry) => b.some((other) => entry.kind === other.kind && entry.id === other.id)))
  )
}

type CollectionSelection = Pick<
  HomeScheme,
  'items' | 'selectedItemIds' | 'selectedEntries' | 'collectionTree'
>

/** 显式选择的集合与完整性共同决定是否能作为整体操作。 */
export function getSelectedCollection(
  scheme: CollectionSelection,
  selectedIds: ReadonlySet<string> = scheme.selectedItemIds.value
) {
  const entries = scheme.selectedEntries.value
  const entry = entries?.length === 1 ? entries[0] : undefined
  if (entry?.kind !== 'collection') return null
  const node = scheme.collectionTree.value.nodes.find((node) => node.id === entry.id)
  if (!node) return null
  const members = getCollectionItems(scheme.collectionTree.value, scheme.items.value, node.id)
  return {
    node,
    members,
    complete:
      members.length > 0 &&
      members.length === selectedIds.size &&
      members.every((item) => selectedIds.has(item.internalId)),
  }
}

export type SelectionReference =
  { kind: 'collection'; id: string; item: AppItem } | { kind: 'group'; id: number; item: AppItem }

/** 集合需要明确的节点选择；画布选区仍沿用完整单组的原有语义。 */
export function resolveSelectionReference(
  scheme: CollectionSelection & Pick<HomeScheme, 'groupOrigins'>,
  selectedIds: ReadonlySet<string> = scheme.selectedItemIds.value
): SelectionReference | null {
  if (!selectedIds.size) return null
  const items = scheme.items.value
  const entries = scheme.selectedEntries.value
  const collection = getSelectedCollection(scheme, selectedIds)
  if (entries?.length === 1 && entries[0]!.kind === 'collection' && !collection) return null
  if (collection) {
    if (!collection.complete) return null
    const item = collection.members.find((item) => item.internalId === collection.node.originItemId)
    if (item) return { kind: 'collection', id: collection.node.id, item }
  }
  // 多节点选择不从其中任意一个节点借用原点。
  if (entries && entries.length !== 1) return null
  const first = items.find((item) => selectedIds.has(item.internalId))
  if (!first || first.groupId <= 0) return null
  const members = items.filter((item) => item.groupId === first.groupId)
  if (
    members.length !== selectedIds.size ||
    !members.every((item) => selectedIds.has(item.internalId))
  ) {
    return null
  }
  const item = members.find(
    (item) => item.internalId === scheme.groupOrigins.value.get(first.groupId)
  )
  return item ? { kind: 'group', id: first.groupId, item } : null
}

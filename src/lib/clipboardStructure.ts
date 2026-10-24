import { collectionAncestors, emptyCollectionTree, type CollectionTree } from './collectionTree'
import type { ClipboardData, ClipboardStructure, HomeScheme, PasteResult } from '@/types/editor'

export function createEmptyClipboardData(): ClipboardData {
  return {
    sourceSchemeId: null,
    items: [],
    groupOrigins: new Map(),
    structure: {
      tree: emptyCollectionTree(),
      collectionIds: [],
      hiddenGroups: [],
      lockedGroups: [],
      hiddenCollections: [],
      lockedCollections: [],
    },
  }
}

export function captureClipboardStructure(
  scheme: HomeScheme,
  groupIds: ReadonlySet<number>,
  collectionIds: ReadonlySet<string> = new Set()
): ClipboardStructure {
  const tree = scheme.collectionTree.value
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]))
  const groups = tree.groups.filter((group) => groupIds.has(group.groupId)).map((g) => ({ ...g }))
  const namedGroups = new Set(groups.map((group) => group.groupId))
  // 未命名、尚无目录元数据的组也要保留其组身份。
  for (const id of groupIds)
    if (!namedGroups.has(id)) groups.push({ groupId: id, collectionId: null, order: id })
  const needed = new Set(collectionIds)
  const parents = groups.flatMap((group) => (group.collectionId ? [group.collectionId] : []))
  for (const id of [...collectionIds, ...parents])
    for (const ancestor of collectionAncestors(nodes, id)) needed.add(ancestor)
  return {
    tree: {
      nodes: tree.nodes.filter((node) => needed.has(node.id)).map((node) => ({ ...node })),
      groups,
    },
    collectionIds: [...collectionIds],
    hiddenGroups: [...groupIds].filter((id) => scheme.hiddenGroupIds.value.has(id)),
    lockedGroups: [...groupIds].filter((id) => scheme.lockedGroupIds.value.has(id)),
    hiddenCollections: [...needed].filter((id) => scheme.hiddenCollectionIds.value.has(id)),
    lockedCollections: [...needed].filter((id) => scheme.lockedCollectionIds.value.has(id)),
  }
}

/** 新建副本节点，不通过名称匹配或合并目标方案的集合。undefined 表示沿用来源位置。 */
export function restoreClipboardStructure(
  structure: ClipboardStructure,
  current: CollectionTree,
  groupIds: ReadonlyMap<number, number>,
  sameScheme: boolean,
  parentId: string | null | undefined,
  copyName: (name: string) => string
) {
  const sourceNodes = new Map(structure.tree.nodes.map((node) => [node.id, node]))
  const existing = new Set(current.nodes.map((node) => node.id))
  const copied = new Set(structure.collectionIds)
  const collectionMap = new Map<string, string>()
  const nodes = [...current.nodes]
  const groups = [...current.groups]
  const nextOrder = (parent: string | null, kind: 'collection' | 'group') => {
    const orders =
      kind === 'collection'
        ? nodes.filter((node) => node.parentId === parent).map((node) => node.order)
        : groups.filter((group) => group.collectionId === parent).map((group) => group.order)
    return Math.max(-1, ...orders) + 1
  }

  function context(id: string | null): string | null {
    if (id === null) return parentId ?? null
    if (copied.has(id) || collectionMap.has(id)) return cloneNode(id)
    if (parentId !== undefined) return parentId
    if (sameScheme && existing.has(id)) return id
    return cloneNode(id)
  }
  function cloneNode(id: string): string {
    const cached = collectionMap.get(id)
    if (cached) return cached
    const source = sourceNodes.get(id)!
    // 显式复制的集合根不携带未选中的外部祖先；组根跨方案时则补全祖先路径。
    const isRoot = copied.has(id) && !copied.has(source.parentId ?? '')
    let parent: string | null
    if (!isRoot) parent = context(source.parentId)
    else if (parentId !== undefined) parent = parentId
    else
      parent =
        sameScheme && source.parentId && existing.has(source.parentId) ? source.parentId : null
    const nextId = crypto.randomUUID()
    collectionMap.set(id, nextId)
    nodes.push({
      ...source,
      id: nextId,
      parentId: parent,
      name: isRoot && sameScheme ? copyName(source.name) : source.name,
      order: copied.has(source.parentId ?? '') ? source.order : nextOrder(parent, 'collection'),
    })
    return nextId
  }
  for (const node of [...structure.tree.nodes].sort((a, b) => a.order - b.order))
    if (copied.has(node.id)) cloneNode(node.id)
  for (const group of [...structure.tree.groups].sort((a, b) => a.order - b.order)) {
    const id = groupIds.get(group.groupId)
    if (id === undefined) continue
    const parent = context(group.collectionId)
    groups.push({
      ...group,
      groupId: id,
      collectionId: parent,
      order: copied.has(group.collectionId ?? '') ? group.order : nextOrder(parent, 'group'),
    })
  }
  // 跨方案补全的祖先也是新副本的根节点，面板应该选中并定位它们。
  const newCollections = new Set(collectionMap.values())
  const newGroups = new Set(groupIds.values())
  const roots: PasteResult['roots'] = [
    ...nodes
      .filter((node) => newCollections.has(node.id) && !newCollections.has(node.parentId ?? ''))
      .map((node) => ({ kind: 'collection' as const, id: node.id })),
    ...groups
      .filter(
        (group) => newGroups.has(group.groupId) && !newCollections.has(group.collectionId ?? '')
      )
      .map((group) => ({ kind: 'group' as const, id: group.groupId })),
  ]
  return { tree: { nodes, groups }, collectionMap, roots }
}

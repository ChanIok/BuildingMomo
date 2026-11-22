import { emptyCollectionTree, type CollectionTree } from './collectionTree'
import type { ClipboardData, ClipboardStructure, HomeScheme, PasteResult } from '@/types/editor'

export function createEmptyClipboardData(): ClipboardData {
  return {
    sourceSchemeId: null,
    items: [],
    groupOrigins: new Map(),
    structure: {
      tree: emptyCollectionTree(),
      sourceParents: { collections: new Map(), groups: new Map() },
      hiddenGroups: [],
      lockedGroups: [],
      hiddenCollections: [],
      lockedCollections: [],
    },
  }
}

/**
 * 调用方已将选中的集合展开为完整子树；这里只快照实际复制的节点及自身标记。
 * 外部祖先的结构和显隐、锁定状态不随内容搬运。
 */
export function captureClipboardStructure(
  scheme: HomeScheme,
  groupIds: ReadonlySet<number>,
  collectionIds: ReadonlySet<string> = new Set()
): ClipboardStructure {
  const tree = scheme.collectionTree.value
  const nodes = tree.nodes.filter((node) => collectionIds.has(node.id)).map((node) => ({ ...node }))
  const groups = tree.groups.filter((group) => groupIds.has(group.groupId)).map((g) => ({ ...g }))
  const namedGroups = new Set(groups.map((group) => group.groupId))
  // 未命名、尚无目录元数据的组也要保留其组身份。
  for (const id of groupIds)
    if (!namedGroups.has(id)) groups.push({ groupId: id, collectionId: null, order: id })
  // 将外部父级单独保存，并在副本树中断开引用，使剪贴板本身也是合法的 CollectionTree。
  const sourceParents: ClipboardStructure['sourceParents'] = {
    collections: new Map(),
    groups: new Map(),
  }
  for (const node of nodes) {
    if (node.parentId !== null && !collectionIds.has(node.parentId)) {
      sourceParents.collections.set(node.id, node.parentId)
      node.parentId = null
    }
  }
  for (const group of groups) {
    if (group.collectionId !== null && !collectionIds.has(group.collectionId)) {
      sourceParents.groups.set(group.groupId, group.collectionId)
      group.collectionId = null
    }
  }
  return {
    tree: { nodes, groups },
    sourceParents,
    hiddenGroups: [...groupIds].filter((id) => scheme.hiddenGroupIds.value.has(id)),
    lockedGroups: [...groupIds].filter((id) => scheme.lockedGroupIds.value.has(id)),
    hiddenCollections: [...collectionIds].filter((id) => scheme.hiddenCollectionIds.value.has(id)),
    lockedCollections: [...collectionIds].filter((id) => scheme.lockedCollectionIds.value.has(id)),
  }
}

/**
 * 重建内部层级，只为实际复制的集合创建新 ID，不匹配名称或补建祖先。
 * parentId 只影响根节点：undefined 使用默认归属，null 明确放到根层，字符串指定目标集合。
 * 默认归属仅在同方案复用仍存在的来源父集合，否则放到根层（组合归入未分类）。
 */
export function restoreClipboardStructure(
  structure: ClipboardStructure,
  current: CollectionTree,
  groupIds: ReadonlyMap<number, number>,
  sameScheme: boolean,
  parentId: string | null | undefined,
  copyName: (name: string) => string,
  itemIds: ReadonlyMap<string, string> = new Map()
) {
  const existing = new Set(current.nodes.map((node) => node.id))
  // 先分配全部集合 ID，后续恢复父子关系就不依赖节点的遍历顺序。
  const collectionMap = new Map(structure.tree.nodes.map((node) => [node.id, crypto.randomUUID()]))
  const nodes = [...current.nodes]
  const groups = [...current.groups]
  // 面板只选择、定位新增内容的根节点，不把已有目标集合纳入选区。
  const roots: PasteResult['roots'] = []
  const nextOrder = (parent: string | null, kind: 'collection' | 'group') => {
    const orders =
      kind === 'collection'
        ? nodes.filter((node) => node.parentId === parent).map((node) => node.order)
        : groups.filter((group) => group.collectionId === parent).map((group) => group.order)
    return Math.max(-1, ...orders) + 1
  }

  function rootParent(sourceParent: string | undefined): string | null {
    if (parentId !== undefined) return parentId
    return sameScheme && sourceParent && existing.has(sourceParent) ? sourceParent : null
  }
  // 根节点按来源顺序追加到目标末尾；子节点沿用内部顺序。
  for (const source of [...structure.tree.nodes].sort((a, b) => a.order - b.order)) {
    const nextId = collectionMap.get(source.id)!
    const isRoot = source.parentId === null
    const parent =
      source.parentId === null
        ? rootParent(structure.sourceParents.collections.get(source.id))
        : collectionMap.get(source.parentId)!
    const { originItemId: sourceOrigin, ...nodeData } = source
    const originItemId = sourceOrigin ? itemIds.get(sourceOrigin) : undefined
    nodes.push({
      ...nodeData,
      ...(originItemId ? { originItemId } : {}),
      id: nextId,
      parentId: parent,
      name: isRoot && sameScheme ? copyName(source.name) : source.name,
      order: isRoot ? nextOrder(parent, 'collection') : source.order,
    })
    if (isRoot) roots.push({ kind: 'collection', id: nextId })
  }
  for (const group of [...structure.tree.groups].sort((a, b) => a.order - b.order)) {
    const id = groupIds.get(group.groupId)
    if (id === undefined) continue
    const isRoot = group.collectionId === null
    const parent =
      group.collectionId === null
        ? rootParent(structure.sourceParents.groups.get(group.groupId))
        : collectionMap.get(group.collectionId)!
    groups.push({
      ...group,
      groupId: id,
      collectionId: parent,
      order: isRoot ? nextOrder(parent, 'group') : group.order,
    })
    if (isRoot) roots.push({ kind: 'group', id })
  }
  return { tree: { nodes, groups }, collectionMap, roots }
}

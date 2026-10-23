export const UNCLASSIFIED = '@unclassified'

/** 仅供编辑器使用的文档元数据，不写入游戏存档。 */
export interface SchemeCollection {
  id: string
  name: string
  parentId: string | null
  order: number
}

export interface GroupMetadata {
  groupId: number
  name?: string
  collectionId: string | null
  order: number
}

export interface CollectionTree {
  nodes: SchemeCollection[]
  groups: GroupMetadata[]
}

export function emptyCollectionTree(): CollectionTree {
  return { nodes: [], groups: [] }
}

export function isCollectionTree(value: unknown): value is CollectionTree {
  if (!value || typeof value !== 'object') return false
  const tree = value as CollectionTree
  if (!Array.isArray(tree.nodes) || !Array.isArray(tree.groups)) return false
  const parents = new Map<string, string | null>()
  for (const node of tree.nodes) {
    if (
      !node ||
      typeof node.id !== 'string' ||
      !node.id ||
      node.id === UNCLASSIFIED ||
      node.id.length > 100 ||
      typeof node.name !== 'string' ||
      !node.name.trim() ||
      node.name.length > 200 ||
      (node.parentId !== null && typeof node.parentId !== 'string') ||
      !Number.isFinite(node.order) ||
      parents.has(node.id)
    )
      return false
    parents.set(node.id, node.parentId)
  }
  const checked = new Set<string>()
  for (const id of parents.keys()) {
    const path = new Set<string>()
    let cursor: string | null = id
    while (cursor !== null && !checked.has(cursor)) {
      if (!parents.has(cursor) || path.has(cursor)) return false
      path.add(cursor)
      cursor = parents.get(cursor)!
    }
    for (const entry of path) checked.add(entry)
  }
  const groups = new Set<number>()
  for (const entry of tree.groups) {
    if (
      !entry ||
      !Number.isSafeInteger(entry.groupId) ||
      entry.groupId <= 0 ||
      (entry.name !== undefined &&
        (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 200)) ||
      (entry.collectionId !== null && !parents.has(entry.collectionId)) ||
      !Number.isFinite(entry.order) ||
      groups.has(entry.groupId)
    )
      return false
    groups.add(entry.groupId)
  }
  return true
}

export function readCollectionTree(value?: unknown): CollectionTree {
  if (value === undefined) return emptyCollectionTree()
  if (!isCollectionTree(value)) throw new Error('Invalid collection tree')
  // 快照可能来自 Vue 响应式的最近关闭列表。
  return {
    nodes: value.nodes.map(({ id, name, parentId, order }) => ({ id, name, parentId, order })),
    groups: value.groups.map(({ groupId, name, collectionId, order }) => ({
      groupId,
      collectionId,
      order,
      ...(name === undefined ? {} : { name }),
    })),
  }
}

export function collectionTreesEqual(a: CollectionTree, b: CollectionTree): boolean {
  if (a.nodes.length !== b.nodes.length || a.groups.length !== b.groups.length) return false
  const nodes = new Map(b.nodes.map((node) => [node.id, node]))
  const groups = new Map(b.groups.map((entry) => [entry.groupId, entry]))
  return (
    a.nodes.every((node) => {
      const other = nodes.get(node.id)
      return (
        other &&
        node.name === other.name &&
        node.parentId === other.parentId &&
        node.order === other.order
      )
    }) &&
    a.groups.every((entry) => {
      const other = groups.get(entry.groupId)
      return (
        other &&
        entry.name === other.name &&
        entry.collectionId === other.collectionId &&
        entry.order === other.order
      )
    })
  )
}

/** 为事务和剪贴板提供只读投影，不另建可写状态。 */
export function groupNameEntries(tree: CollectionTree): Array<[number, string]> {
  return tree.groups.flatMap((group) =>
    group.name === undefined ? [] : [[group.groupId, group.name] as [number, string]]
  )
}

/** 修改名称时保留分类，不覆盖无关名称。 */
export function patchGroupNames(
  tree: CollectionTree,
  before: readonly (readonly [number, string])[],
  after: readonly (readonly [number, string])[]
): CollectionTree {
  const changes = new Map<number, string | undefined>(before.map(([id]) => [id, undefined]))
  for (const [id, name] of after) changes.set(id, name)
  const groups: GroupMetadata[] = []
  for (const group of tree.groups) {
    if (!changes.has(group.groupId)) {
      groups.push(group)
      continue
    }
    const name = changes.get(group.groupId)
    changes.delete(group.groupId)
    if (name === group.name) {
      groups.push(group)
      continue
    }
    const { name: _old, ...rest } = group
    if (name !== undefined) groups.push({ ...rest, name })
    else if (rest.collectionId !== null || rest.order !== rest.groupId) groups.push(rest)
  }
  for (const [groupId, name] of changes) {
    if (name !== undefined) groups.push({ groupId, name, collectionId: null, order: groupId })
  }
  return groups.length === tree.groups.length &&
    groups.every((group, index) => group === tree.groups[index])
    ? tree
    : { ...tree, groups }
}

/** 目录事务排除名称，也排除仅记录名称的元数据条目。 */
export function collectionStructure(tree: CollectionTree): CollectionTree {
  return {
    nodes: tree.nodes,
    groups: tree.groups
      .filter((group) => group.collectionId !== null || group.order !== group.groupId)
      .map(({ groupId, collectionId, order }) => ({ groupId, collectionId, order })),
  }
}

/** 应用目录编辑，同时保留并发修改的组名。 */
export function applyCollectionStructure(
  current: CollectionTree,
  structure: CollectionTree
): CollectionTree {
  return patchGroupNames(collectionStructure(structure), [], groupNameEntries(current))
}

export function collectionAncestors(
  nodes: ReadonlyMap<string, SchemeCollection>,
  id: string | null
): string[] {
  const result: string[] = []
  while (id !== null && nodes.has(id) && !result.includes(id)) {
    result.push(id)
    id = nodes.get(id)!.parentId
  }
  return result
}

/** 文档元数据与个人工作状态共用同一份组 ID 映射。 */
export function getGroupChanges(
  previous: readonly { internalId: string; groupId: number }[],
  next: readonly { internalId: string; groupId: number }[]
) {
  const live = new Set(next.map((item) => item.groupId))
  const nextById = new Map(next.map((item) => [item.internalId, item.groupId]))
  const destinations = new Map<number, Set<number>>()
  for (const item of previous) {
    const to = nextById.get(item.internalId)
    if (item.groupId <= 0 || to === undefined) continue
    if (!destinations.has(item.groupId)) destinations.set(item.groupId, new Set())
    destinations.get(item.groupId)!.add(to)
  }
  const remap = new Map<number, number>()
  for (const [from, targets] of destinations) {
    const to = [...targets][0]!
    if (targets.size === 1 && to > 0 && to !== from) remap.set(from, to)
  }
  return { live, remap }
}

/** 协调组删除和整组重新编号，保留空集合以支持撤销。 */
export function reconcileCollectionGroups(
  tree: CollectionTree,
  { live, remap }: ReturnType<typeof getGroupChanges>
): CollectionTree {
  if (!tree.groups.length) return tree
  const assignments = new Map<number, GroupMetadata>()
  // 多个组合并时，优先保留目标组已有的分类。
  for (const entry of tree.groups) {
    if (!remap.has(entry.groupId) && live.has(entry.groupId)) assignments.set(entry.groupId, entry)
  }
  for (const entry of tree.groups) {
    const groupId = remap.get(entry.groupId) ?? entry.groupId
    if (live.has(groupId) && !assignments.has(groupId)) {
      assignments.set(groupId, groupId === entry.groupId ? entry : { ...entry, groupId })
    }
  }
  const groups = [...assignments.values()]
  return groups.length === tree.groups.length &&
    groups.every((entry, index) => entry === tree.groups[index])
    ? tree
    : { ...tree, groups }
}

/** 继承限制通过计算得出，不写入子节点的个人状态。 */
export function restrictedCollectionGroups(
  tree: CollectionTree,
  restricted: ReadonlySet<string>,
  groupIds: Iterable<number>
): Set<number> {
  if (!restricted.size) return new Set()
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]))
  const parents = new Map(tree.groups.map((group) => [group.groupId, group.collectionId]))
  const cache = new Map<string, boolean>()
  function affected(id: string | null): boolean {
    if (id === null) return false
    if (cache.has(id)) return cache.get(id)!
    const value = restricted.has(id) || affected(nodes.get(id)?.parentId ?? null)
    cache.set(id, value)
    return value
  }
  return new Set(
    [...groupIds].filter((id) => {
      const parent = parents.get(id) ?? null
      return parent === null ? restricted.has(UNCLASSIFIED) : affected(parent)
    })
  )
}

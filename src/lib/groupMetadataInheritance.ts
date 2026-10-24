import { collectionTreesEqual, type CollectionTree, type GroupMetadata } from './collectionTree'
import type { AppItem, HomeScheme } from '@/types/editor'

export interface GroupMetadataInput {
  items: readonly AppItem[]
  collectionTree: CollectionTree
  groupOrigins: ReadonlyMap<number, string>
}

export function groupMetadataInput(scheme: HomeScheme): GroupMetadataInput {
  return {
    items: scheme.items.value,
    collectionTree: scheme.collectionTree.value,
    groupOrigins: scheme.groupOrigins.value,
  }
}

function indexGroups(items: readonly AppItem[]) {
  const groups = new Map<number, Map<string, AppItem[]>>()
  for (const item of items) {
    if (item.groupId <= 0) continue
    let members = groups.get(item.groupId)
    if (!members) groups.set(item.groupId, (members = new Map()))
    const key = `${item.instanceId}:${item.gameId}`
    const duplicates = members.get(key)
    if (duplicates) duplicates.push(item)
    else members.set(key, [item])
  }
  return groups
}

/** 只迁移完整精确匹配的组；不修改家具、来源数据或目标的个人状态。 */
export function inheritGroupMetadata(source: GroupMetadataInput, target: GroupMetadataInput) {
  const sourceGroups = indexGroups(source.items)
  const targetGroups = indexGroups(target.items)
  const matched = new Set<number>()
  for (const [id, members] of targetGroups) {
    const other = sourceGroups.get(id)
    if (
      other?.size === members.size &&
      [...members].every(([key, items]) => other.get(key)?.length === items.length)
    ) {
      matched.add(id)
    }
  }

  const sourceNodes = new Map(source.collectionTree.nodes.map((node) => [node.id, node]))
  const nodes = [...target.collectionTree.nodes]
  const targetNodes = new Map(nodes.map((node) => [node.id, node]))
  const nodeMap = new Map<string, string>()
  const usedNodes = new Set<string>()
  function inheritNode(id: string): string {
    const known = nodeMap.get(id)
    if (known) return known
    const node = sourceNodes.get(id)!
    const parentId = node.parentId === null ? null : inheritNode(node.parentId)
    const same = (candidate: typeof node) =>
      !usedNodes.has(candidate.id) &&
      candidate.parentId === parentId &&
      candidate.name === node.name &&
      candidate.order === node.order
    const byId = targetNodes.get(id)
    // 不覆盖已有节点（它可能也包含未匹配组）。复用相同分支使重复导入保持幂等。
    let destination = byId && same(byId) ? byId : nodes.find(same)
    if (!destination) {
      destination = { ...node, id: targetNodes.has(id) ? crypto.randomUUID() : id, parentId }
      nodes.push(destination)
      targetNodes.set(destination.id, destination)
    }
    nodeMap.set(id, destination.id)
    usedNodes.add(destination.id)
    return destination.id
  }

  const sourceMetadata = new Map(
    source.collectionTree.groups.map((group) => [group.groupId, group])
  )
  const previousMetadata = new Map(
    target.collectionTree.groups.map((group) => [group.groupId, group])
  )
  const groups = target.collectionTree.groups.filter((group) => !matched.has(group.groupId))
  const origins = new Map(target.groupOrigins)
  let changedGroupCount = 0
  let skippedOriginCount = 0
  for (const groupId of matched) {
    const from = sourceMetadata.get(groupId)
    const next: GroupMetadata | undefined = from && {
      ...from,
      collectionId: from.collectionId === null ? null : inheritNode(from.collectionId),
    }
    if (next) groups.push(next)
    origins.delete(groupId)
    const originId = source.groupOrigins.get(groupId)
    if (originId !== undefined) {
      const sourceMembers = sourceGroups.get(groupId)!
      const origin = [...sourceMembers.values()].flat().find((item) => item.internalId === originId)
      const candidates =
        origin && targetGroups.get(groupId)!.get(`${origin.instanceId}:${origin.gameId}`)
      if (candidates?.length === 1) origins.set(groupId, candidates[0]!.internalId)
      else skippedOriginCount++
    }
    const previous = previousMetadata.get(groupId)
    if (
      previous?.name !== next?.name ||
      (previous?.collectionId ?? null) !== (next?.collectionId ?? null) ||
      (previous?.order ?? groupId) !== (next?.order ?? groupId) ||
      target.groupOrigins.get(groupId) !== origins.get(groupId)
    ) {
      changedGroupCount++
    }
  }
  const nextTree = { nodes, groups }
  const originsChanged = [...matched].some((id) => target.groupOrigins.get(id) !== origins.get(id))
  return {
    collectionTree: collectionTreesEqual(target.collectionTree, nextTree)
      ? target.collectionTree
      : nextTree,
    groupOrigins: originsChanged ? origins : target.groupOrigins,
    matchedGroupCount: matched.size,
    targetGroupCount: targetGroups.size,
    changedGroupCount,
    skippedOriginCount,
  }
}

import { decodeColorMapToGroupMap } from './colorMap'
import { getCollectionItems, reconcileCollectionOrigins } from './selectionReference'
import { collectionTreesEqual, type CollectionTree, type GroupMetadata } from './collectionTree'
import type { AppItem, HomeScheme } from '@/types/editor'

export interface GroupMetadataInput {
  items: readonly AppItem[]
  collectionTree: CollectionTree
  groupOrigins: ReadonlyMap<number, string>
}

export interface InheritGroupMetadataOptions {
  /** 是否仅按组 ID 与成员实例 ID/类型 ID 精确匹配；默认 true 保持自动继承等调用方语义不变。 */
  exactMatch?: boolean
}

export function groupMetadataInput(scheme: HomeScheme): GroupMetadataInput {
  return {
    items: scheme.items.value,
    collectionTree: scheme.collectionTree.value,
    groupOrigins: scheme.groupOrigins.value,
  }
}

interface IndexedGroup {
  byIdentity: Map<string, AppItem[]>
  items: AppItem[]
}

function indexGroups(items: readonly AppItem[]) {
  const groups = new Map<number, IndexedGroup>()
  for (const item of items) {
    if (item.groupId <= 0) continue
    let group = groups.get(item.groupId)
    if (!group) groups.set(item.groupId, (group = { byIdentity: new Map(), items: [] }))
    group.items.push(item)
    const key = `${item.instanceId}:${item.gameId}`
    const duplicates = group.byIdentity.get(key)
    if (duplicates) duplicates.push(item)
    else group.byIdentity.set(key, [item])
  }
  return groups
}

function quantizeScale(value: unknown): string {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 1
  const rounded = Math.round(number * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function itemFuzzyKey(item: AppItem): string {
  const scale = item.extra?.Scale
  const sx = quantizeScale(scale?.X)
  const sy = quantizeScale(scale?.Y)
  const sz = quantizeScale(scale?.Z)
  const colorMap = decodeColorMapToGroupMap(item.extra?.ColorMap)
  const colorSig =
    colorMap.size === 0
      ? ''
      : [...colorMap.entries()]
          .sort(([a], [b]) => a - b)
          .map(([slot, color]) => `${slot}=${color}`)
          .join(',')
  return `${item.gameId}|${sx},${sy},${sz}|${colorSig}`
}

function groupFuzzySignature(items: readonly AppItem[]): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = itemFuzzyKey(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, count]) => `${key}*${count}`)
    .join('\n')
}

/** 迁移匹配的组信息；不修改家具、来源数据或目标的个人状态。 */
export function inheritGroupMetadata(
  source: GroupMetadataInput,
  target: GroupMetadataInput,
  options?: InheritGroupMetadataOptions
) {
  const exactMatch = options?.exactMatch ?? true
  const sourceGroups = indexGroups(source.items)
  const targetGroups = indexGroups(target.items)
  const sourceMetadata = new Map(
    source.collectionTree.groups.map((group) => [group.groupId, group])
  )
  const previousMetadata = new Map(
    target.collectionTree.groups.map((group) => [group.groupId, group])
  )

  const matched = new Map<number, { sourceGroupId: number; exact: boolean }>()
  const exactMatchedTargetIds = new Set<number>()
  const usedSourceIds = new Set<number>()

  // 第一轮：精确匹配优先，锁定组 ID 与成员实例 ID/类型 ID 完全一致的组。
  for (const [id, targetGroup] of targetGroups) {
    const sourceGroup = sourceGroups.get(id)
    if (
      sourceGroup &&
      sourceGroup.byIdentity.size === targetGroup.byIdentity.size &&
      [...targetGroup.byIdentity].every(
        ([key, items]) => sourceGroup.byIdentity.get(key)?.length === items.length
      )
    ) {
      matched.set(id, { sourceGroupId: id, exact: true })
      exactMatchedTargetIds.add(id)
      usedSourceIds.add(id)
    }
  }

  let ambiguousMatchCount = 0
  if (!exactMatch) {
    // 第二轮：对剩余组按家具类型、数量、量化缩放和规范化染色做模糊匹配；跳过空白源组。
    const sourceBySignature = new Map<string, number[]>()
    const sortedSourceIds = [...sourceGroups.keys()].sort((a, b) => a - b)
    for (const sourceId of sortedSourceIds) {
      const meta = sourceMetadata.get(sourceId)
      if (!meta || (meta.name === undefined && meta.collectionId === null)) continue
      const sig = groupFuzzySignature(sourceGroups.get(sourceId)!.items)
      const list = sourceBySignature.get(sig)
      if (list) list.push(sourceId)
      else sourceBySignature.set(sig, [sourceId])
    }

    const initialUnusedCountBySignature = new Map<string, number>()
    for (const [sig, candidates] of sourceBySignature) {
      initialUnusedCountBySignature.set(
        sig,
        candidates.filter((id) => !usedSourceIds.has(id)).length
      )
    }

    const remainingTargetIds = [...targetGroups.keys()]
      .filter((id) => !matched.has(id))
      .sort((a, b) => a - b)
    const remainingTargetSignatures = new Map<number, string>()
    const targetCountBySignature = new Map<string, number>()
    for (const targetId of remainingTargetIds) {
      const sig = groupFuzzySignature(targetGroups.get(targetId)!.items)
      remainingTargetSignatures.set(targetId, sig)
      targetCountBySignature.set(sig, (targetCountBySignature.get(sig) ?? 0) + 1)
    }

    for (const targetId of remainingTargetIds) {
      const sig = remainingTargetSignatures.get(targetId)!
      const candidates = sourceBySignature.get(sig)
      if (!candidates?.length) continue

      const nextUnused = candidates.find((id) => !usedSourceIds.has(id))
      const sourceGroupId = nextUnused ?? candidates[0]!
      if (nextUnused !== undefined) usedSourceIds.add(nextUnused)

      matched.set(targetId, { sourceGroupId, exact: false })

      const initialUnused = initialUnusedCountBySignature.get(sig) ?? 0
      const targetCountForSig = targetCountBySignature.get(sig) ?? 0
      if (candidates.length > 1 && !(initialUnused === 1 && targetCountForSig === 1)) {
        ambiguousMatchCount++
      }
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
      const { originItemId: _sourceOrigin, ...data } = node
      destination = { ...data, id: targetNodes.has(id) ? crypto.randomUUID() : id, parentId }
      nodes.push(destination)
      targetNodes.set(destination.id, destination)
    }
    nodeMap.set(id, destination.id)
    usedNodes.add(destination.id)
    return destination.id
  }

  const groups = target.collectionTree.groups.filter((group) => !matched.has(group.groupId))
  const origins = new Map(target.groupOrigins)
  let changedGroupCount = 0
  let skippedOriginCount = 0
  for (const [targetGroupId, { sourceGroupId, exact }] of matched) {
    const from = sourceMetadata.get(sourceGroupId)
    const next: GroupMetadata | undefined = from && {
      ...from,
      groupId: targetGroupId,
      collectionId: from.collectionId === null ? null : inheritNode(from.collectionId),
      order:
        !exact && from.collectionId === null && from.order === sourceGroupId
          ? targetGroupId
          : from.order,
    }
    if (next) groups.push(next)
    if (exact) {
      origins.delete(targetGroupId)
      const originId = source.groupOrigins.get(sourceGroupId)
      if (originId !== undefined) {
        const sourceGroup = sourceGroups.get(sourceGroupId)!
        const origin = sourceGroup.items.find((item) => item.internalId === originId)
        const candidates =
          origin &&
          targetGroups.get(targetGroupId)!.byIdentity.get(`${origin.instanceId}:${origin.gameId}`)
        if (candidates?.length === 1) origins.set(targetGroupId, candidates[0]!.internalId)
        else skippedOriginCount++
      }
    } else if (source.groupOrigins.has(sourceGroupId)) {
      // 模糊匹配跳过原点迁移，不覆盖目标组已有原点。
      skippedOriginCount++
    }
    const previous = previousMetadata.get(targetGroupId)
    if (
      previous?.name !== next?.name ||
      (previous?.collectionId ?? null) !== (next?.collectionId ?? null) ||
      (previous?.order ?? targetGroupId) !== (next?.order ?? targetGroupId) ||
      target.groupOrigins.get(targetGroupId) !== origins.get(targetGroupId)
    ) {
      changedGroupCount++
    }
  }
  const originalNodes = new Map(target.collectionTree.nodes.map((node) => [node.id, node]))
  const sourceForNode = new Map([...nodeMap].map(([sourceId, targetId]) => [targetId, sourceId]))
  let changedCollectionOriginCount = 0
  const nextNodes = nodes.map((node) => {
    const sourceId = sourceForNode.get(node.id)
    if (!sourceId) return node
    // 混有未精确匹配组的既有分支不改原点；完整精确匹配的分支可以继承更新。
    if (
      originalNodes.has(node.id) &&
      getCollectionItems({ nodes, groups }, target.items, node.id).some(
        (item) => !exactMatchedTargetIds.has(item.groupId)
      )
    )
      return node
    const originId = sourceNodes.get(sourceId)?.originItemId
    const origin = source.items.find((item) => item.internalId === originId)
    const candidates =
      origin && exactMatchedTargetIds.has(origin.groupId)
        ? targetGroups.get(origin.groupId)?.byIdentity.get(`${origin.instanceId}:${origin.gameId}`)
        : undefined
    const originItemId = candidates?.length === 1 ? candidates[0]!.internalId : undefined
    if (originId && !originItemId) skippedOriginCount++
    if (originalNodes.get(node.id)?.originItemId !== originItemId) changedCollectionOriginCount++
    if (node.originItemId === originItemId) return node
    const { originItemId: _previous, ...rest } = node
    return originItemId ? { ...rest, originItemId } : rest
  })
  const nextTree = reconcileCollectionOrigins({ nodes: nextNodes, groups }, target.items)
  const originsChanged = [...matched.keys()].some(
    (id) => target.groupOrigins.get(id) !== origins.get(id)
  )
  return {
    collectionTree: collectionTreesEqual(target.collectionTree, nextTree)
      ? target.collectionTree
      : nextTree,
    groupOrigins: originsChanged ? origins : target.groupOrigins,
    matchedGroupCount: matched.size,
    targetGroupCount: targetGroups.size,
    changedGroupCount,
    changedCollectionOriginCount,
    skippedOriginCount,
    ambiguousMatchCount,
  }
}

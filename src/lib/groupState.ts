import {
  getGroupChanges,
  readCollectionTree,
  reconcileCollectionGroups,
  type CollectionTree,
} from './collectionTree'
import { ref, shallowRef } from 'vue'
import type { AppItem, HomeScheme } from '@/types/editor'

/** 共享组元数据与个人工作状态分别管理生命周期。 */
export function createGroupState(
  source: { collectionTree?: CollectionTree } = {},
  personal: {
    hiddenGroupIds?: Iterable<number>
    lockedGroupIds?: Iterable<number>
    collapsedCollectionIds?: Iterable<string>
    hiddenCollectionIds?: Iterable<string>
    lockedCollectionIds?: Iterable<string>
  } = {}
) {
  return {
    collectionTree: shallowRef(readCollectionTree(source.collectionTree)),
    collapsedCollectionIds: shallowRef<ReadonlySet<string>>(
      new Set(personal.collapsedCollectionIds)
    ),
    hiddenCollectionIds: shallowRef<ReadonlySet<string>>(new Set(personal.hiddenCollectionIds)),
    lockedCollectionIds: shallowRef<ReadonlySet<string>>(new Set(personal.lockedCollectionIds)),
    activeCollectionId: ref<string | null>(null),
    collectionsSupported: ref(true),
    hiddenGroupIds: shallowRef<ReadonlySet<number>>(new Set(personal.hiddenGroupIds)),
    lockedGroupIds: shallowRef<ReadonlySet<number>>(new Set(personal.lockedGroupIds)),
    activeGroupId: ref<number | null>(null),
  }
}

/**
 * 组合原点只在原点家具仍属于该组时有效。
 * 判据取自变更后的状态，因此“整组被并入目标组”不会误删目标的原点。
 */
export function reconcileGroupOrigins(
  origins: Map<number, string>,
  items: readonly AppItem[]
): Map<number, string> {
  const groupOf = new Map(items.map((item) => [item.internalId, item.groupId]))
  let next: Map<number, string> | null = null
  for (const [groupId, itemId] of origins) {
    if (groupOf.get(itemId) === groupId) continue
    next ??= new Map(origins)
    next.delete(groupId)
  }
  return next ?? origins
}

/** 成员变更先协调原有组 ID，再添加新元数据或重放补丁。 */
export function setSchemeItems(scheme: HomeScheme, next: AppItem[]) {
  if (scheme.items.value === next) return
  const changes = getGroupChanges(scheme.items.value, next)
  scheme.items.value = next
  scheme.collectionTree.value = reconcileCollectionGroups(scheme.collectionTree.value, changes)
  const { live, remap } = changes
  for (const state of [scheme.hiddenGroupIds, scheme.lockedGroupIds]) {
    if ([...state.value].some((id) => remap.has(id))) {
      state.value = new Set([...state.value].map((id) => remap.get(id) ?? id))
    }
  }
  if (scheme.activeGroupId.value !== null) {
    const id = remap.get(scheme.activeGroupId.value) ?? scheme.activeGroupId.value
    scheme.activeGroupId.value = live.has(id) ? id : null
  }
}

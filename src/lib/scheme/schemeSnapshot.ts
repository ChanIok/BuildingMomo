import type { HomeScheme } from '@/types/editor'
import type { SharedSchemeSnapshot } from '@/types/cloudScheme'
import { collectionTreesEqual, readCollectionTree } from './collectionTree'

// 仅比较 JSON 数据内容，不把对象属性顺序视为修改。
function jsonContentEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => jsonContentEqual(value, b[index]))
    )
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  return (
    keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(right, key) && jsonContentEqual(left[key], right[key]))
  )
}

/** 重连覆盖前检查编辑内容；管理员改名和文件元数据不触发恢复副本。 */
export function sharedSchemeContentMatches(
  scheme: HomeScheme,
  snapshot: SharedSchemeSnapshot
): boolean {
  const items = scheme.items.value
  if (items.length !== snapshot.items.length) return false
  const remoteItems = new Map(snapshot.items.map((item) => [item.internalId, item]))
  if (!items.every((item) => jsonContentEqual(item, remoteItems.get(item.internalId)))) return false
  if (
    !collectionTreesEqual(scheme.collectionTree.value, readCollectionTree(snapshot.collectionTree))
  )
    return false
  const origins = new Map(snapshot.groupOrigins)
  return (
    scheme.groupOrigins.value.size === origins.size &&
    [...scheme.groupOrigins.value].every(([id, itemId]) => origins.get(id) === itemId)
  )
}

export function buildSharedSchemeSnapshot(scheme: HomeScheme): SharedSchemeSnapshot {
  return {
    name: scheme.name.value,
    filePath: scheme.filePath.value,
    lastModified: scheme.lastModified.value,
    items: structuredClone(scheme.items.value),
    collectionTree: structuredClone(scheme.collectionTree.value),
    groupOrigins: structuredClone(Array.from(scheme.groupOrigins.value.entries())),
  }
}

import { isCollectionTree } from '@/lib/collectionTree'
import type { OrganizeItemsCommand } from './types'
import { assertScopedIds } from './queries'
import {
  freezeAnalysisValue,
  invalidInput,
  readObject,
  readString,
  readStrings,
} from './validation'

/** Validates a write command, not a saved proposal. Unmentioned items stay put.
 * Local collection refs may attach to existing authorized collection ancestors.
 */
export function readOrganizeItems(
  scope: {
    itemIds: readonly string[]
    collections: readonly import('@/lib/collectionTree').SchemeCollection[]
  },
  value: unknown
): OrganizeItemsCommand {
  const input = readObject(value, ['collections', 'groups'])
  if (!Array.isArray(input.collections) || !Array.isArray(input.groups))
    invalidInput('collections and groups must be arrays')
  if (!input.groups.length) invalidInput('At least one nonempty group is required')
  const existing = new Set(scope.collections.map((node) => node.id))
  const collections = input.collections.map((value, index) => {
    const node = readObject(value, ['id', 'name', 'parentId', 'order'])
    const id = readString(node.id, 'local collection ID', 100)
    if (existing.has(id)) invalidInput('New collection IDs must not shadow existing collections')
    return {
      id,
      name: readString(node.name, 'collection name', 200),
      parentId: node.parentId === null ? null : readString(node.parentId, 'parent ID', 100),
      order: node.order === undefined ? index : (node.order as number),
    }
  })
  const groups = input.groups.map((value, index) => {
    const group = readObject(value, ['id', 'name', 'collectionId', 'itemIds', 'order'])
    const itemIds = readStrings(group.itemIds, 'group item IDs')
    if (!itemIds.length) invalidInput('Groups cannot be empty')
    return {
      id: readString(group.id, 'local group ID', 100),
      name: readString(group.name, 'group name', 200),
      collectionId:
        group.collectionId === null ? null : readString(group.collectionId, 'collection ID', 100),
      itemIds,
      order: group.order === undefined ? index : (group.order as number),
    }
  })
  if (new Set(groups.map((group) => group.id)).size !== groups.length)
    invalidInput('Duplicate local group IDs')
  // These integers only validate the structure, never consume editor IDs.
  if (
    !isCollectionTree({
      nodes: [...scope.collections, ...collections],
      groups: groups.map((group, index) => ({
        groupId: index + 1,
        name: group.name,
        collectionId: group.collectionId,
        order: group.order,
      })),
    })
  )
    invalidInput('Invalid collection hierarchy or order')
  const members = groups.flatMap((group) => group.itemIds)
  if (new Set(members).size !== members.length) invalidInput('Item assigned more than once')
  assertScopedIds(members, new Set(scope.itemIds))
  // Do not create orphan folders on a typo or unused branch.
  const byId = new Map(collections.map((node) => [node.id, node]))
  const used = new Set<string>()
  for (const group of groups) {
    let cursor = group.collectionId
    while (cursor !== null && byId.has(cursor) && !used.has(cursor)) {
      used.add(cursor)
      cursor = byId.get(cursor)!.parentId
    }
  }
  if (used.size !== collections.length)
    invalidInput('Every new collection must contain a group or used descendant')
  return freezeAnalysisValue({ collections, groups })
}

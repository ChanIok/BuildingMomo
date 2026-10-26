import type { HomeScheme } from '@/types/editor'
import type { OrganizationChanges } from './types'

function state(scheme: HomeScheme, groupIds: number[], collectionIds: string[]) {
  const groups = new Set(groupIds),
    collections = new Set(collectionIds)
  return {
    schemeId: scheme.id,
    members: scheme.items.value
      .filter((item) => groups.has(item.groupId))
      .map((item) => [item.internalId, item.instanceId, item.groupId])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    groups: scheme.collectionTree.value.groups
      .filter((group) => groups.has(group.groupId))
      .sort((a, b) => a.groupId - b.groupId),
    collections: scheme.collectionTree.value.nodes
      .filter((node) => collections.has(node.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
    origins: [...scheme.groupOrigins.value]
      .filter(([id]) => groups.has(id))
      .sort((a, b) => a[0] - b[0]),
  }
}

/** Private local postcondition: never sent as model data or confused with undo history. */
export function organizationPostcondition(scheme: HomeScheme, result: OrganizationChanges) {
  const groupIds = result.groups.map((group) => group.groupId)
  const collectionIds = result.collections.map((node) => node.collectionId)
  return JSON.stringify({ groupIds, collectionIds, state: state(scheme, groupIds, collectionIds) })
}

export function verifyOrganization(scheme: HomeScheme | null | undefined, postcondition: string) {
  if (!scheme) return false
  try {
    const saved = JSON.parse(postcondition)
    return (
      JSON.stringify(state(scheme, saved.groupIds, saved.collectionIds)) ===
      JSON.stringify(saved.state)
    )
  } catch {
    return false
  }
}

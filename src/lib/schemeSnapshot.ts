import type { HomeScheme } from '@/types/editor'
import type { SharedSchemeSnapshot } from '@/types/cloudScheme'

export function buildSharedSchemeSnapshot(scheme: HomeScheme): SharedSchemeSnapshot {
  return {
    name: scheme.name.value,
    filePath: scheme.filePath.value,
    lastModified: scheme.lastModified.value,
    items: structuredClone(scheme.items.value),
    groupOrigins: structuredClone(Array.from(scheme.groupOrigins.value.entries())),
  }
}

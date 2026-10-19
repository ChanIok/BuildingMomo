import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { requiredInstanceCount } from '@/lib/renderInstanceBudget'

/** Filter before applying the instance budget; retain the authoritative item references. */
export function selectRenderItems(
  items: readonly AppItem[],
  itemIds: ReadonlySet<string> | null
): readonly AppItem[] {
  const visible = itemIds === null ? items : items.filter((item) => itemIds.has(item.internalId))
  const count = requiredInstanceCount(visible.length)
  return count === visible.length ? visible : visible.slice(0, count)
}

export function useRenderItems() {
  const store = useEditorStore()
  return () =>
    selectRenderItems(store.activeScheme?.items.value ?? [], store.localEditingItemIds ?? null)
}

/** Visibility changes are rendering changes, not document transactions. */
export function diffRenderItems(
  previous: ReadonlyMap<string, AppItem>,
  items: readonly AppItem[]
): Map<string, AppItem | null> {
  const next = new Map(items.map((item) => [item.internalId, item]))
  const changes = new Map<string, AppItem | null>()
  for (const [id, item] of next) {
    if (previous.get(id) !== item) {
      changes.set(id, item)
    }
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) {
      changes.set(id, null)
    }
  }
  return changes
}

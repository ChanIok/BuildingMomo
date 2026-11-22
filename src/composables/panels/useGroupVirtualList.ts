import { computed, nextTick, watch, type Ref } from 'vue'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/vue-virtual'
import type { CollectionEntry, CollectionRow } from './useCollectionPanel'

export const GROUP_ROW_HEIGHT = 32
export function groupRowKey(row: CollectionEntry) {
  return `${row.kind}:${row.id}`
}

export function useGroupVirtualList(
  rows: Ref<CollectionRow[]>,
  viewport: Ref<HTMLElement | null>,
  pinnedEntries: Ref<(CollectionEntry | null)[]>
) {
  const keys = computed<string[]>((previous) => {
    const next = rows.value.map(groupRowKey)
    return previous?.length === next.length && next.every((key, index) => key === previous[index])
      ? previous
      : next
  })
  const indexByKey = computed(() => new Map(keys.value.map((key, index) => [key, index])))
  const getItemKey = computed(() => {
    const current = keys.value
    return (index: number) => current[index]!
  })
  const virtualizer = useVirtualizer(
    computed(() => {
      const pinned = pinnedEntries.value.flatMap((entry) => {
        const index = entry ? indexByKey.value.get(groupRowKey(entry)) : undefined
        return index === undefined ? [] : [index]
      })
      return {
        count: keys.value.length,
        getScrollElement: () => viewport.value,
        getItemKey: getItemKey.value,
        estimateSize: () => GROUP_ROW_HEIGHT,
        overscan: 5,
        initialRect: { width: 280, height: 640 },
        rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) =>
          [...new Set([...defaultRangeExtractor(range), ...pinned])].sort((a, b) => a - b),
      }
    })
  )
  const virtualRows = computed(() =>
    virtualizer.value.getVirtualItems().map((item) => ({
      row: rows.value[item.index]!,
      index: item.index,
      offset: item.start,
    }))
  )
  const totalHeight = computed(() => virtualizer.value.getTotalSize())

  function scrollToEntry(entry: CollectionEntry) {
    const index = indexByKey.value.get(groupRowKey(entry))
    if (index !== undefined) virtualizer.value.scrollToIndex(index, { align: 'auto' })
  }

  function elementFor(entry: CollectionEntry) {
    return [...(viewport.value?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])].find(
      (element) => element.dataset.rowKey === groupRowKey(entry)
    )
  }

  // 上方分支高度变化时，保持首个可见行在视口中的位置。
  // 若该行因折叠消失，则使用最近的可见上级集合。
  watch(rows, async (current, previous) => {
    const element = viewport.value
    if (!element || !previous.length) return
    const oldIndex = Math.min(previous.length - 1, Math.floor(element.scrollTop / GROUP_ROW_HEIGHT))
    let anchor = previous[oldIndex]!
    const oldOffset = element.scrollTop % GROUP_ROW_HEIGHT
    const parents = new Map(
      previous.filter((row) => row.kind === 'collection').map((row) => [row.id, row])
    )
    while (!indexByKey.value.has(groupRowKey(anchor)) && anchor.parentId !== null) {
      const parent = parents.get(anchor.parentId)
      if (!parent) break
      anchor = parent
    }
    const index =
      indexByKey.value.get(groupRowKey(anchor)) ?? Math.min(oldIndex, current.length - 1)
    if (index === oldIndex) return
    await nextTick()
    if (rows.value !== current || viewport.value !== element) return
    virtualizer.value.scrollToOffset(Math.max(0, index * GROUP_ROW_HEIGHT + oldOffset))
  })

  return { virtualizer, virtualRows, totalHeight, indexByKey, scrollToEntry, elementFor }
}

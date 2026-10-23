import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, type EffectScope } from 'vue'
import { GROUP_ROW_HEIGHT, useGroupVirtualList } from '@/composables/editor/useGroupVirtualList'
import type { CollectionEntry, CollectionRow } from '@/composables/editor/useCollectionPanel'

let scope: EffectScope
beforeEach(() => {
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
})

function group(id: number, parentId: string | null = null): CollectionRow {
  return {
    kind: 'group',
    id,
    parentId,
    depth: parentId ? 1 : 0,
    group: {
      id,
      name: `Group ${id}`,
      count: 1,
      scopeCount: 1,
      selectedCount: 0,
      selectableCount: 1,
      selectedSelectableCount: 0,
      hidden: false,
      ownHidden: false,
      locked: false,
      ownLocked: false,
    },
  }
}
function folder(id: string): CollectionRow {
  return {
    kind: 'collection',
    id,
    name: id,
    parentId: null,
    depth: 0,
    count: 500,
    virtual: false,
    expanded: true,
    hidden: false,
    locked: false,
    inheritedHidden: false,
    inheritedLocked: false,
  }
}
function setup(initial = Array.from({ length: 1000 }, (_, i) => group(i + 1))) {
  const rows = shallowRef(initial)
  const viewport = shallowRef<HTMLElement | null>(null)
  const pinned = shallowRef<(CollectionEntry | null)[]>([])
  const list = scope.run(() => useGroupVirtualList(rows, viewport, pinned))!
  return { rows, viewport, pinned, ...list }
}

it('bounds rendered rows while preserving the full scroll range and current row data', async () => {
  const { rows, virtualRows, totalHeight } = setup()
  expect(virtualRows.value.length).toBeGreaterThan(0)
  expect(virtualRows.value.length).toBeLessThan(50)
  expect(totalHeight.value).toBe(1000 * GROUP_ROW_HEIGHT)
  rows.value = rows.value.map((row, index) =>
    index === 0 && row.kind === 'group'
      ? { ...row, group: { ...row.group, selectedCount: 1 } }
      : row
  )
  await nextTick()
  expect(virtualRows.value[0]!.row).toBe(rows.value[0])
})

it('keeps editing, drag, focus and menu rows mounted without mounting their neighbors', async () => {
  const { pinned, virtualRows } = setup()
  const originalCount = virtualRows.value.length
  pinned.value = [800, 900, 950, 1000].map((id) => ({ kind: 'group', id }))
  await nextTick()
  expect(virtualRows.value).toHaveLength(originalCount + 4)
  expect(virtualRows.value.slice(-4).map((entry) => entry.row.id)).toEqual([800, 900, 950, 1000])
  pinned.value = []
  await nextTick()
  expect(virtualRows.value).toHaveLength(originalCount)
})

it('scrolls to a logical row even when it has no mounted DOM element', () => {
  const { virtualizer, scrollToEntry } = setup()
  const scroll = vi.spyOn(virtualizer.value, 'scrollToIndex').mockImplementation(() => {})
  scrollToEntry({ kind: 'group', id: 1000 })
  expect(scroll).toHaveBeenCalledExactlyOnceWith(999, { align: 'auto' })
  scrollToEntry({ kind: 'group', id: 1001 })
  expect(scroll).toHaveBeenCalledTimes(1)
})

it('anchors a folded-away row to its collection and ignores obsolete queued adjustments', async () => {
  const initial = [
    folder('first'),
    ...Array.from({ length: 500 }, (_, i) => group(i + 1, 'first')),
    folder('last'),
  ]
  const { rows, viewport, virtualizer, virtualRows, totalHeight } = setup(initial)
  viewport.value = {
    scrollTop: 50 * GROUP_ROW_HEIGHT + 3,
    scrollTo: vi.fn(),
  } as unknown as HTMLElement
  await nextTick()
  const scroll = vi.spyOn(virtualizer.value, 'scrollToOffset').mockImplementation(() => {})
  rows.value = [initial[0]!, initial.at(-1)!]
  await nextTick()
  await nextTick()
  expect(scroll).toHaveBeenCalledWith(3)
  expect(totalHeight.value).toBe(2 * GROUP_ROW_HEIGHT)
  expect(virtualRows.value.length).toBeLessThanOrEqual(2)
  // 再次展开前，将偏移量恢复为实际滚动后的位置。
  viewport.value.scrollTop = 3
  rows.value = initial
  await nextTick()
  await nextTick()
  viewport.value.scrollTop = 50 * GROUP_ROW_HEIGHT + 3
  scroll.mockClear()
  rows.value = [initial[0]!, initial.at(-1)!]
  await nextTick()
  // 在待执行的滚动锚点调整恢复前替换列表行。
  rows.value = initial
  await nextTick()
  await nextTick()
  // 替换后以最后一个集合为锚点，不再执行已过期的 3 px 偏移调整。
  expect(scroll).toHaveBeenCalledExactlyOnceWith((initial.length - 1) * GROUP_ROW_HEIGHT + 3)
  rows.value = []
  await nextTick()
  await nextTick()
  expect(totalHeight.value).toBe(0)
  expect(virtualRows.value).toEqual([])
})

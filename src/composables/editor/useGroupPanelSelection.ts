import { sameSelectionEntries } from '@/lib/selectionReference'
import { computed, shallowRef, watch, type Ref } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorSelection } from './useEditorSelection'
import type { CollectionEntry, CollectionRow } from './useCollectionPanel'
import { UNCLASSIFIED } from '@/lib/collectionTree'
import type { PanelGroup } from './useGroupPanel'
import { groupRowKey } from './useGroupVirtualList'

export type GroupSelectionState = 'none' | 'partial' | 'full'
type Modifiers = Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
const selectionOptions = { skipGroupExpansion: true, ignoreSelectionFilter: true }

export function useGroupPanelSelection(
  rows: Ref<CollectionRow[]>,
  groups: Ref<PanelGroup[]>,
  groupsForEntry: (entry: CollectionEntry) => readonly number[],
  query: Ref<string>
) {
  const store = useEditorStore()
  const { updateSelection, resolveSelectionTargets, clearSelection } = useEditorSelection()
  const anchor = shallowRef<CollectionEntry | null>(null)
  const indices = computed(() => new Map(rows.value.map((row, index) => [groupRowKey(row), index])))
  // 目录选择只记录节点，不另存一份家具选择。
  // null 表示跟随画布选择；显式选择的节点可包含空集合。
  const explicit = computed({
    get: () => {
      const entries = store.activeScheme?.selectedEntries.value
      return entries == null ? null : new Map(entries.map((entry) => [groupRowKey(entry), entry]))
    },
    set: (value: Map<string, CollectionEntry> | null) => {
      if (store.activeScheme)
        store.activeScheme.selectedEntries.value = value === null ? null : [...value.values()]
    },
  })
  let range: { additive: boolean; nodes: Map<string, CollectionEntry>; items: Set<string> } | null =
    null
  let applying = false
  const entries = computed<CollectionEntry[]>(() => {
    if (explicit.value === null) {
      const entries: CollectionEntry[] = groups.value
        .filter((group) => group.count > 0 && group.selectedCount === group.count)
        .map((group) => ({ kind: 'group', id: group.id }))
      const selected = store.activeScheme?.selectedItemIds.value
      if (
        store.ungroupedItemIds.size &&
        [...store.ungroupedItemIds].every((id) => selected?.has(id))
      )
        entries.push({ kind: 'ungrouped', id: 0 })
      return entries
    }
    const folders = new Set(store.activeScheme?.collectionTree.value.nodes.map((node) => node.id))
    return [...explicit.value.values()].filter((entry) =>
      entry.kind === 'ungrouped'
        ? store.ungroupedItemIds.size > 0
        : entry.kind === 'group'
          ? store.groupsMap.has(entry.id)
          : folders.has(entry.id) || (entry.id === UNCLASSIFIED && groupsForEntry(entry).length > 0)
    )
  })
  const selectedKeys = computed(() => new Set(entries.value.map(groupRowKey)))
  function isSelected(entry: CollectionEntry) {
    return selectedKeys.value.has(groupRowKey(entry))
  }
  function reset() {
    anchor.value = null
    range = null
  }
  function followCanvas() {
    explicit.value = null
    reset()
  }
  function clear() {
    // 显式节点也是可撤销的选择；已经跟随空画布时不新增历史。
    if (store.activeScheme?.selectedItemIds.value.size || explicit.value !== null) clearSelection()
    reset()
  }
  /** 粘贴已在事务中更新家具选区；这里只接管节点，不另记一次选择历史。 */
  function adopt(entries: readonly CollectionEntry[]) {
    followCanvas()
    explicit.value = new Map(entries.map((entry) => [groupRowKey(entry), entry]))
  }
  function targetsFor(nodes: Iterable<CollectionEntry>) {
    const items = new Set<string>()
    for (const entry of nodes) {
      const members =
        entry.kind === 'ungrouped'
          ? store.ungroupedItemIds
          : groupsForEntry(entry).flatMap((id) => [...(store.groupsMap.get(id) ?? [])])
      for (const id of members) items.add(id)
    }
    return resolveSelectionTargets([...items], selectionOptions)
  }

  // 家具选中情况始终根据实际画布选择计算。
  const coverage = computed(() => {
    const byGroup = new Map(groups.value.map((group) => [group.id, group]))
    const result = new Map<string, { selected: number; total: number }>()
    for (const row of rows.value) {
      if (row.kind === 'ungrouped') {
        result.set(groupRowKey(row), {
          selected: row.group.selectedSelectableCount,
          total: row.group.selectableCount,
        })
        continue
      }
      let total = 0,
        selected = 0
      for (const id of groupsForEntry(row)) {
        const group = byGroup.get(id)
        total += group?.selectableCount ?? 0
        selected += group?.selectedSelectableCount ?? 0
      }
      result.set(groupRowKey(row), { selected, total })
    }
    return result
  })
  function selectionCoverage(entry: CollectionEntry) {
    return coverage.value.get(groupRowKey(entry)) ?? { selected: 0, total: 0 }
  }
  function selectionState(entry: CollectionEntry): GroupSelectionState {
    const { selected, total } = selectionCoverage(entry)
    return selected === 0 ? 'none' : selected === total ? 'full' : 'partial'
  }

  function deselect(entry: CollectionEntry) {
    if (isSelected(entry)) select(entry, { ctrlKey: true, metaKey: false, shiftKey: false })
  }

  // 删除节点后不应残留不可见的目录选择目标；已有家具选择
  // 仍可映射到从已删除集合中移出的组。
  watch(
    entries,
    (current) => {
      if (explicit.value && current.length !== explicit.value.size) followCanvas()
    },
    { flush: 'sync' }
  )

  function select(entry: CollectionEntry, event: Modifiers, fallbackAnchor?: CollectionEntry) {
    const scheme = store.activeScheme
    if (!scheme) return
    const index = indices.value.get(groupRowKey(entry))
    if (index === undefined) return
    const additive = !!(event.ctrlKey || event.metaKey)
    if (event.shiftKey && !anchor.value && fallbackAnchor) anchor.value = fallbackAnchor
    const start = anchor.value ? indices.value.get(groupRowKey(anchor.value)) : undefined
    const extending = !!event.shiftKey && start !== undefined
    const gesture = extending
      ? rows.value.slice(Math.min(start, index), Math.max(start, index) + 1)
      : [entry]
    const current = scheme.selectedItemIds.value
    const baseline = new Map(entries.value.map((node) => [groupRowKey(node), node]))
    const represented = targetsFor(entries.value)
    const remaining = new Set([...current].filter((id) => !represented.has(id)))
    let nextNodes: Map<string, CollectionEntry>, nextCarried: Set<string>
    if (extending) {
      if (!range || range.additive !== additive)
        range = {
          additive,
          nodes: additive ? baseline : new Map(),
          items: additive ? new Set(remaining) : new Set(),
        }
      nextNodes = new Map(range.nodes)
      nextCarried = new Set(range.items)
      for (const row of gesture)
        nextNodes.set(groupRowKey(row), { kind: row.kind, id: row.id } as CollectionEntry)
    } else {
      anchor.value = { kind: entry.kind, id: entry.id } as CollectionEntry
      range = null
      nextNodes = additive ? baseline : new Map()
      nextCarried = additive ? new Set(remaining) : new Set()
      const key = groupRowKey(entry)
      if (additive && nextNodes.has(key)) nextNodes.delete(key)
      else nextNodes.set(key, { kind: entry.kind, id: entry.id } as CollectionEntry)
    }
    const targets = targetsFor(nextNodes.values())
    // 补全组选中状态时，同时将仅在画布中选中的成员纳入节点选择，
    // 以便之后取消节点选择时能完整移除该组。
    for (const id of targets) nextCarried.delete(id)
    const next = new Set([...nextCarried, ...targets])
    const nextEntries = [...nextNodes.values()]
    if (
      next.size === current.size &&
      [...next].every((id) => current.has(id)) &&
      sameSelectionEntries(scheme.selectedEntries.value, nextEntries)
    )
      return
    applying = true
    try {
      updateSelection([...next], false, { ...selectionOptions, entries: nextEntries })
    } finally {
      applying = false
    }
  }

  watch(
    () => store.activeScheme?.selectedEntries.value,
    () => {
      if (!applying) reset()
    },
    { flush: 'sync' }
  )
  watch(() => store.activeSchemeId, reset, { flush: 'sync' })

  watch(query, reset, { flush: 'sync' })
  watch(
    () => rows.value.map(groupRowKey),
    (current, previous) => {
      if (
        current.length === previous.length &&
        current.every((key, index) => key === previous[index])
      )
        return
      range = null
      if (anchor.value && !indices.value.has(groupRowKey(anchor.value))) anchor.value = null
    },
    { flush: 'sync' }
  )

  return {
    select,
    deselect,
    clear,
    adopt,
    selectionState,
    selectionCoverage,
    isSelected,
    entries,
    reset,
    anchor,
  }
}

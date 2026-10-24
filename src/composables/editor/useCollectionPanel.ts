import { computed, type Ref } from 'vue'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import { useGroupPanel } from './useGroupPanel'
import { useI18n } from '@/composables/useI18n'
import type { CollectionEntry } from '@/types/editor'
import { resolveCollectionEntries } from '@/lib/collectionTargets'
import { reconcileGroupOrigins, setSchemeItems } from '@/lib/groupState'
import {
  collectionAncestors,
  collectionTreesEqual,
  isCollectionTree,
  UNCLASSIFIED,
  type CollectionTree,
} from '@/lib/collectionTree'

export type { CollectionEntry } from '@/types/editor'
type Group = ReturnType<typeof useGroupPanel>['groups']['value'][number]
type FurnitureRow = { group: Group; depth: number; parentId: string | null }
export type CollectionRow =
  | {
      kind: 'collection'
      id: string
      name: string
      depth: number
      parentId: string | null
      count: number
      virtual: boolean
      expanded: boolean
      hidden: boolean
      locked: boolean
      inheritedHidden: boolean
      inheritedLocked: boolean
      hiddenBy?: string
      lockedBy?: string
    }
  | ({ kind: 'group'; id: number } & FurnitureRow)
  | ({ kind: 'ungrouped'; id: number } & FurnitureRow)

export function useCollectionPanel(
  query: Ref<string>,
  panel: Pick<ReturnType<typeof useGroupPanel>, 'groups' | 'ungrouped'> = useGroupPanel()
) {
  const { groups, ungrouped } = panel
  const store = useEditorStore()
  const cloud = useCloudSchemeStore()
  const { recordTransaction } = useEditorHistory()
  const { t } = useI18n()
  const tree = computed(() => store.activeScheme!.collectionTree.value)
  const canEdit = computed(
    () =>
      !!store.activeScheme &&
      (store.activeScheme.source.value !== 'cloud' ||
        (store.activeScheme.collectionsSupported.value &&
          cloud.isConnected &&
          cloud.schemeId === store.activeScheme.id))
  )
  const assignments = computed(
    () => new Map(tree.value.groups.map((entry) => [entry.groupId, entry]))
  )
  const nodes = computed(() => new Map(tree.value.nodes.map((node) => [node.id, node])))
  const paths = computed(
    () =>
      new Map(tree.value.nodes.map((node) => [node.id, collectionAncestors(nodes.value, node.id)]))
  )
  const destinations = computed(() =>
    tree.value.nodes
      .map((node) => ({
        id: node.id,
        name: [...(paths.value.get(node.id) ?? [])]
          .reverse()
          .map((id) => nodes.value.get(id)!.name)
          .join(' / '),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  function restriction(id: string | null, kind: 'hidden' | 'locked', includeSelf = true) {
    const scheme = store.activeScheme!
    const flags =
      kind === 'hidden' ? scheme.hiddenCollectionIds.value : scheme.lockedCollectionIds.value
    if (id === null || id === UNCLASSIFIED)
      return includeSelf && flags.has(UNCLASSIFIED) ? t('groups.unclassified') : undefined
    const path = id === null ? [] : (paths.value.get(id) ?? [])
    const by = (includeSelf ? path : path.slice(1)).find((ancestor) => flags.has(ancestor))
    return by ? nodes.value.get(by)?.name : undefined
  }

  // 这些索引不依赖展开状态，折叠时无需重新排序成员或统计目录，
  // 选择变化时也保留原 ID 列表。
  const groupIds = computed<number[]>((previous) => {
    const ids = groups.value.map((group) => group.id)
    return previous?.length === ids.length && ids.every((id, index) => id === previous[index])
      ? previous
      : ids
  })
  const groupsById = computed(() => new Map(groups.value.map((group) => [group.id, group])))
  const structure = computed(() => {
    const children = new Map<string | null, typeof tree.value.nodes>()
    for (const node of tree.value.nodes) {
      if (!children.has(node.parentId)) children.set(node.parentId, [])
      children.get(node.parentId)!.push(node)
    }
    for (const list of children.values())
      list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    const grouped = new Map<string | null, number[]>()
    const counts = new Map<string, number>()
    const collectionGroups = new Map<string, number[]>()
    for (const id of groupIds.value) {
      const parent = assignments.value.get(id)?.collectionId ?? null
      if (!grouped.has(parent)) grouped.set(parent, [])
      grouped.get(parent)!.push(id)
      for (const ancestor of parent ? (paths.value.get(parent) ?? []) : [UNCLASSIFIED]) {
        counts.set(ancestor, (counts.get(ancestor) ?? 0) + 1)
        if (!collectionGroups.has(ancestor)) collectionGroups.set(ancestor, [])
        collectionGroups.get(ancestor)!.push(id)
      }
    }
    for (const list of grouped.values())
      list.sort(
        (a, b) =>
          (assignments.value.get(a)?.order ?? a) - (assignments.value.get(b)?.order ?? b) || a - b
      )
    return { children, grouped, counts, collectionGroups }
  })
  const search = computed(() => {
    const text = query.value.trim().toLocaleLowerCase()
    if (!text) return null
    const matchedFolders = new Set(
      tree.value.nodes
        .filter((node) => node.name.toLocaleLowerCase().includes(text))
        .map((node) => node.id)
    )
    const visibleFolders = new Set<string>()
    const visibleGroups = new Set(
      groups.value
        .filter((group) => {
          const parent = assignments.value.get(group.id)?.collectionId ?? null
          const path = parent ? (paths.value.get(parent) ?? []) : []
          const match =
            group.name.toLocaleLowerCase().includes(text) ||
            path.some((id) => matchedFolders.has(id))
          if (match) for (const id of path) visibleFolders.add(id)
          return match
        })
        .map((group) => group.id)
    )
    for (const id of matchedFolders)
      for (const ancestor of paths.value.get(id) ?? []) visibleFolders.add(ancestor)
    for (const path of paths.value.values()) {
      if (path.some((id) => matchedFolders.has(id))) for (const id of path) visibleFolders.add(id)
    }
    return { visibleGroups, visibleFolders }
  })

  const rows = computed<CollectionRow[]>((previous) => {
    if (!store.activeScheme) return []
    const { children, grouped, counts } = structure.value
    const filter = search.value
    const oldRows = new Map(previous?.map((row) => [`${row.kind}:${row.id}`, row]))
    const result: CollectionRow[] = []
    function add(row: CollectionRow) {
      const old = oldRows.get(`${row.kind}:${row.id}`)
      result.push(
        old && Object.keys(row).every((key) => Reflect.get(row, key) === Reflect.get(old, key))
          ? old
          : row
      )
    }
    function addGroups(parentId: string | null, depth: number) {
      for (const id of grouped.get(parentId) ?? []) {
        if (filter && !filter.visibleGroups.has(id)) continue
        add({ kind: 'group', id, group: groupsById.value.get(id)!, depth, parentId })
      }
    }
    function addFolders(parentId: string | null, depth: number) {
      for (const node of children.get(parentId) ?? []) {
        if (filter && !filter.visibleFolders.has(node.id)) continue
        const expanded = !!filter || !store.activeScheme!.collapsedCollectionIds.value.has(node.id)
        const hiddenBy = restriction(node.id, 'hidden', false),
          lockedBy = restriction(node.id, 'locked', false)
        add({
          kind: 'collection',
          id: node.id,
          name: node.name,
          parentId,
          depth,
          count: counts.get(node.id) ?? 0,
          virtual: false,
          expanded,
          hidden: store.activeScheme!.hiddenCollectionIds.value.has(node.id),
          locked: store.activeScheme!.lockedCollectionIds.value.has(node.id),
          inheritedHidden: !!hiddenBy,
          inheritedLocked: !!lockedBy,
          hiddenBy,
          lockedBy,
        })
        if (expanded) {
          addFolders(node.id, depth + 1)
          addGroups(node.id, depth + 1)
        }
      }
    }
    addFolders(null, 0)
    const unclassified = (grouped.get(null) ?? []).filter(
      (id) => !filter || filter.visibleGroups.has(id)
    )
    if (unclassified.length) {
      // 创建首个集合前保持简单的平铺列表。
      if (
        !tree.value.nodes.length &&
        !store.activeScheme.hiddenCollectionIds.value.has(UNCLASSIFIED) &&
        !store.activeScheme.lockedCollectionIds.value.has(UNCLASSIFIED)
      )
        addGroups(null, 0)
      else {
        const expanded =
          !!filter || !store.activeScheme.collapsedCollectionIds.value.has(UNCLASSIFIED)
        add({
          kind: 'collection',
          id: UNCLASSIFIED,
          name: t('groups.unclassified'),
          depth: 0,
          parentId: null,
          count: unclassified.length,
          virtual: true,
          expanded,
          hidden: store.activeScheme.hiddenCollectionIds.value.has(UNCLASSIFIED),
          locked: store.activeScheme.lockedCollectionIds.value.has(UNCLASSIFIED),
          inheritedHidden: false,
          inheritedLocked: false,
        })
        if (expanded) addGroups(null, 1)
      }
    }
    const loose = ungrouped.value
    if (
      loose &&
      (!query.value.trim() ||
        loose.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
    ) {
      add({ kind: 'ungrouped', id: 0, group: loose, depth: 0, parentId: null })
    }
    return previous?.length === result.length &&
      result.every((row, index) => row === previous[index])
      ? previous
      : result
  })

  function commit(intent: string, next: CollectionTree) {
    if (!canEdit.value || !isCollectionTree(next)) return false
    recordTransaction(intent, () => {
      store.activeScheme!.collectionTree.value = next
      if (store.constrainSelectionToEditable()) store.triggerSelectionUpdate()
    })
    return true
  }

  function createCollection(parentId: string | null = null) {
    if (!canEdit.value || (parentId !== null && !nodes.value.has(parentId))) return null
    const id = crypto.randomUUID()
    const order =
      Math.max(
        -1,
        ...tree.value.nodes.filter((node) => node.parentId === parentId).map((node) => node.order)
      ) + 1
    if (
      !commit('collection.create', {
        ...tree.value,
        nodes: [...tree.value.nodes, { id, name: t('groups.newCollection'), parentId, order }],
      })
    )
      return null
    revealCollection(id)
    activateCollection(id)
    return id
  }

  function renameCollection(id: string, name: string) {
    name = name.trim().slice(0, 200)
    if (!name || !nodes.value.has(id) || nodes.value.get(id)!.name === name) return
    commit('collection.rename', {
      ...tree.value,
      nodes: tree.value.nodes.map((node) => (node.id === id ? { ...node, name } : node)),
    })
  }

  function deleteCollection(id: string) {
    const node = nodes.value.get(id)
    if (!node) return
    commit('collection.delete', {
      nodes: tree.value.nodes
        .filter((entry) => entry.id !== id)
        .map((entry) => (entry.parentId === id ? { ...entry, parentId: node.parentId } : entry)),
      groups: tree.value.groups.map((entry) =>
        entry.collectionId === id ? { ...entry, collectionId: node.parentId } : entry
      ),
    })
  }

  function deleteTarget(entries: readonly CollectionEntry[]) {
    const scheme = store.activeScheme
    if (
      !scheme ||
      !canEdit.value ||
      entries.some((entry) =>
        entry.kind === 'group'
          ? !store.groupsMap.has(entry.id)
          : entry.kind === 'collection' && entry.id !== UNCLASSIFIED && !nodes.value.has(entry.id)
      )
    )
      return null
    const target = resolveCollectionEntries(scheme, entries)
    return target.items.length || target.collectionIds.size ? target : null
  }

  function canDeleteEntries(entries: readonly CollectionEntry[]) {
    return !!deleteTarget(entries)
  }

  /** 删除节点及全部内容，与仅移除集合外壳的 deleteCollection 分开。 */
  function deleteEntries(entries: readonly CollectionEntry[]) {
    const scheme = store.activeScheme
    const target = deleteTarget(entries)
    if (!scheme || !target) return false
    const removed = new Set(target.items.map((item) => item.internalId))
    recordTransaction('collection.delete_contents', () => {
      if (removed.size) {
        setSchemeItems(
          scheme,
          scheme.items.value.filter((item) => !removed.has(item.internalId))
        )
        scheme.groupOrigins.value = reconcileGroupOrigins(
          scheme.groupOrigins.value,
          scheme.items.value
        )
      }
      if (target.collectionIds.size) {
        scheme.collectionTree.value = {
          nodes: tree.value.nodes.filter((node) => !target.collectionIds.has(node.id)),
          groups: tree.value.groups.filter(
            (group) => !target.collectionIds.has(group.collectionId ?? '')
          ),
        }
      }
      if (
        scheme.activeCollectionId.value &&
        (target.collectionIds.has(scheme.activeCollectionId.value) ||
          (scheme.activeCollectionId.value === UNCLASSIFIED &&
            entries.some((entry) => entry.kind === 'collection' && entry.id === UNCLASSIFIED)))
      )
        scheme.activeCollectionId.value = null
      // 只移除已删除家具的选择；画布上额外选中的家具不属于面板删除范围。
      scheme.selectedItemIds.value = new Set(
        [...scheme.selectedItemIds.value].filter((id) => !removed.has(id))
      )
      if (removed.size) store.triggerSceneUpdate()
      store.triggerSelectionUpdate()
    })
    return true
  }

  function canMove(entry: CollectionEntry, parentId: string | null) {
    if (entry.kind === 'ungrouped') return false
    if (!canEdit.value || (parentId !== null && !nodes.value.has(parentId))) return false
    return entry.kind !== 'collection'
      ? store.groupsMap.has(entry.id)
      : nodes.value.has(entry.id) &&
          (parentId === null || !(paths.value.get(parentId) ?? []).includes(entry.id))
  }

  function normalizeEntries(entries: readonly CollectionEntry[]) {
    const unique = new Map(
      entries
        .flatMap((entry) =>
          entry.kind === 'collection' && entry.id === UNCLASSIFIED
            ? groupsForEntry(entry).map((id) => ({ kind: 'group', id }) as CollectionEntry)
            : [entry]
        )
        .map((entry) => [`${entry.kind}:${entry.id}`, entry])
    )
    const folders = new Set(
      [...unique.values()].filter((entry) => entry.kind === 'collection').map((entry) => entry.id)
    )
    return [...unique.values()].filter((entry) => {
      const parent =
        entry.kind !== 'collection'
          ? assignments.value.get(entry.id)?.collectionId
          : nodes.value.get(entry.id)?.parentId
      return !(parent ? (paths.value.get(parent) ?? []) : []).some((id) => folders.has(id))
    })
  }

  function canMoveMany(entries: readonly CollectionEntry[], parentId: string | null) {
    const roots = normalizeEntries(entries)
    return roots.length > 0 && roots.every((entry) => canMove(entry, parentId))
  }

  function moveMany(
    entries: readonly CollectionEntry[],
    parentId: string | null,
    siblingId?: string | number,
    after = false
  ) {
    const roots = normalizeEntries(entries)
    if (!roots.length || !roots.every((entry) => canMove(entry, parentId))) return false
    // 按完整目录树排序，不受点击顺序、搜索结果或已挂载行影响。
    const rank = new Map<string, number>()
    function visit(parent: string | null) {
      for (const node of structure.value.children.get(parent) ?? []) {
        rank.set(`collection:${node.id}`, rank.size)
        visit(node.id)
      }
      for (const id of structure.value.grouped.get(parent) ?? []) rank.set(`group:${id}`, rank.size)
    }
    visit(null)
    roots.sort((a, b) => rank.get(`${a.kind}:${a.id}`)! - rank.get(`${b.kind}:${b.id}`)!)
    const folderIds = roots.filter((entry) => entry.kind === 'collection').map((entry) => entry.id)
    const groupIds = roots.filter((entry) => entry.kind === 'group').map((entry) => entry.id)
    let next = tree.value
    if (folderIds.length) {
      const moving = new Set(folderIds)
      const siblings = (structure.value.children.get(parentId) ?? []).filter(
        (node) => !moving.has(node.id)
      )
      const index = siblings.findIndex((node) => node.id === siblingId)
      siblings.splice(
        index < 0 ? siblings.length : index + Number(after),
        0,
        ...folderIds.map((id) => ({ ...nodes.value.get(id)!, parentId }))
      )
      const updates = new Map(siblings.map((node, order) => [node.id, { ...node, order }]))
      next = { ...next, nodes: next.nodes.map((node) => updates.get(node.id) ?? node) }
    }
    if (groupIds.length) {
      const moving = new Set(groupIds)
      const ids = (structure.value.grouped.get(parentId) ?? []).filter((id) => !moving.has(id))
      const index = ids.findIndex((id) => id === siblingId)
      ids.splice(index < 0 ? ids.length : index + Number(after), 0, ...groupIds)
      const updates = new Map(
        ids.map((groupId, order) => [
          groupId,
          { ...assignments.value.get(groupId), groupId, collectionId: parentId, order },
        ])
      )
      next = {
        ...next,
        groups: [
          ...next.groups.filter((group) => !updates.has(group.groupId)),
          ...updates.values(),
        ],
      }
    }
    if (
      collectionTreesEqual(tree.value, next) ||
      !commit(folderIds.length ? 'collection.move' : 'collection.moveGroup', next)
    )
      return false
    revealCollection(parentId)
    return true
  }

  function move(
    entry: CollectionEntry,
    parentId: string | null,
    siblingId?: string | number,
    after = false
  ) {
    return moveMany([entry], parentId, siblingId, after)
  }

  function activateCollection(id: string) {
    const scheme = store.activeScheme!
    scheme.activeCollectionId.value = id
    scheme.activeGroupId.value = null
  }

  // 完整成员范围不受搜索、展开状态或当前挂载区间影响。
  function groupsForEntry(entry: CollectionEntry): readonly number[] {
    return entry.kind === 'group'
      ? [entry.id]
      : entry.kind === 'ungrouped'
        ? []
        : (structure.value.collectionGroups.get(entry.id) ?? [])
  }

  function toggleCollection(id: string) {
    const scheme = store.activeScheme!
    activateCollection(id)
    if (query.value.trim()) return
    const ids = new Set(scheme.collapsedCollectionIds.value)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    scheme.collapsedCollectionIds.value = ids
  }

  function revealCollection(id: string | null) {
    const scheme = store.activeScheme!
    const ids = new Set(scheme.collapsedCollectionIds.value)
    for (const ancestor of id === null ? [UNCLASSIFIED] : (paths.value.get(id) ?? []))
      ids.delete(ancestor)
    if (ids.size !== scheme.collapsedCollectionIds.value.size)
      scheme.collapsedCollectionIds.value = ids
  }

  function collapseAll() {
    query.value = ''
    store.activeScheme!.collapsedCollectionIds.value = new Set([
      ...tree.value.nodes.map((node) => node.id),
      UNCLASSIFIED,
    ])
  }

  return {
    rows,
    destinations,
    canEdit,
    createCollection,
    renameCollection,
    deleteCollection,
    canDeleteEntries,
    deleteEntries,
    canMove,
    move,
    canMoveMany,
    moveMany,
    normalizeEntries,
    activateCollection,
    toggleCollection,
    revealCollection,
    collapseAll,
    restriction,
    groupsForEntry,
  }
}

import { groupNameEntries } from '@/lib/collectionTree'
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorGroups } from './useEditorGroups'
import { useI18n } from '@/composables/useI18n'

export interface PanelGroup {
  id: number
  name: string
  count: number
  selectedCount: number
  selectableCount: number
  selectedSelectableCount: number
  hidden: boolean
  ownHidden: boolean
  locked: boolean
  ownLocked: boolean
}

export function useGroupPanel() {
  const store = useEditorStore()
  const { renameGroup, canRenameGroup } = useEditorGroups()
  const { t } = useI18n()

  const names = computed(
    () =>
      new Map(store.activeScheme ? groupNameEntries(store.activeScheme.collectionTree.value) : [])
  )
  function summarize(
    id: number,
    members: ReadonlySet<string>,
    name: string,
    old?: PanelGroup
  ): PanelGroup {
    const scheme = store.activeScheme!
    let selectedCount = 0,
      selectableCount = 0,
      selectedSelectableCount = 0
    for (const member of members) {
      if (scheme.selectedItemIds.value.has(member)) selectedCount++
      if (store.isItemEditable(member)) {
        selectableCount++
        if (scheme.selectedItemIds.value.has(member)) selectedSelectableCount++
      }
    }
    const group = {
      id,
      name,
      count: members.size,
      selectedCount,
      selectableCount,
      selectedSelectableCount,
      hidden: store.effectiveHiddenGroupIds.has(id),
      ownHidden: scheme.hiddenGroupIds.value.has(id),
      locked: store.effectiveLockedGroupIds.has(id),
      ownLocked: scheme.lockedGroupIds.value.has(id),
    }
    return old &&
      Object.keys(group).every(
        (key) => group[key as keyof PanelGroup] === old[key as keyof PanelGroup]
      )
      ? old
      : group
  }
  const groups = computed<PanelGroup[]>((previous) => {
    if (!store.activeScheme) return []
    const previousById = new Map(previous?.map((group) => [group.id, group]))
    const next = [...store.groupsMap]
      .sort(([a], [b]) => a - b)
      .map(([id, members]) =>
        summarize(
          id,
          members,
          names.value.get(id) ?? t('groups.defaultName', { id }),
          previousById.get(id)
        )
      )
    return previous?.length === next.length &&
      next.every((group, index) => group === previous[index])
      ? previous
      : next
  })
  const ungrouped = computed<PanelGroup | null>((previous) =>
    store.activeScheme && store.ungroupedItemIds.size
      ? summarize(0, store.ungroupedItemIds, t('groups.ungrouped'), previous ?? undefined)
      : null
  )

  return { groups, ungrouped, renameGroup, canRenameGroup }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { setSchemeItems } from '@/lib/groupState'
import { UNCLASSIFIED } from '@/lib/collectionTree'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { useGroupPanel } from '@/composables/editor/useGroupPanel'
import { useCollectionPanel } from '@/composables/editor/useCollectionPanel'
import { useGroupPanelSelection } from '@/composables/editor/useGroupPanelSelection'
import { useClipboard } from '@/composables/useClipboard'
import { createEmptyClipboardData } from '@/lib/clipboardStructure'
import { useValidationStore } from '@/stores/validationStore'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import { makeAppItem, groupNamesOf } from '../fixtures/item'
import {
  applyEditorTransactionToScheme,
  collectTransactionTouchedGroupIds,
  collectTransactionTouchedItemIds,
} from '@/lib/editorTransactions'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let scope: EffectScope
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

function setup() {
  const store = useEditorStore()
  store.createScheme('groups')
  const scheme = store.activeScheme!
  scheme.items.value = [
    makeAppItem({ internalId: 'a', groupId: 7, instanceId: 1001 }),
    makeAppItem({ internalId: 'b', groupId: 7, instanceId: 1002 }),
    makeAppItem({ internalId: 'c', groupId: 8, instanceId: 1003 }),
    makeAppItem({ internalId: 'd', groupId: 0, instanceId: 1004 }),
  ]
  scheme.maxGroupId.value = 8
  scheme.maxInstanceId.value = 1004
  store.triggerSceneUpdate()
  return scope.run(() => {
    const panel = useGroupPanel(),
      query = ref('')
    const directory = useCollectionPanel(query, panel)
    const selection = useGroupPanelSelection(
      directory.rows,
      panel.groups,
      directory.groupsForEntry,
      query
    )
    const selectGroup = (id: number) =>
      selection.select({ kind: 'group', id }, { ctrlKey: false, metaKey: false, shiftKey: false })
    return { store, scheme, panel, selectGroup, selection, history: useEditorHistory() }
  })!
}

describe('group management', () => {
  it('selects complete groups explicitly, ignoring category filters but respecting protection', () => {
    const { store, scheme, panel, selectGroup } = setup()
    store.selectionCategoryIds = new Set()
    selectGroup(7)
    expect([...scheme.selectedItemIds.value]).toEqual(['a', 'b'])
    expect(panel.groups.value.find((group) => group.id === 7)).toMatchObject({
      count: 2,
      selectedCount: 2,
    })
    store.setGroupLocked(7, true)
    selectGroup(7)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(panel.canRenameGroup(7)).toBe(true)
    panel.renameGroup(7, 'locked group')
    expect(groupNamesOf(scheme).get(7)).toBe('locked group')
  })

  it('renames with undo/redo and keeps unrelated item references', () => {
    const { store, scheme, panel, history } = setup()
    const before = scheme.items.value
    const version = store.sceneVersion
    panel.renameGroup(7, '  二楼的墙  ')
    expect(groupNamesOf(scheme).get(7)).toBe('二楼的墙')
    expect(scheme.items.value).toBe(before)
    history.undo()
    expect(groupNamesOf(scheme).has(7)).toBe(false)
    history.redo()
    expect(groupNamesOf(scheme).get(7)).toBe('二楼的墙')
    expect(scheme.items.value[0]).toBe(before[0])
    panel.renameGroup(7, ' ')
    expect(groupNamesOf(scheme).has(7)).toBe(false)
    expect(store.sceneVersion).toBe(version)
    expect(store.getRenderChanges(scheme.id, version)?.size).toBe(0)
  })

  it('cleans names in the same deletion/ungroup transaction and restores them on undo', () => {
    const { scheme, panel, history, selectGroup } = setup()
    panel.renameGroup(7, '墙')
    selectGroup(7)
    useEditorGroups().ungroupSelected()
    expect(groupNamesOf(scheme).has(7)).toBe(false)
    history.undo()
    expect(groupNamesOf(scheme).get(7)).toBe('墙')
    useEditorManipulation().deleteSelected()
    expect(groupNamesOf(scheme).has(7)).toBe(false)
    history.undo()
    expect(groupNamesOf(scheme).get(7)).toBe('墙')
  })

  it('merges the selection into the single group it touches and keeps that identity', () => {
    const { scheme, history } = setup()
    scheme.collectionTree.value = {
      nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
      groups: [{ groupId: 7, name: 'Walls', collectionId: 'house', order: 0 }],
    }
    scheme.groupOrigins.value = new Map([[7, 'a']])
    scheme.activeGroupId.value = 7
    const maxGroupId = scheme.maxGroupId.value
    scheme.selectedItemIds.value = new Set(['a', 'b', 'd'])
    const groups = useEditorGroups()
    expect(groups.resolveGroupRequest()).toEqual({ kind: 'merge', targetId: 7 })
    expect(groups.requestGroup()).toBe(true)
    expect(scheme.items.value.map((item) => [item.internalId, item.groupId])).toEqual([
      ['a', 7],
      ['b', 7],
      ['c', 8],
      ['d', 7],
    ])
    expect(scheme.collectionTree.value.groups).toEqual([
      { groupId: 7, name: 'Walls', collectionId: 'house', order: 0 },
    ])
    expect(scheme.groupOrigins.value.get(7)).toBe('a')
    expect(scheme.maxGroupId.value).toBe(maxGroupId)
    expect(scheme.activeGroupId.value).toBe(7)
    history.undo()
    expect(scheme.items.value.find((item) => item.internalId === 'd')!.groupId).toBe(0)
    expect(scheme.collectionTree.value.groups).toEqual([
      { groupId: 7, name: 'Walls', collectionId: 'house', order: 0 },
    ])
    history.redo()
    expect(scheme.items.value.find((item) => item.internalId === 'd')!.groupId).toBe(7)
  })

  it('asks for a target when the selection spans several groups and keeps only the chosen identity', () => {
    const { scheme, history } = setup()
    scheme.collectionTree.value = {
      nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
      groups: [
        { groupId: 8, name: 'Roof', collectionId: 'house', order: 1 },
        { groupId: 7, name: 'Walls', collectionId: 'house', order: 0 },
      ],
    }
    scheme.selectedItemIds.value = new Set(['a', 'b', 'c'])
    const groups = useEditorGroups()
    const ui = useUIStore()
    expect(groups.resolveGroupRequest()).toEqual({ kind: 'choose', candidates: [7, 8] })
    expect(groups.requestGroup()).toBe(false)
    expect(ui.groupMergeOpen).toBe(true)
    expect(ui.groupMergeCandidates).toEqual([7, 8])
    expect(groups.groupInto(8)).toBe(true)
    expect(scheme.items.value.map((item) => item.groupId)).toEqual([8, 8, 8, 0])
    expect(scheme.collectionTree.value.groups).toEqual([
      { groupId: 8, name: 'Roof', collectionId: 'house', order: 1 },
    ])
    history.undo()
    expect(groupNamesOf(scheme)).toEqual(
      new Map([
        [7, 'Walls'],
        [8, 'Roof'],
      ])
    )
    expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)).toEqual({
      groupId: 7,
      name: 'Walls',
      collectionId: 'house',
      order: 0,
    })
    history.redo()
    expect(groupNamesOf(scheme)).toEqual(new Map([[8, 'Roof']]))
  })

  it('does not move a dissolved group name onto an unnamed target', () => {
    const { scheme } = setup()
    scheme.collectionTree.value = {
      nodes: [],
      groups: [{ groupId: 8, name: 'Roof', collectionId: null, order: 8 }],
    }
    scheme.selectedItemIds.value = new Set(['a', 'b', 'c'])
    const groups = useEditorGroups()
    expect(groups.groupInto(7)).toBe(true)
    expect(scheme.items.value.map((item) => item.groupId)).toEqual([7, 7, 7, 0])
    expect(scheme.collectionTree.value.groups).toEqual([])
  })

  it('keeps a whole group selection a no-op and only splits a partial subset', () => {
    const { scheme } = setup()
    const groups = useEditorGroups()
    scheme.selectedItemIds.value = new Set(['a', 'b'])
    expect(groups.canGroupSelection()).toBe(false)
    expect(groups.requestGroup()).toBe(false)
    scheme.selectedItemIds.value = new Set(['a'])
    expect(groups.canGroupSelection()).toBe(false)
    scheme.items.value = [
      ...scheme.items.value,
      makeAppItem({ internalId: 'e', groupId: 7, instanceId: 1005 }),
    ]
    scheme.selectedItemIds.value = new Set(['a', 'b'])
    expect(groups.resolveGroupRequest()).toEqual({ kind: 'create' })
    expect(groups.requestGroup()).toBe(true)
    expect(scheme.items.value.map((item) => [item.internalId, item.groupId])).toEqual([
      ['a', 9],
      ['b', 9],
      ['c', 8],
      ['d', 0],
      ['e', 7],
    ])
  })

  it('keeps protected groups manageable without putting their members into editable selection', () => {
    const { store, scheme, panel, selectGroup, selection } = setup()
    selectGroup(7)
    const txCount = scheme.history.value!.transactionUndoStack.length
    store.setGroupLocked(7, true)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(store.isItemVisible('a')).toBe(true)
    expect(store.isItemEditable('a')).toBe(false)
    selectGroup(7)
    expect(selection.isSelected({ kind: 'group', id: 7 })).toBe(true)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(scheme.history.value!.transactionUndoStack.length).toBe(txCount)
    panel.renameGroup(7, '已锁定的墙')
    expect(groupNamesOf(scheme).get(7)).toBe('已锁定的墙')
    store.setGroupHidden(7, true)
    expect(store.renderItemIds).toEqual(new Set(['c', 'd']))
    expect(store.hiddenGroupCount).toBe(1)
    store.setGroupLocked(7, false)
    expect(store.isItemEditable('a')).toBe(false)
    store.showAllGroups()
    expect(store.isItemEditable('a')).toBe(true)
    expect(scheme.selectedItemIds.value.size).toBe(0)
  })

  it('shows only the clicked group as a one-way visibility edit, including ungrouped furniture', () => {
    const { store, scheme, panel, selectGroup } = setup()
    const items = scheme.items.value,
      tree = scheme.collectionTree.value
    selectGroup(7)
    const version = store.selectionVersion,
      txCount = scheme.history.value!.transactionUndoStack.length
    store.showOnly({ kind: 'group', id: 7 })
    expect(store.renderItemIds).toEqual(new Set(['a', 'b']))
    expect(store.isItemVisible('d')).toBe(false)
    expect(store.isItemEditable('c')).toBe(false)
    expect(store.hiddenItemCount).toBe(2)
    expect(scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
    expect(store.selectionVersion).toBe(version + 1)
    store.showOnly({ kind: 'group', id: 7 })
    expect(store.renderItemIds).toEqual(new Set(['a', 'b']))
    expect(store.selectionVersion).toBe(version + 1)
    store.showOnly({ kind: 'group', id: 8 })
    expect(store.renderItemIds).toEqual(new Set(['c']))
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(scheme.items.value).toBe(items)
    expect(scheme.collectionTree.value).toBe(tree)
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(txCount)
    store.showAllGroups()
    // 即使所有实际组都已显示，未分组隐藏标记仍须过滤渲染，
    // 并保留“全部显示”入口。
    expect(store.renderItemIds).toBeNull()
    scheme.hiddenGroupIds.value = new Set([0])
    expect(store.renderItemIds).toEqual(new Set(['a', 'b', 'c']))
    expect(store.hiddenItemCount).toBe(1)
    store.showAllGroups()
    expect(store.isItemVisible('d')).toBe(true)
    expect(store.hiddenItemCount).toBe(0)
    expect(store.renderItemIds).toBeNull()
  })

  it('sanitizes history and validation selection and prevents direct editing of protected furniture', () => {
    const { store, scheme, panel, history, selectGroup } = setup()
    selectGroup(7)
    useEditorSelection().clearSelection()
    store.setGroupHidden(7, true)
    history.undo()
    expect(scheme.selectedItemIds.value.size).toBe(0)
    const validation = useValidationStore()
    validation.limitIssues.invalidScaleItemIds = ['a', 'c']
    validation.selectInvalidScaleItems()
    expect([...scheme.selectedItemIds.value]).toEqual(['c'])
    // 即使调用方持有过期选择，也不能绕过事务入口的限制校验。
    scheme.selectedItemIds.value = new Set(['a', 'c'])
    useEditorManipulation().deleteSelected()
    expect(scheme.items.value.map((item) => item.internalId)).toEqual(['a', 'b', 'd'])
    expect(store.setItemInstanceId('a', 2000)).toBe(false)
    expect(store.setItemInstanceId('d', 1001)).toBe(false)
  })

  it('shows all without unlocking furniture or including personal flags in shared snapshots', () => {
    const { store, scheme } = setup()
    store.setGroupHidden(7, true)
    store.setGroupLocked(8, true)
    store.showAllGroups()
    expect(store.isItemVisible('b')).toBe(true)
    expect(store.isItemEditable('c')).toBe(false)
    const shared = buildSharedSchemeSnapshot(scheme)
    expect(shared).not.toHaveProperty('hiddenGroupIds')
    expect(shared).not.toHaveProperty('lockedGroupIds')
  })

  it('keeps the render scope token stable for ordinary edits while groups are hidden', () => {
    const { store, scheme, history } = setup()
    store.setGroupHidden(8, true)
    const scope = store.renderItemIds
    history.recordTransaction('move', () => {
      scheme.items.value = scheme.items.value.map((item) =>
        item.internalId === 'a' ? { ...item, x: 10 } : item
      )
      store.triggerSceneUpdate()
    })
    expect(store.renderItemIds).toBe(scope)
    store.setGroupHidden(7, true)
    expect(store.renderItemIds).not.toBe(scope)
  })

  it('marks a cloud rename stale when a remote edit deletes the last member of that group', () => {
    const { scheme, panel, history } = setup()
    panel.renameGroup(8, 'Roof')
    const entry = scheme.history.value!.transactionUndoStack.at(-1)!
    const removed = scheme.items.value.find((item) => item.internalId === 'c')!
    const transaction = {
      id: 'remote',
      schemeId: scheme.id,
      createdAt: 0,
      intent: 'items.delete',
      ops: [{ type: 'remove_items' as const, items: [removed] }],
    }
    applyEditorTransactionToScheme(scheme, transaction)
    history.markTransactionsStale(
      scheme.id,
      collectTransactionTouchedItemIds(transaction),
      collectTransactionTouchedGroupIds(transaction)
    )
    expect(entry.stale).toBe(true)
  })

  it('replays actual edits while locked without reselecting their protected members', () => {
    const { store, scheme, history } = setup()
    history.recordTransaction('move', () => {
      scheme.items.value = scheme.items.value.map((item) =>
        item.internalId === 'a' ? { ...item, x: 50 } : item
      )
    })
    store.setGroupLocked(7, true)
    history.undo()
    expect(scheme.items.value[0]!.x).toBe(0)
    history.redo()
    expect(scheme.items.value[0]!.x).toBe(50)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    expect(scheme.lockedGroupIds.value.has(7)).toBe(true)
  })

  it('preserves group names when clipboard paste allocates a new group', () => {
    const { scheme, panel, selectGroup } = setup()
    panel.renameGroup(7, '墙')
    selectGroup(7)
    const clipboard = useClipboard()
    clipboard.copy()
    clipboard.paste()
    const newGroup = scheme.items.value.at(-1)!.groupId
    expect(newGroup).toBeGreaterThan(8)
    expect(groupNamesOf(scheme).get(newGroup)).toBe('墙')
  })

  it('keeps existing names mapped when preserve-source renumbers them, but never renumbers locked groups', () => {
    const { store, scheme, panel, history } = setup()
    panel.renameGroup(7, '现有墙')
    const clipboard = useClipboard()
    const source = scheme.items.value
      .slice(0, 2)
      .map((item) => ({ ...item, internalId: `source-${item.internalId}` }))
    const data = createEmptyClipboardData()
    data.sourceSchemeId = 'elsewhere'
    data.items = source
    data.structure.tree.groups = [{ groupId: 7, name: '导入墙', collectionId: null, order: 7 }]
    store.clipboardList = data
    store.setGroupLocked(7, true)
    expect(clipboard.advancedPaste({ mode: 'preserveIds' })).toEqual({ newIds: [], roots: [] })
    expect(scheme.items.value).toHaveLength(4)
    store.setGroupLocked(7, false)
    expect(clipboard.advancedPaste({ mode: 'preserveIds' }).newIds).toHaveLength(2)
    const oldGroup = scheme.items.value[0]!.groupId
    expect(oldGroup).not.toBe(7)
    expect(groupNamesOf(scheme).get(oldGroup)).toBe('现有墙')
    expect(groupNamesOf(scheme).get(7)).toBe('导入墙')
    history.undo()
    expect(groupNamesOf(scheme)).toEqual(new Map([[7, '现有墙']]))
  })
})

it('preserves an archived named classification through preserve-ID paste and undo', () => {
  const store = useEditorStore()
  const id = store.openArchivedSchemeSnapshot(
    JSON.parse(
      JSON.stringify({
        name: 'Archived',
        items: [makeAppItem({ internalId: 'old', groupId: 7 })],
        groupOrigins: [],
        collectionTree: {
          nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
          groups: [{ groupId: 7, name: 'Existing walls', collectionId: 'house', order: 0 }],
        },
      })
    )
  )
  const scheme = store.getSchemeById(id)!
  expect(scheme).not.toHaveProperty('groupNames')
  const data = createEmptyClipboardData()
  data.sourceSchemeId = 'another'
  data.items = [makeAppItem({ internalId: 'incoming', groupId: 7 })]
  data.structure.tree.groups = [
    { groupId: 7, name: 'Incoming walls', collectionId: null, order: 7 },
  ]
  store.clipboardList = data
  const history = useEditorHistory()
  useClipboard().advancedPaste({ mode: 'preserveIds' })
  const oldId = scheme.items.value.find((item) => item.internalId === 'old')!.groupId
  expect(oldId).not.toBe(7)
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === oldId)).toMatchObject(
    { name: 'Existing walls', collectionId: 'house' }
  )
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)).toMatchObject({
    name: 'Incoming walls',
    collectionId: null,
  })
  history.undo()
  expect(scheme.collectionTree.value.groups).toEqual([
    { groupId: 7, name: 'Existing walls', collectionId: 'house', order: 0 },
  ])
  history.redo()
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === oldId)?.name).toBe(
    'Existing walls'
  )
  expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)?.name).toBe(
    'Incoming walls'
  )
  expect(buildSharedSchemeSnapshot(scheme)).not.toHaveProperty('groupNames')
})

it('validates incoming metadata before replacing any part of an existing scheme', () => {
  const { store, scheme } = setup()
  const items = scheme.items.value,
    name = scheme.name.value,
    tree = scheme.collectionTree.value
  const malformed = JSON.parse(
    JSON.stringify({
      name: 'Bad',
      items: [],
      groupOrigins: [],
      collectionTree: {
        nodes: [],
        groups: [{ groupId: 7, name: '', collectionId: null, order: 7 }],
      },
    })
  )
  expect(() => store.replaceSchemeSnapshot(scheme.id, malformed)).toThrow()
  expect(scheme.items.value).toBe(items)
  expect(scheme.name.value).toBe(name)
  expect(scheme.collectionTree.value).toBe(tree)
})

it.each(['hidden', 'locked'] as const)(
  'replays global history without clearing %s group flags',
  (restriction) => {
    const { store, scheme, history } = setup()
    useEditorSelection().updateSelection(['a'], false)
    useEditorManipulation().translateSelectedItems({ x: 10, y: 0, z: 0 })
    expect(store.itemsMap.get('a')!.x).toBe(10)
    if (restriction === 'hidden') store.setGroupHidden(7, true)
    else store.setGroupLocked(7, true)
    const flags = restriction === 'hidden' ? scheme.hiddenGroupIds : scheme.lockedGroupIds
    const protectedGroups = flags.value
    history.undo()
    expect(store.itemsMap.get('a')!.x).toBe(0)
    expect(flags.value).toBe(protectedGroups)
    expect(store.isItemEditable('a')).toBe(false)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    history.redo()
    expect(store.itemsMap.get('a')!.x).toBe(10)
    expect(flags.value).toBe(protectedGroups)
    expect(store.isItemEditable('a')).toBe(false)
    expect(scheme.selectedItemIds.value.size).toBe(0)
  }
)

it.each(['unclassified', 'ungrouped'] as const)(
  'blocks selection and stale edit entry points for locked %s furniture',
  (kind) => {
    const { store, scheme, selection: panelSelection, history } = setup()
    const id = kind === 'ungrouped' ? 'd' : 'a'
    const selection = useEditorSelection()
    selection.updateSelection([id], false)
    const historySize = scheme.history.value!.transactionUndoStack.length
    if (kind === 'ungrouped') store.setGroupLocked(0, true)
    else store.setCollectionRestriction(UNCLASSIFIED, 'locked', true)
    expect(store.isItemVisible(id)).toBe(true)
    expect(store.isItemEditable(id)).toBe(false)
    expect(scheme.selectedItemIds.value.size).toBe(0)
    selection.selectAll()
    expect(scheme.selectedItemIds.value.has(id)).toBe(false)
    panelSelection.select(
      kind === 'ungrouped' ? { kind: 'ungrouped', id: 0 } : { kind: 'group', id: 7 },
      { ctrlKey: false, metaKey: false, shiftKey: false }
    )
    expect(scheme.selectedItemIds.value.size).toBe(0)
    const items = scheme.items.value
    const manipulation = useEditorManipulation()
    scheme.selectedItemIds.value = new Set([id])
    manipulation.translateSelectedItems({ x: 10, y: 0, z: 0 })
    scheme.selectedItemIds.value = new Set([id])
    manipulation.deleteSelected()
    expect(scheme.items.value).toEqual(items)
    expect(scheme.items.value.every((item, index) => item === items[index])).toBe(true)
    expect(scheme.history.value!.transactionUndoStack).toHaveLength(historySize)
    history.undo()
    expect(scheme.selectedItemIds.value.has(id)).toBe(false)
    expect([...scheme.selectedItemIds.value].every((id) => store.isItemEditable(id))).toBe(true)
    expect(store.isItemEditable(id)).toBe(false)
  }
)

it('retains ungrouped flags across grouping and ungrouping without applying them to real groups', () => {
  const { store, scheme } = setup()
  store.setGroupHidden(0, true)
  store.setGroupLocked(0, true)
  expect(store.isItemVisible('d')).toBe(false)
  const items = scheme.items.value
  setSchemeItems(
    scheme,
    items.map((item) => (item.internalId === 'd' ? { ...item, groupId: 9 } : item))
  )
  expect(store.isItemEditable('d')).toBe(true)
  expect(scheme.lockedGroupIds.value).toEqual(new Set([0]))
  setSchemeItems(scheme, items)
  store.showAllGroups()
  expect(store.isItemVisible('d')).toBe(true)
  expect(store.isItemEditable('d')).toBe(false)
  store.setGroupLocked(0, false)
  expect(store.isItemEditable('d')).toBe(true)
})

it('unlocks the active scheme including empty collections while preserving visibility, selection and history', () => {
  useEditorStore().createScheme('other')
  const otherScheme = useEditorStore().activeScheme!
  otherScheme.lockedGroupIds.value = new Set([7])
  const { store, scheme } = setup()
  const directory = useCollectionPanel(ref(''))
  const empty = directory.createCollection()!
  store.setGroupHidden(8, true)
  store.setCollectionRestriction(UNCLASSIFIED, 'hidden', true)
  store.setGroupLocked(7, true)
  store.setGroupLocked(0, true)
  store.setCollectionRestriction(UNCLASSIFIED, 'locked', true)
  store.setCollectionRestriction(empty, 'locked', true)
  const items = scheme.items.value,
    tree = scheme.collectionTree.value
  const hidden = scheme.hiddenGroupIds.value,
    hiddenCollections = scheme.hiddenCollectionIds.value
  const selected = new Set(scheme.selectedItemIds.value)
  const count = scheme.history.value!.transactionUndoStack.length
  const sequence = scheme.history.value!.nextSequence
  store.unlockAllGroups()
  expect(scheme.lockedGroupIds.value.size).toBe(0)
  expect(scheme.lockedCollectionIds.value.size).toBe(0)
  expect(store.effectiveLockedGroupIds.size).toBe(0)
  expect(scheme.hiddenGroupIds.value).toBe(hidden)
  expect(scheme.hiddenCollectionIds.value).toBe(hiddenCollections)
  expect(scheme.selectedItemIds.value).toEqual(selected)
  expect(scheme.items.value).toBe(items)
  expect(scheme.collectionTree.value).toBe(tree)
  expect(scheme.history.value!.transactionUndoStack).toHaveLength(count)
  expect(scheme.history.value!.nextSequence).toBe(sequence)
  expect(otherScheme.lockedGroupIds.value).toEqual(new Set([7]))
  const version = store.selectionVersion
  store.unlockAllGroups()
  expect(store.selectionVersion).toBe(version)
})

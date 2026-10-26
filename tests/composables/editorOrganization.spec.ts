import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { useAiEditorHost } from '@/composables/ai/useAiEditorHost'
import { useEditorOrganization } from '@/composables/editor/useEditorOrganization'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { applyEditorTransactionToScheme } from '@/lib/editorTransactions'
import { isCollectionTree, UNCLASSIFIED } from '@/lib/collectionTree'
import { makeAppItem, makeScheme } from '../fixtures/item'
import type { OrganizationChanges } from '@/lib/sceneAnalysis/types'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  const editor = useEditorStore()
  editor.createScheme('Organization')
  const scheme = editor.activeScheme!
  scheme.items.value = ['a', 'b', 'outside', 'c', 'untouched'].map((id, index) =>
    makeAppItem({
      internalId: id,
      instanceId: index + 1000,
      groupId: index < 3 ? 7 : index === 3 ? 8 : 9,
      x: index * 100,
      extra: { AttachID: 0, Scale: { X: 1, Y: 2, Z: 3 }, ColorMap: { '1': 1 } },
    })
  )
  scheme.maxGroupId.value = 9
  scheme.collectionTree.value = {
    nodes: [
      { id: 'house', name: 'House', parentId: null, order: 0 },
      { id: 'room', name: 'Room', parentId: 'house', order: 0 },
    ],
    groups: [
      { groupId: 7, name: 'Original', collectionId: 'room', order: 0 },
      { groupId: 8, name: 'Keep', collectionId: 'house', order: 0 },
      { groupId: 9, name: 'Outside', collectionId: null, order: 0 },
    ],
  }
  scheme.groupOrigins.value = new Map([
    [7, 'a'],
    [8, 'c'],
  ])
  scheme.selectedItemIds.value = new Set(['untouched'])
  editor.triggerSceneUpdate()
  const scope = effectScope()
  scopes.push(scope)
  const { host } = scope.run(() => useAiEditorHost())!
  const snapshot = host.snapshot(['a', 'b', 'c'])
  const history = useEditorHistory()
  const command = {
    collections: [
      { id: 'porch', name: 'Porch', parentId: 'room' },
      { id: 'details', name: 'Details', parentId: 'porch' },
    ],
    groups: [
      { id: 'column', name: 'Column', collectionId: 'porch', itemIds: ['a'] },
      { id: 'arch', name: 'Arch', collectionId: 'details', itemIds: ['b'] },
    ],
  }
  const execute = async (parameters: unknown = command, id = host.current().version) => {
    try {
      return host.apply(parameters, id)
    } catch (cause) {
      return {
        ok: false,
        error: { code: (cause as { code: string }).code, message: String(cause) },
      }
    }
  }
  return { editor, scheme, scope, host, snapshot, history, command, execute }
}

it('directly writes nested collections and singleton groups in ONE transaction, preserves all nonmembers with per-operation evidence', async () => {
  const { editor, scheme, host, snapshot, execute } = setup()
  const items = scheme.items.value,
    tree = scheme.collectionTree.value,
    version = editor.sceneVersion
  const selection = scheme.selectedItemIds.value
  const result = await execute()
  expect(result.ok).toBe(true)
  const data = result.ok ? (result.data as OrganizationChanges) : null
  expect(data).toMatchObject({
    regroupedItemCount: 2,
    groups: [
      { id: 'column', groupId: 10, itemCount: 1 },
      { id: 'arch', groupId: 11, itemCount: 1 },
    ],
    affectedGroups: [
      { groupId: 7, movedItemCount: 2, remainingMemberCount: 1, originCleared: true },
    ],
  })
  expect(host.current().version).not.toBe(snapshot.id)
  expect(host.snapshot(['a', 'b', 'c']).items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  expect(host.snapshot(['a', 'b', 'c']).items.map((item) => item.groupId)).toEqual([10, 11, 8])
  expect(scheme.selectedItemIds.value).toBe(selection)
  expect(scheme.items.value.slice(2)).toEqual(items.slice(2))
  for (let i = 2; i < items.length; i++) expect(scheme.items.value[i]).toBe(items[i])
  expect(scheme.items.value[0]).toEqual({ ...items[0], groupId: 10 })
  expect(scheme.items.value[0]!.extra).toBe(items[0]!.extra)
  expect(scheme.groupOrigins.value).toEqual(new Map([[8, 'c']]))
  expect(scheme.collectionTree.value.groups[0]).toBe(tree.groups[0])
  expect(scheme.collectionTree.value.nodes.slice(0, 2)).toEqual(tree.nodes)
  expect(isCollectionTree(scheme.collectionTree.value)).toBe(true)
  expect(scheme.collectionTree.value.nodes[3]?.parentId).toBe(data!.collections[0]!.collectionId)
  expect(editor.sceneVersion).toBe(version + 1)
  expect(scheme.history.value?.transactionUndoStack).toHaveLength(1)
  expect(scheme.history.value?.transactionUndoStack[0]?.transaction.intent).toBe('items.organize')
  expect(await execute(undefined, snapshot.id)).toMatchObject({
    ok: false,
    error: { code: 'stale' },
  })
})

it('restores the entire tree, names and origins with one undo/redo, never rewinds IDs and invalidates old evidence', async () => {
  const { scheme, host, snapshot, history, execute } = setup()
  const before = structuredClone({
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
  })
  await execute()
  const nextId = host.current().version
  const after = structuredClone({
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
  })
  history.undo()
  expect({
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
  }).toEqual(before)
  expect(scheme.maxGroupId.value).toBe(11)
  expect(() => host.assertCurrent(nextId)).toThrow()
  history.redo()
  expect({
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
  }).toEqual(after)
  expect(() => host.assertCurrent(snapshot.id)).toThrow()
  history.undo()
  await execute({
    collections: [],
    groups: [{ id: 'merged', name: 'Merged', collectionId: 'room', itemIds: ['a', 'b'] }],
  })
  expect(scheme.maxGroupId.value).toBe(12)
  expect(scheme.items.value[0]?.groupId).toBe(12)
})

it('reuses existing authorized collection IDs for subsequent edits and removes dissolved group metadata only', async () => {
  const { scheme, host, execute } = setup()
  await execute()
  const parent = scheme.collectionTree.value.nodes.find((node) => node.name === 'Porch')!.id
  expect(
    (
      await execute({
        collections: [],
        groups: [{ id: 'merged', name: 'Combined', collectionId: parent, itemIds: ['a', 'b'] }],
      })
    ).ok
  ).toBe(true)
  expect(scheme.collectionTree.value.groups.map((group) => group.groupId)).toEqual([7, 8, 9, 12])
  expect(scheme.collectionTree.value.nodes).toHaveLength(4) // Existing empty folders are preserved.
  expect(host.snapshot(['a', 'b', 'c']).groups.some((group) => group.groupId === 12)).toBe(true)
})

it('rejects invalid or unauthorized commands without touching references, history, selection or ID allocators', async () => {
  const { editor, scheme, snapshot, command, execute } = setup()
  const before = {
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
    selection: scheme.selectedItemIds.value,
    max: scheme.maxGroupId.value,
    version: editor.sceneVersion,
  }
  for (const parameters of [
    { ...command, groups: [] },
    { ...command, groups: [command.groups[0], command.groups[0]] },
    { ...command, groups: [{ ...command.groups[0], itemIds: ['missing'] }] },
    {
      ...command,
      collections: [{ ...command.collections[0], parentId: 'details' }, command.collections[1]],
    },
  ])
    expect((await execute(parameters, snapshot.id)).ok).toBe(false)
  expect(scheme.items.value).toBe(before.items)
  expect(scheme.collectionTree.value).toBe(before.tree)
  expect(scheme.groupOrigins.value).toBe(before.origins)
  expect(scheme.selectedItemIds.value).toBe(before.selection)
  expect(scheme.maxGroupId.value).toBe(before.max)
  expect(editor.sceneVersion).toBe(before.version)
  expect(scheme.history.value).toBeUndefined()
})

it.each(['hidden', 'locked', 'deleted', 'scheme-switch', 'dispose'])(
  'rejects an in-flight command after %s changes',
  async (action) => {
    const { editor, scheme, scope, snapshot, execute } = setup()
    if (action === 'hidden') scheme.hiddenGroupIds.value = new Set([7])
    if (action === 'locked') scheme.lockedGroupIds.value = new Set([7])
    if (action === 'deleted')
      scheme.items.value = scheme.items.value.filter((item) => item.internalId !== 'a')
    if (action === 'scheme-switch') editor.createScheme('Other')
    if (action === 'dispose') scope.stop()
    expect((await execute(undefined, snapshot.id)).ok).toBe(false)
    expect(scheme.maxGroupId.value).toBe(9)
    expect(scheme.history.value).toBeUndefined()
  }
)

it('checks the editor version and destination restrictions independently before committing', () => {
  const { editor, scheme, host } = setup()
  const organization = useEditorOrganization()
  expect(() =>
    organization.organize(
      { collections: [], groups: [] },
      { schemeId: scheme.id, sceneVersion: editor.sceneVersion - 1 }
    )
  ).toThrow()
  scheme.lockedCollectionIds.value = new Set([UNCLASSIFIED])
  host.snapshot(['a', 'b', 'c'])
  expect(() =>
    organization.organize(
      { collections: [], groups: [{ id: 'x', name: 'X', collectionId: null, itemIds: ['a'] }] },
      { schemeId: scheme.id, sceneVersion: editor.sceneVersion }
    )
  ).toThrow(/Destination/)
  expect(scheme.history.value).toBeUndefined()
  expect(scheme.maxGroupId.value).toBe(9)
})

it('uses the standard cloud transaction queue and replays the same data, names, hierarchy and undo on a second scheme', async () => {
  const { editor, scheme, host, history, execute } = setup()
  scheme.source.value = 'cloud'
  const original = structuredClone({
    items: scheme.items.value,
    tree: scheme.collectionTree.value,
    origins: scheme.groupOrigins.value,
  })
  expect((await execute()).ok).toBe(false)
  expect(scheme.history.value).toBeUndefined()
  const cloud = useCloudSchemeStore()
  cloud.schemeId = scheme.id
  cloud.status = 'connected'
  expect((await execute()).ok).toBe(true)
  expect(editor.pendingTransactions).toHaveLength(1)
  const forward = editor.peekPendingTransaction(scheme.id)!
  const remote = makeScheme(original.items)
  remote.collectionTree.value = original.tree
  remote.groupOrigins.value = original.origins
  applyEditorTransactionToScheme(remote, JSON.parse(JSON.stringify(forward)))
  expect(remote.items.value).toEqual(scheme.items.value)
  expect(remote.collectionTree.value).toEqual(scheme.collectionTree.value)
  expect(remote.groupOrigins.value).toEqual(scheme.groupOrigins.value)
  editor.acknowledgePendingTransaction(forward.id)
  history.markTransactionCommitted(scheme.id, forward.id)
  history.undo()
  expect(editor.pendingTransactions).toHaveLength(1)
  applyEditorTransactionToScheme(
    remote,
    JSON.parse(JSON.stringify(editor.peekPendingTransaction(scheme.id)!))
  )
  expect(remote.items.value).toEqual(scheme.items.value)
  expect(remote.collectionTree.value).toEqual(scheme.collectionTree.value)
  expect(remote.groupOrigins.value).toEqual(scheme.groupOrigins.value)
  expect(scheme.items.value).toEqual(original.items)
})

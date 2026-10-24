import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { useTabStore } from '@/stores/tabStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useGroupMetadataImport } from '@/composables/editor/useGroupMetadataImport'
import { createGameImportOps } from '@/composables/fileOps/gameImport'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import { applyEditorTransactionToScheme } from '@/lib/editorTransactions'
import { serializeBuildData } from '@/lib/gameDataFormat'
import { makeAppItem, setGroupNames } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const store = useEditorStore()
  store.createScheme('source')
  const source = store.activeScheme!
  source.items.value = [makeAppItem({ groupId: 7 })]
  source.collectionTree.value = {
    nodes: [{ id: 'house', name: 'House', parentId: null, order: 0 }],
    groups: [{ groupId: 7, name: 'Walls', collectionId: 'house', order: 2 }],
  }
  source.groupOrigins.value = new Map([[7, 'item-1']])
  source.hiddenGroupIds.value = new Set([7])
  source.lockedCollectionIds.value = new Set(['house'])
  const content = serializeBuildData([
    {
      ItemID: 1170000010,
      InstanceID: 1000,
      GroupID: 7,
      AttachID: 0,
      Location: { X: 5, Y: 6, Z: 7 },
      Rotation: { Roll: 0, Pitch: 0, Yaw: 30 },
      Scale: { X: 1, Y: 1, Z: 1 },
    },
  ])
  const settings = useSettingsStore()
  settings.settings.lastSavedToGameSchemeId = source.id
  const imports = createGameImportOps(store, settings, (key) => key)
  return { store, source, content, settings, imports }
}

it('initializes automatic imports before publishing the tab, without history or personal flags', async () => {
  const { store, source, content, imports, settings } = setup()
  setGroupNames(source, [[7, 'Latest name']])
  const result = await imports.importGameJSON(content, 'BUILD_SAVEDATA_123.json')
  const target = store.activeScheme!
  expect(result.inheritedGroupCount).toBe(1)
  expect(result.message).toBe('fileOps.import.groupsInherited')
  expect(target.collectionTree.value).toEqual(source.collectionTree.value)
  expect(target.groupOrigins.value.get(7)).toBe(target.items.value[0]?.internalId)
  expect(target.groupOrigins.value.get(7)).not.toBe('item-1')
  expect(target.items.value[0]?.x).toBe(5)
  expect(target.hiddenGroupIds.value.size).toBe(0)
  expect(target.lockedCollectionIds.value.size).toBe(0)
  expect(target.history.value).toBeUndefined()
  expect(settings.settings.lastSavedToGameSchemeId).toBe(source.id)
})

it('keeps generic imports opt-in and skips auto inheritance when disabled or the source is closed', async () => {
  const { store, source, content, imports, settings } = setup()
  await store.importJSONAsScheme(content, 'generic.json')
  expect(store.activeScheme!.collectionTree.value.groups).toEqual([])
  settings.settings.autoInheritGroupMetadata = false
  expect((await imports.importGameJSON(content, 'disabled.json')).message).toBe(
    'fileOps.import.success'
  )
  settings.settings.autoInheritGroupMetadata = true
  store.closeScheme(source.id)
  const result = await imports.importGameJSON(content, 'closed.json')
  expect(result.success).toBe(true)
  expect(result.message).toBe('fileOps.import.success')
  expect(store.activeScheme!.groupOrigins.value.size).toBe(0)
})

it('uses whole current members, supports restored source IDs, and does not fall back to another source', async () => {
  const { store, source, content, imports, settings } = setup()
  const snapshot = buildSharedSchemeSnapshot(source)
  source.items.value = [
    ...source.items.value,
    makeAppItem({ internalId: 'extra', instanceId: 1001, groupId: 7 }),
  ]
  expect((await imports.importGameJSON(content, 'changed.json')).message).toBe(
    'fileOps.import.success'
  )
  store.closeScheme(source.id)
  store.openArchivedSchemeSnapshot(snapshot, { schemeId: source.id })
  expect((await imports.importGameJSON(content, 'restored.json')).inheritedGroupCount).toBe(1)
  settings.settings.lastSavedToGameSchemeId = 'missing'
  expect(
    (await imports.importGameJSON(content, 'missing.json')).inheritedGroupCount
  ).toBeUndefined()
})

it('uses the normal success message for exact matches without editor-only group information', async () => {
  const { source, content, imports } = setup()
  source.collectionTree.value = { nodes: [], groups: [] }
  source.groupOrigins.value = new Map()
  const result = await imports.importGameJSON(content, 'ordinary-game-scheme.json')
  expect(result.success).toBe(true)
  expect(result.inheritedGroupCount).toBe(0)
  expect(result.message).toBe('fileOps.import.success')
})

it('applies one metadata transaction with undo/redo, no furniture changes, and no no-op history', async () => {
  const { store, source, content } = setup()
  await store.importJSONAsScheme(content, 'target.json')
  const target = store.activeScheme!
  const items = target.items.value
  const selection = new Set(target.selectedItemIds.value)
  const imports = useGroupMetadataImport()
  const preview = imports.preview(source.id)!
  expect(preview.changedGroupCount).toBe(1)
  expect(target.collectionTree.value.groups).toEqual([])
  expect(imports.importFrom(source.id, target.id)?.changedGroupCount).toBe(1)
  expect(target.history.value?.transactionUndoStack).toHaveLength(1)
  expect(target.items.value).toBe(items)
  expect(target.selectedItemIds.value).toEqual(selection)
  expect(imports.importFrom(source.id, target.id)).toBeNull()
  expect(target.history.value?.transactionUndoStack).toHaveLength(1)
  const { undo, redo } = useEditorHistory()
  undo()
  expect(target.collectionTree.value.groups).toEqual([])
  expect(target.groupOrigins.value.size).toBe(0)
  redo()
  expect(target.collectionTree.value).toEqual(source.collectionTree.value)
  expect(target.groupOrigins.value.get(7)).toBe(target.items.value[0]?.internalId)
  expect(target.items.value).toBe(items)
})

it('rejects a closed or current source and observes cloud connection/capability before committing', async () => {
  const { store, source, content } = setup()
  const imports = useGroupMetadataImport()
  expect(imports.preview(source.id)).toBeNull()
  await store.importJSONAsScheme(content, 'cloud.json')
  const target = store.activeScheme!
  target.source.value = 'cloud'
  expect(imports.importFrom(source.id, target.id)).toBeNull()
  const cloud = useCloudSchemeStore()
  cloud.schemeId = target.id
  cloud.status = 'connected'
  target.collectionsSupported.value = false
  expect(imports.importFrom(source.id, target.id)).toBeNull()
  target.collectionsSupported.value = true
  const peer = {
    ...target,
    collectionTree: { value: target.collectionTree.value },
    groupOrigins: { value: target.groupOrigins.value },
  }
  expect(imports.importFrom(source.id, target.id)).not.toBeNull()
  const transaction = store.peekPendingTransaction(target.id)!
  expect(transaction.ops.map((op) => op.type)).toEqual(
    expect.arrayContaining(['set_group_origins', 'set_group_names', 'set_collection_tree'])
  )
  // 云端消费者使用现有协议重放同一笔事务。
  applyEditorTransactionToScheme(peer as typeof target, transaction)
  expect(peer.collectionTree.value).toEqual(target.collectionTree.value)
  expect(peer.groupOrigins.value).toEqual(target.groupOrigins.value)
  store.closeScheme(source.id)
  expect(imports.preview(source.id)).toBeNull()
})

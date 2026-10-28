import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildDisplayWorldMatrixFromItem } from '@/lib/scaleRenderCompensation'
import { useGameDataStore } from '@/stores/gameDataStore'
import { Matrix4, Object3D } from 'three'
import { useThreeTransformGizmo } from '@/composables/useThreeTransformGizmo'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorCollectionOrigins } from '@/composables/editor/useEditorCollectionOrigins'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { useCollectionPanel } from '@/composables/editor/useCollectionPanel'
import { useGroupPanel } from '@/composables/editor/useGroupPanel'
import { useGroupPanelSelection } from '@/composables/editor/useGroupPanelSelection'
import { useTransformSelection } from '@/composables/transform/useTransformSelection'
import { useClipboard } from '@/composables/useClipboard'
import { resolveSelectionReference } from '@/lib/selectionReference'
import { readCollectionTree } from '@/lib/collectionTree'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import { makeAppItem } from '../fixtures/item'

vi.mock('@vueuse/core', async (original) => ({
  ...(await original<typeof import('@vueuse/core')>()),
  useMagicKeys: () => ({
    Alt: ref(false),
    Control: ref(false),
    Meta: ref(false),
    Shift: ref(false),
  }),
}))
vi.mock('@/composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('zh') }),
}))
vi.mock('@/composables/useThreeModelManager', () => ({
  getThreeModelManager: () => ({ getModelBoundingBox: () => null }),
}))

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
  return scope.run(() => {
    const store = useEditorStore()
    store.createScheme('collection origins')
    const scheme = store.activeScheme!
    scheme.items.value = [
      makeAppItem({ internalId: 'a', instanceId: 1000, groupId: 7, x: 10 }),
      makeAppItem({ internalId: 'b', instanceId: 1001, groupId: 7, x: 30 }),
      makeAppItem({ internalId: 'c', instanceId: 1002, groupId: 8, x: 70 }),
      makeAppItem({ internalId: 'other', instanceId: 1003, groupId: 9, x: 300 }),
    ]
    scheme.collectionTree.value = {
      nodes: [
        { id: 'house', name: 'House', parentId: null, order: 0 },
        { id: 'floor', name: 'Floor', parentId: 'house', order: 0 },
      ],
      groups: [
        { groupId: 7, collectionId: 'floor', order: 0 },
        { groupId: 8, collectionId: 'floor', order: 1 },
      ],
    }
    scheme.groupOrigins.value = new Map([
      [7, 'b'],
      [8, 'c'],
    ])
    scheme.maxGroupId.value = 9
    scheme.maxInstanceId.value = 1003
    store.triggerSceneUpdate()
    const origins = useEditorCollectionOrigins()
    const panel = useGroupPanel()
    const query = ref('')
    const directory = useCollectionPanel(query, panel)
    const selection = useGroupPanelSelection(
      directory.rows,
      panel.groups,
      directory.groupsForEntry,
      query
    )
    const select = (id: string) =>
      selection.select(
        { kind: 'collection', id },
        {
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
        }
      )
    return {
      store,
      scheme,
      origins,
      directory,
      selection,
      select,
      history: useEditorHistory(),
      manipulation: useEditorManipulation(),
      transform: useTransformSelection(),
      clipboard: useClipboard(),
    }
  })!
}

it('sets immutable metadata without moving items; tracks explicit parent/child choices even with identical members', () => {
  const { store, scheme, origins, select, history, transform } = setup()
  const items = scheme.items.value
  expect(origins.setCollectionOrigin('house', 'other')).toBe(false)
  origins.setCollectionOrigin('house', 'a')
  origins.setCollectionOrigin('floor', 'c')
  origins.clearCollectionOrigin('house')
  expect(scheme.collectionTree.value.nodes[0]!.originItemId).toBeUndefined()
  history.undo()
  expect(scheme.items.value).toBe(items)
  expect(readCollectionTree(scheme.collectionTree.value).nodes[0]!.originItemId).toBe('a')
  select('house')
  expect(transform.selectionInfo.value).toMatchObject({
    center: { x: 10 },
    originItemId: 'a',
    originCollectionName: 'House',
  })
  const version = store.sceneVersion
  select('floor')
  expect(transform.selectionInfo.value?.originItemId).toBe('c')
  history.undo()
  expect(resolveSelectionReference(scheme)?.id).toBe('house')
  history.redo()
  expect(resolveSelectionReference(scheme)?.id).toBe('floor')
  expect(store.sceneVersion).toBe(version)
  useEditorSelection().updateSelection(['a', 'b', 'c'], false)
  expect(resolveSelectionReference(scheme)).toBeNull()
  useEditorSelection().updateSelection(['a', 'b'], false)
  expect(resolveSelectionReference(scheme)?.item.internalId).toBe('b')
})

it('uses one reference for position, absolute orientation, scaling and custom pivots without changing groups', () => {
  const { store, scheme, origins, select, manipulation, history } = setup()
  origins.setCollectionOrigin('house', 'a')
  select('house')
  const other = store.itemsMap.get('other')
  manipulation.setSelectedPosition({ x: 100, y: 20, z: 0 })
  expect(store.itemsMap.get('b')).toMatchObject({ x: 120, y: 20, groupId: 7 })
  expect(store.itemsMap.get('c')).toMatchObject({ x: 160, y: 20, groupId: 8 })
  manipulation.rotateSelectionAroundOrigin('a', 'z', 90)
  expect(store.itemsMap.get('a')!.rotation.z).toBeCloseTo(90)
  expect(store.itemsMap.get('b')!.x).toBeCloseTo(100)
  expect(Math.abs(store.itemsMap.get('b')!.y - 20)).toBeCloseTo(20)
  expect(store.itemsMap.get('b')!.rotation.z).toBeCloseTo(90)
  history.undo()
  manipulation.scaleSelectedItemsRelative('x', 2)
  expect(store.itemsMap.get('b')!.x).toBeCloseTo(140)
  expect(store.itemsMap.get('other')).toBe(other)
  expect(scheme.groupOrigins.value).toEqual(
    new Map([
      [7, 'b'],
      [8, 'c'],
    ])
  )
  const ui = useUIStore()
  ui.setCustomPivotPosition({ x: 999, y: 0, z: 0 })
  ui.setCustomPivotEnabled(true)
  expect(manipulation.getRotationCenter()!.x).toBe(999)
  manipulation.setSelectedPosition({ x: 200, y: 0, z: 0 })
  expect(store.itemsMap.get('a')!.x).toBeCloseTo(200)
})

it('rejects partial or extra selections, and respects locked members', () => {
  const { store, scheme, origins, select } = setup()
  origins.setCollectionOrigin('house', 'a')
  store.setGroupLocked(8, true)
  select('house')
  expect(scheme.selectedItemIds.value.size).toBe(2)
  expect(resolveSelectionReference(scheme)).toBeNull()
  expect(origins.canEditCollectionOrigin('house')).toBe(false)
  store.setGroupLocked(8, false)
  select('house')
  scheme.selectedItemIds.value = new Set([...scheme.selectedItemIds.value, 'other'])
  expect(resolveSelectionReference(scheme)).toBeNull()
})

it('clears invalid origins in the same transaction and restores them with undo', () => {
  const { scheme, origins, select, manipulation, history, directory } = setup()
  origins.setCollectionOrigin('house', 'a')
  origins.setCollectionOrigin('floor', 'a')
  directory.move({ kind: 'group', id: 7 }, 'house')
  expect(scheme.collectionTree.value.nodes[0]!.originItemId).toBe('a')
  expect(scheme.collectionTree.value.nodes[1]!.originItemId).toBeUndefined()
  history.undo()
  expect(scheme.collectionTree.value.nodes[1]!.originItemId).toBe('a')
  select('house')
  manipulation.deleteSelected()
  expect(scheme.collectionTree.value.nodes.every((node) => !node.originItemId)).toBe(true)
  history.undo()
  expect(resolveSelectionReference(scheme)?.item.internalId).toBe('a')
  history.redo()
  expect(scheme.collectionTree.value.nodes.every((node) => !node.originItemId)).toBe(true)
})

it('remaps copied origins, preserves them in snapshots, and restores references after close/reopen', async () => {
  const { store, scheme, origins, select, clipboard, history } = setup()
  origins.setCollectionOrigin('house', 'a')
  origins.setCollectionOrigin('floor', 'c')
  select('house')
  clipboard.copy()
  const result = clipboard.pasteItems(clipboard.clipboard.value, 50, 0)
  const copyId = result.roots.find((entry) => entry.kind === 'collection')!.id
  const copy = scheme.collectionTree.value.nodes.find((node) => node.id === copyId)!
  expect(copy.originItemId).not.toBe('a')
  expect(result.newIds).toContain(copy.originItemId)
  expect(store.itemsMap.get(copy.originItemId!)!.x).toBe(60)
  history.undo()
  history.redo()
  expect(resolveSelectionReference(scheme)?.item.internalId).toBe(copy.originItemId)
  expect(buildSharedSchemeSnapshot(scheme).collectionTree).toEqual(scheme.collectionTree.value)
  store.closeScheme(scheme.id)
  const reopened = await store.reopenClosedScheme()
  expect(reopened.success).toBe(true)
  const restored = store.activeScheme!
  const original = restored.collectionTree.value.nodes.find((node) => node.id === 'house')!
  expect(original.originItemId).not.toBe('a')
  expect(
    restored.items.value.find((item) => item.internalId === original.originItemId)!.instanceId
  ).toBe(1000)
})

it('positions the actual Gizmo at the collection origin and commits exactly its last scale preview', async () => {
  const { store, scheme, origins, select } = setup()
  origins.setCollectionOrigin('house', 'a')
  select('house')
  const settings = useSettingsStore().settings
  settings.enableLimitDetection = false
  settings.enableSurfaceSnap = false
  store.gizmoMode = 'scale'
  const pivot = new Object3D()
  let preview = new Map<string, Matrix4>()
  const gizmo = scope.run(() =>
    useThreeTransformGizmo(
      shallowRef(pivot),
      (matrices) => {
        preview = matrices
      },
      ref(false),
      undefined,
      undefined,
      shallowRef({ instance: { axis: 'X' } })
    )
  )!
  await nextTick()
  expect(pivot.position.x).toBe(10)
  const before = scheme.items.value
  const count = scheme.history.value!.transactionUndoStack.length
  gizmo.handleGizmoMouseDown()
  pivot.scale.x = 1.5
  await gizmo.handleGizmoChange()
  const lastX = preview.get('b')!.elements[12]
  const data = useGameDataStore()
  const geometry = {
    currentMode: settings.threeDisplayMode,
    getFurnitureSize: data.getFurnitureSize,
    getModelConfig: data.getFurnitureModelConfig,
  }
  const expectedItem = {
    ...before[1]!,
    x: 40,
    extra: { ...before[1]!.extra, Scale: { X: 1, Y: 1.5, Z: 1 } },
  }
  expect(lastX).toBeCloseTo(
    buildDisplayWorldMatrixFromItem(expectedItem, geometry).worldMatrix.elements[12]!
  )
  expect(scheme.items.value).toBe(before)
  gizmo.handleGizmoMouseUp()
  expect(store.itemsMap.get('b')!.x).toBeCloseTo(40)
  expect(
    buildDisplayWorldMatrixFromItem(store.itemsMap.get('b')!, geometry).worldMatrix.elements[12]
  ).toBeCloseTo(lastX!)
  expect(store.itemsMap.get('b')!.extra.Scale).toEqual({ X: 1, Y: 1.5, Z: 1 })
  expect(scheme.history.value!.transactionUndoStack.length).toBe(count + 1)
})

it('uses the collection reference for step repeat and never retains uncopied origin IDs across schemes', () => {
  const { store, scheme, origins, select, clipboard } = setup()
  origins.setCollectionOrigin('house', 'a')
  select('house')
  clipboard.copy()
  const result = clipboard.advancedPaste({
    mode: 'stepRepeat',
    stepRepeat: {
      repeatCount: 1,
      positionDelta: { x: 0, y: 0, z: 0 },
      rotationDelta: { x: 0, y: 0, z: 90 },
      scaleMultiplier: { x: 1, y: 1, z: 1 },
    },
  })
  const copy = scheme.collectionTree.value.nodes.find((node) => node.id === result.roots[0]!.id)!
  expect(store.itemsMap.get(copy.originItemId!)!.x).toBeCloseTo(10)
  expect(store.itemsMap.get(copy.originItemId!)!.y).toBeCloseTo(0)
  origins.setCollectionOrigin('house', 'c')
  origins.setCollectionOrigin('floor', 'a')
  const partial = clipboard.buildClipboardDataFromSelection([{ kind: 'group', id: 7 }])
  store.createScheme('partial target')
  clipboard.pasteItems(partial, 0, 0)
  const target = store.activeScheme!
  expect(
    target.collectionTree.value.nodes.find((node) => node.name === 'House')!.originItemId
  ).toBeUndefined()
  const reference = target.collectionTree.value.nodes.find(
    (node) => node.name === 'Floor'
  )!.originItemId
  expect(reference).not.toBe('a')
  expect(target.items.value.some((item) => item.internalId === reference)).toBe(true)
})

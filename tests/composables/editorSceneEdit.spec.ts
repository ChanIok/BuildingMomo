import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import {
  sceneEditPostcondition,
  useEditorSceneEdit,
  verifySceneEdit,
} from '@/composables/editor/useEditorSceneEdit'
import { makeAppItem } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
})

const testRules = {
  isReady: () => true,
  getFurniture: (gameId: number) => ({
    name_cn: `家具 ${gameId}`,
    name_en: `Furniture ${gameId}`,
    icon: '',
    size: [100, 100, 100] as [number, number, number],
    scaleRange: [0.01, 100] as [number, number],
    rotationAllowed: { x: true, y: true, z: true },
    categoryId: 1,
  }),
  getScaleRange: () => [0.01, 100] as [number, number],
}

function setup() {
  const editor = useEditorStore()
  editor.createScheme('Scene edit')
  const scheme = editor.activeScheme!
  scheme.items.value = ['a', 'b', 'untouched'].map((id, index) =>
    makeAppItem({
      internalId: id,
      instanceId: 1000 + index,
      x: index * 100,
      y: 50,
      z: 10,
      extra: { AttachID: 0, Scale: { X: 1, Y: 2, Z: 3 }, ColorMap: { '0': 0 } },
    })
  )
  scheme.maxInstanceId.value = 1002
  editor.triggerSceneUpdate()
  const sceneEdit = useEditorSceneEdit(testRules)
  const history = useEditorHistory()
  const apply = (command: unknown, sceneVersion = editor.sceneVersion) =>
    sceneEdit.apply(command, { schemeId: scheme.id, sceneVersion })
  return { editor, scheme, history, apply }
}

it('converts AI world/visual DTO back to data space in one transaction and keeps untouched references', () => {
  const { editor, scheme, history, apply } = setup()
  const before = scheme.items.value
  const version = editor.sceneVersion
  const result = apply({
    kind: 'edit',
    items: [
      {
        itemId: 'a',
        position: { x: 100, y: -50, z: 20 },
        rotation: { x: 0, y: 30, z: 45 },
        scale: { x: 4, y: 5, z: 6 },
      },
      { itemId: 'b', position: { x: 200, y: -50, z: 10 } },
    ],
  })

  expect(result.count).toBe(2)
  expect(result.transactionId).toBeTruthy()
  const [a, b, untouched] = scheme.items.value
  expect(a).not.toBe(before[0])
  expect(a.x).toBe(100)
  expect(a.y).toBe(50)
  expect(a.z).toBe(20)
  expect(a.rotation).toEqual({ x: 0, y: -30, z: 45 })
  expect(a.extra.Scale).toEqual({ X: 5, Y: 4, Z: 6 })
  expect(a.extra.ColorMap).toBe(before[0]!.extra.ColorMap)
  expect(b.rotation).toBe(before[1]!.rotation)
  expect(b.extra).toBe(before[1]!.extra)
  expect(untouched).toBe(before[2])
  expect(editor.sceneVersion).toBe(version + 1)
  expect(scheme.history.value?.transactionUndoStack).toHaveLength(1)
  expect(scheme.history.value?.transactionUndoStack[0]?.transaction.intent).toBe('items.ai_edit')

  history.undo()
  expect(scheme.items.value).toEqual(before)
})

it('places new furniture with shared defaults, allocates IDs inside the transaction and never rewinds them', () => {
  const { scheme, history, apply } = setup()
  const result = apply({
    kind: 'place',
    items: [
      {
        gameId: 42,
        position: { x: 10, y: -20, z: 30 },
        rotation: { x: 0, y: 10, z: 20 },
        scale: { x: 2, y: 3, z: 4 },
      },
      { gameId: 43, position: { x: 0, y: 0, z: 0 } },
    ],
  })

  expect(result.count).toBe(2)
  expect(scheme.items.value).toHaveLength(5)
  const [first, second] = scheme.items.value.slice(3)
  expect(first.gameId).toBe(42)
  expect([first.x, first.y, first.z]).toEqual([10, 20, 30])
  expect(first.rotation).toEqual({ x: 0, y: -10, z: 20 })
  expect(first.extra.Scale).toEqual({ X: 3, Y: 2, Z: 4 })
  expect(first.groupId).toBe(0)
  expect(first.extra.AttachID).toBe(0)
  expect(first.extra.ColorMap).toEqual({ '0': 0 })
  expect(first.instanceId).toBe(1003)
  expect(second.instanceId).toBe(1004)
  expect(second.extra.Scale).toEqual({ X: 1, Y: 1, Z: 1 })
  expect(scheme.maxInstanceId.value).toBe(1004)
  expect(scheme.history.value?.transactionUndoStack[0]?.transaction.intent).toBe('items.ai_place')

  history.undo()
  expect(scheme.items.value).toHaveLength(3)
  expect(scheme.maxInstanceId.value).toBe(1004)
  history.redo()
  expect(scheme.items.value).toHaveLength(5)
})

it('applies world-space relative rotation and scale through the shared transform helpers', () => {
  const { scheme, history, apply } = setup()
  apply({
    kind: 'rotate',
    itemIds: ['a', 'b'],
    delta: { x: 0, y: 0, z: 180 },
    pivot: { x: 50, y: -50, z: 10 },
  })
  expect(scheme.items.value[0]?.x).toBeCloseTo(100)
  expect(scheme.items.value[0]?.y).toBeCloseTo(50)
  expect(scheme.items.value[0]?.z).toBeCloseTo(10)
  expect(scheme.items.value[1]?.x).toBeCloseTo(0)
  expect(scheme.items.value[1]?.y).toBeCloseTo(50)
  expect(scheme.items.value[1]?.z).toBeCloseTo(10)
  apply({
    kind: 'scale',
    itemIds: ['a', 'b'],
    factors: { x: 2, y: 1, z: 1 },
    pivot: { x: 50, y: -50, z: 10 },
  })
  expect(scheme.history.value?.transactionUndoStack).toHaveLength(2)
  expect(history.canUndo()).toBe(true)
})

it('expands catalog combinations instead of creating an invalid parent item', () => {
  const { editor, scheme } = setup()
  const sceneEdit = useEditorSceneEdit({
    isReady: () => true,
    getFurniture: (gameId) => {
      if (gameId === 42 || gameId === 43)
        return {
          name_cn: '成员',
          name_en: 'Member',
          icon: '',
          size: [100, 100, 100],
          scaleRange: [1, 1],
          rotationAllowed: { x: true, y: true, z: true },
          categoryId: 1,
        }
      return gameId === 900
        ? {
            name_cn: '组合',
            name_en: 'Combo',
            icon: '',
            size: [100, 100, 100],
            scaleRange: [1, 1],
            rotationAllowed: { x: true, y: true, z: true },
            categoryId: 1,
            combination: [
              { itemId: 42, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              { itemId: 43, position: [100, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            ],
          }
        : null
    },
    getScaleRange: () => [1, 1],
  })
  const result = sceneEdit.apply(
    { kind: 'place', items: [{ gameId: 900, position: { x: 0, y: 0, z: 0 } }] },
    { schemeId: scheme.id, sceneVersion: editor.sceneVersion }
  )
  expect(result.count).toBe(2)
  expect(scheme.items.value.slice(-2).map((item) => item.gameId)).toEqual([42, 43])
  expect(new Set(scheme.items.value.slice(-2).map((item) => item.groupId)).size).toBe(1)
})

it('duplicates explicit furniture into offset batches in one transaction', () => {
  const { editor, scheme, history, apply } = setup()
  const result = apply({
    kind: 'duplicate',
    itemIds: ['a', 'b'],
    offsets: [
      { x: 100, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 },
    ],
  })
  expect(result.count).toBe(4)
  expect(result.itemIdGroups).toHaveLength(2)
  expect(new Set(scheme.items.value.slice(-4).map((item) => item.instanceId)).size).toBe(4)
  expect(scheme.items.value.slice(-4).map((item) => [item.x, item.y])).toEqual([
    [100, 50],
    [200, 50],
    [0, -50],
    [100, -50],
  ])
  expect(scheme.history.value?.transactionUndoStack).toHaveLength(1)
  expect(editor.sceneVersion).toBeGreaterThan(0)
  history.undo()
  expect(scheme.items.value).toHaveLength(3)
})

it('removes explicit members and invalidates the edit evidence after undo', () => {
  const { scheme, history, apply } = setup()
  const result = apply({ kind: 'remove', itemIds: ['a'] })
  const postcondition = sceneEditPostcondition(scheme, result.itemIds)
  expect(scheme.items.value.map((item) => item.internalId)).toEqual(['b', 'untouched'])
  expect(verifySceneEdit(scheme, postcondition)).toBe(true)

  history.undo()
  expect(verifySceneEdit(scheme, postcondition)).toBe(false)
  // remove_items 的重放把恢复的成员追加到末尾，这是既有事务语义，不保证原顺序。
  expect(scheme.items.value.map((item) => item.internalId).sort()).toEqual(['a', 'b', 'untouched'])
})

it('rejects stale versions, out-of-scope members and non-finite coordinates before committing', () => {
  const { editor, scheme, apply } = setup()
  const original = scheme.items.value
  const staleVersion = editor.sceneVersion
  editor.triggerSceneUpdate()
  expect(() => apply({ kind: 'remove', itemIds: ['a'] }, staleVersion)).toThrow()
  expect(() =>
    apply({ kind: 'edit', items: [{ itemId: 'missing', position: { x: 0, y: 0, z: 0 } }] })
  ).toThrow()
  expect(() =>
    apply({ kind: 'place', items: [{ gameId: 1, position: { x: Infinity, y: 0, z: 0 } }] })
  ).toThrow()
  expect(scheme.items.value).toBe(original)
  expect(scheme.maxInstanceId.value).toBe(1002)
  expect(scheme.history.value?.transactionUndoStack ?? []).toHaveLength(0)
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Box3, Matrix4, Object3D, Vector3 } from 'three'
import type { AppItem } from '@/types/editor'

// gizmoSnapEngine 通过参数接收 store，但 matrixTransform 内部仍会取 pinia store 查家具尺寸。
// 这里统一给出确定性数据，避免测试依赖 public/assets 下的真实游戏数据。
const hoisted = vi.hoisted(() => ({
  modelBox: null as Box3 | null,
  gameData: {
    getFurnitureSize: (): [number, number, number] | null => [100, 100, 10],
    getFurnitureModelConfig: (): { meshes?: unknown[] } | null => null,
  },
}))

vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => hoisted.gameData,
}))

vi.mock('@/composables/useThreeModelManager', () => ({
  getThreeModelManager: () => ({
    getModelBoundingBox: () => hoisted.modelBox,
  }),
}))

const { matrixTransform } = await import('@/lib/matrixTransform')
const { createGizmoSnapEngine } = await import('@/composables/transformGizmo/gizmoSnapEngine')

function item(id: string, x: number, y = 0, gameId = 1): AppItem {
  return {
    internalId: id,
    gameId,
    instanceId: 1,
    x,
    y,
    z: 0,
    rotation: { x: 0, y: 0, z: 0 },
    groupId: 0,
    extra: { Scale: { X: 1, Y: 1, Z: 1 }, AttachID: 0 },
  }
}

function engineFixture(mode: 'box' | 'model' = 'box', modelBox: Box3 | null = null) {
  hoisted.modelBox = modelBox
  hoisted.gameData.getFurnitureModelConfig = () => (modelBox ? { meshes: [{}] } : null)

  const gameDataStore = hoisted.gameData
  const items = [item('m', -160), item('m2', -160, 100), item('t', 0), item('t2', 0, 100)]
  const scheme = {
    items: { value: items },
    selectedItemIds: { value: new Set(['m', 'm2']) },
  } as any

  const editorStore = { gizmoMode: 'translate' } as any
  const settingsStore = {
    settings: { threeDisplayMode: mode, enableSurfaceSnap: true, surfaceSnapThreshold: 20 },
  } as any

  let disabled = false
  const pivot = new Object3D()
  const controls = { axis: 'X' }

  const engine = createGizmoSnapEngine({
    editorStore,
    settingsStore,
    gameDataStore: gameDataStore as any,
    pivotRef: { value: pivot } as any,
    transformRef: { value: { instance: controls } } as any,
    isSnapTemporarilyDisabled: () => disabled,
  })

  const prepare = () => {
    const start = new Map(
      items
        .filter((i) => scheme.selectedItemIds.value.has(i.internalId))
        .map((i) => [i.internalId, matrixTransform.buildWorldMatrixFromItem(i, !!modelBox)])
    )
    engine.prepareCollisionData(scheme, start)
    return start
  }

  const start = prepare()
  const translate = (x: number) =>
    new Map(
      [...start].map(([id, matrix]) => [
        id,
        new Matrix4().makeTranslation(x, 0, 0).multiply(matrix),
      ])
    )

  return {
    engine,
    start,
    translate,
    items,
    scheme,
    prepare,
    controls,
    settingsStore,
    disable: (value: boolean) => {
      disabled = value
    },
  }
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6)
}

describe('createGizmoSnapEngine', () => {
  beforeEach(() => {
    hoisted.modelBox = null
    hoisted.gameData.getFurnitureSize = () => [100, 100, 10]
    hoisted.gameData.getFurnitureModelConfig = () => null
  })

  it('对所有选中矩阵施加同一位移，不修改输入和存档', () => {
    const fixture = engineFixture()
    const original = JSON.stringify(fixture.items)
    const raw = fixture.translate(50)
    const before = JSON.stringify([...raw])

    const result = fixture.engine.applyCollisionSnap(raw)
    near(result.get('m')!.elements[12]!, -100)
    near(result.get('m2')!.elements[12]!, -100)
    near(result.get('m2')!.elements[13]! - result.get('m')!.elements[13]!, -100)

    expect(JSON.stringify([...raw])).toBe(before)
    expect(JSON.stringify(fixture.items)).toBe(original)

    // 重复以同一个原始拖拽位置求解不会累积；后续拖动能释放。
    near(fixture.engine.applyCollisionSnap(raw).get('m')!.elements[12]!, -100)
    const far = fixture.translate(10)
    expect(fixture.engine.applyCollisionSnap(far)).toBe(far)
  })

  it('Ctrl 临时禁用清除保持状态，松开后只按进入阈值重新捕获', () => {
    const fixture = engineFixture()
    fixture.engine.applyCollisionSnap(fixture.translate(50))
    near(fixture.engine.applyCollisionSnap(fixture.translate(35)).get('m')!.elements[12]!, -100)

    fixture.disable(true)
    const raw = fixture.translate(35)
    expect(fixture.engine.applyCollisionSnap(raw)).toBe(raw)

    fixture.disable(false)
    expect(fixture.engine.applyCollisionSnap(raw)).toBe(raw)
  })

  it('模型包围盒偏心、模型回退和普通盒子采用一致的动静边界', () => {
    const cases: Array<['box' | 'model', Box3 | null]> = [
      ['box', null],
      ['model', null],
      ['model', new Box3(new Vector3(-30, -50, 7), new Vector3(70, 50, 17))],
    ]

    for (const [mode, modelBox] of cases) {
      const fixture = engineFixture(mode, modelBox)
      near(fixture.engine.applyCollisionSnap(fixture.translate(50)).get('m')!.elements[12]!, -100)
    }
  })

  it('重新准备选择及清理会话不沿用旧 ID 或目标', () => {
    const fixture = engineFixture()
    fixture.engine.applyCollisionSnap(fixture.translate(50))

    fixture.scheme.selectedItemIds.value = new Set(['t', 't2'])
    const start = fixture.prepare()
    const raw = new Map(
      [...start].map(([id, matrix]) => [
        id,
        new Matrix4().makeTranslation(-50, 0, 0).multiply(matrix),
      ])
    )

    near(fixture.engine.applyCollisionSnap(raw).get('t')!.elements[12]!, -60)

    fixture.engine.clearCollisionData()
    expect(fixture.engine.applyCollisionSnap(raw)).toBe(raw)
  })
})

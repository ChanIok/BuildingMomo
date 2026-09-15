import { describe, expect, it, vi } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { matrixTransform } from '@/lib/matrixTransform'
import { makeAppItem } from '../fixtures/item'

// matrixTransform 内部会取 pinia store 查询家具尺寸；
// 这里给出确定性尺寸，避免测试依赖 public/assets 下的真实游戏数据。
vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => ({
    getFurnitureSize: (gameId: number) => (gameId === 9001 ? ([200, 400, 600] as const) : null),
  }),
}))

/** 去掉父级 Y 翻转，还原出局部矩阵，便于直接断言 Scale 落位。 */
function decomposeLocal(world: Matrix4) {
  const local = matrixTransform.parentFlipMatrix.clone().multiply(world)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  local.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

describe('位置空间转换', () => {
  it('数据空间与世界空间往返一致，且只有 Y 取反', () => {
    const data = { x: 10, y: 20, z: 30 }
    const world = matrixTransform.dataPositionToWorld(data)

    expect(world).toEqual({ x: 10, y: -20, z: 30 })
    expect(matrixTransform.worldPositionToData(world)).toEqual(data)
  })

  it('转换是自逆的', () => {
    for (const point of [
      { x: 0, y: 0, z: 0 },
      { x: -12.5, y: 300, z: -7 },
    ]) {
      expect(
        matrixTransform.worldPositionToData(matrixTransform.dataPositionToWorld(point))
      ).toEqual(point)
    }
  })
})

describe('旋转空间转换', () => {
  it('视觉旋转与数据旋转互转是自逆的，且只有 Y 取反', () => {
    const data = { x: 10, y: 20, z: 30 }
    const visual = matrixTransform.dataRotationToVisual(data)

    expect(visual).toEqual({ x: 10, y: -20, z: 30 })
    expect(matrixTransform.visualRotationToData(visual)).toEqual(data)
  })
})

describe('buildWorldMatrixFromItem', () => {
  it('世界空间对数据 Y 取反，Z 保持不变', () => {
    const item = makeAppItem({ x: 100, y: 200, z: 30 })
    const world = matrixTransform.buildWorldMatrixFromItem(item, false)

    expect(world.elements[12]).toBeCloseTo(100)
    expect(world.elements[13]).toBeCloseTo(-200)
    expect(world.elements[14]).toBeCloseTo(30)
  })

  it('Box 模式：Scale.X 落到局部 Y，Scale.Y 落到局部 X', () => {
    const item = makeAppItem({
      gameId: 9001,
      x: 0,
      y: 0,
      z: 0,
      extra: { Scale: { X: 2, Y: 1, Z: 3 }, AttachID: 0 },
    })
    const { scale } = decomposeLocal(matrixTransform.buildWorldMatrixFromItem(item, false))

    expect(scale.x).toBeCloseTo(1 * 200)
    expect(scale.y).toBeCloseTo(2 * 400)
    expect(scale.z).toBeCloseTo(3 * 600)
  })

  it('Box 模式：查不到家具尺寸时回退默认尺寸', () => {
    const item = makeAppItem({
      gameId: 1,
      extra: { Scale: { X: 1, Y: 1, Z: 1 }, AttachID: 0 },
    })
    const { scale } = decomposeLocal(matrixTransform.buildWorldMatrixFromItem(item, false))

    expect(scale.toArray()).toEqual([100, 100, 150])
  })

  it('Model 模式：只使用用户 Scale，不再乘家具尺寸', () => {
    const item = makeAppItem({
      gameId: 9001,
      extra: { Scale: { X: 2, Y: 1, Z: 3 }, AttachID: 0 },
    })
    const { scale } = decomposeLocal(matrixTransform.buildWorldMatrixFromItem(item, true))

    expect(scale.toArray()).toEqual([1, 2, 3])
  })

  it('构建与还原往返后得到原始数据', () => {
    const item = makeAppItem({
      x: 123,
      y: -45,
      z: 67,
      rotation: { x: 10, y: 20, z: 30 },
      extra: { Scale: { X: 1.5, Y: 2.5, Z: 0.5 }, AttachID: 0 },
    })

    const restored = matrixTransform.extractItemDataFromWorldMatrix(
      matrixTransform.buildWorldMatrixFromItem(item, false)
    )

    expect(restored.x).toBeCloseTo(item.x)
    expect(restored.y).toBeCloseTo(item.y)
    expect(restored.z).toBeCloseTo(item.z)
    expect(restored.rotation.x).toBeCloseTo(item.rotation.x)
    expect(restored.rotation.y).toBeCloseTo(item.rotation.y)
    expect(restored.rotation.z).toBeCloseTo(item.rotation.z)
  })

  it('渲染时 Roll 与 Pitch 取反，Yaw 保持', () => {
    const item = makeAppItem({ rotation: { x: 30, y: 20, z: 10 } })
    const { quaternion } = decomposeLocal(matrixTransform.buildWorldMatrixFromItem(item, false))
    const euler = new Euler().setFromQuaternion(quaternion, 'ZYX')

    // 场景父级 Scale(1, -1, 1) 导致 Roll / Pitch 需要取反才能与游戏内方向一致。
    expect((euler.x * 180) / Math.PI).toBeCloseTo(-30)
    expect((euler.y * 180) / Math.PI).toBeCloseTo(-20)
    expect((euler.z * 180) / Math.PI).toBeCloseTo(10)
  })
})

describe('父级翻转', () => {
  it('applyParentFlip 与矩阵乘法等价', () => {
    const local = new Matrix4().compose(
      new Vector3(10, 20, 30),
      new Quaternion().setFromEuler(new Euler(0.3, -0.4, 0.7, 'ZYX')),
      new Vector3(1, 2, 3)
    )

    const viaMultiply = matrixTransform.parentFlipMatrix.clone().multiply(local)
    const viaFlip = matrixTransform.applyParentFlip(local.clone())

    viaFlip.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(viaMultiply.elements[index]!)
    })
  })

  it('applyParentFlipInPlace 原地修改并返回同一引用', () => {
    const matrix = new Matrix4().makeTranslation(1, 2, 3)
    const returned = matrixTransform.applyParentFlipInPlace(matrix)

    expect(returned).toBe(matrix)
    expect(matrix.elements[13]).toBe(-2)
  })
})

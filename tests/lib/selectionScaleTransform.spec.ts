import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  constrainSelectionScaleFactors,
  scaleItemsAroundPivot,
  setItemsAbsoluteScale,
  visualScaleAxisToDataAxis,
  type ScaleRangeResolver,
} from '@/lib/selectionScaleTransform'
import { makeAppItem } from '../fixtures/item'

/** 所有家具的所有轴都限制在 [0.1, 5]。 */
const uniformRange: ScaleRangeResolver = () => [0.1, 5]

function withScale(scale: { X: number; Y: number; Z: number }) {
  return makeAppItem({ extra: { Scale: scale, AttachID: 0 } })
}

describe('视觉轴到存档轴的映射', () => {
  it('视觉 X/Y 交叉对应存档 Scale.Y/X，Z 保持不变', () => {
    expect(visualScaleAxisToDataAxis('x')).toBe('Y')
    expect(visualScaleAxisToDataAxis('y')).toBe('X')
    expect(visualScaleAxisToDataAxis('z')).toBe('Z')
  })
})

describe('setItemsAbsoluteScale', () => {
  it('调用方只给视觉轴，写入时交叉映射到存档轴', () => {
    const item = withScale({ X: 1, Y: 1, Z: 1 })

    expect(setItemsAbsoluteScale([item], 'x', 3, () => null)[0]!.extra.Scale).toMatchObject({
      X: 1,
      Y: 3,
      Z: 1,
    })
    expect(setItemsAbsoluteScale([item], 'y', 4, () => null)[0]!.extra.Scale).toMatchObject({
      X: 4,
      Y: 1,
      Z: 1,
    })
    expect(setItemsAbsoluteScale([item], 'z', 5, () => null)[0]!.extra.Scale).toMatchObject({
      X: 1,
      Y: 1,
      Z: 5,
    })
  })

  it('生成新的 item、extra、Scale 引用，供引用式事务识别', () => {
    const item = withScale({ X: 1, Y: 1, Z: 1 })
    const next = setItemsAbsoluteScale([item], 'x', 2, () => null)[0]!

    expect(next).not.toBe(item)
    expect(next.extra).not.toBe(item.extra)
    expect(next.extra.Scale).not.toBe(item.extra.Scale)
    expect(item.extra.Scale.Y).toBe(1)
  })

  it('只约束本次设置的轴，不顺带修正其他轴的既有数据', () => {
    // 一个历史上已经越界的数据：Y 轴 100 远超上限。
    const item = withScale({ X: 1, Y: 100, Z: 1 })
    // 视觉 y 对应存档 Scale.X，因此被约束的是 X，越界的 Y 必须原样保留。
    const next = setItemsAbsoluteScale([item], 'y', 99, uniformRange)[0]!

    expect(next.extra.Scale!.X).toBe(5)
    expect(next.extra.Scale!.Y).toBe(100)
  })
})

describe('constrainSelectionScaleFactors', () => {
  it('单轴拖拽只影响该轴，其余保持倍率 1', () => {
    const factors = constrainSelectionScaleFactors(
      { x: 2, y: 2, z: 2 },
      'X',
      [withScale({ X: 1, Y: 1, Z: 1 })],
      uniformRange
    )

    expect(factors).toEqual({ x: 2, y: 1, z: 1 })
  })

  it('按视觉轴对应的存档轴查询范围', () => {
    // 视觉 X 对应存档 Scale.Y，因此约束的是 Y 的当前值 4，上限 5 → 倍率 1.25。
    const item = withScale({ X: 1, Y: 4, Z: 1 })

    expect(
      constrainSelectionScaleFactors({ x: 3, y: 1, z: 1 }, 'X', [item], uniformRange).x
    ).toBeCloseTo(1.25)
    // 视觉 Y 对应存档 Scale.X，当前值 1 → 倍率上限 5。
    expect(
      constrainSelectionScaleFactors({ x: 1, y: 3, z: 1 }, 'Y', [item], uniformRange).y
    ).toBeCloseTo(3)
  })

  it('多选时取所有家具的倍率交集', () => {
    const items = [withScale({ X: 1, Y: 1, Z: 1 }), withScale({ X: 1, Y: 4, Z: 1 })]

    expect(
      constrainSelectionScaleFactors({ x: 9, y: 1, z: 1 }, 'X', items, uniformRange).x
    ).toBeCloseTo(1.25)
  })

  it('没有范围数据表示该家具不参与约束', () => {
    const item = withScale({ X: 1, Y: 1, Z: 1 })

    expect(constrainSelectionScaleFactors({ x: 9, y: 1, z: 1 }, 'X', [item], () => null).x).toBe(9)
  })

  it('等比缩放在三个存档轴上取同一个合法倍率', () => {
    const item = withScale({ X: 1, Y: 4, Z: 1 })
    const factors = constrainSelectionScaleFactors(
      { x: 3, y: 3, z: 3 },
      'XYZ',
      [item],
      uniformRange
    )

    expect(factors.x).toBeCloseTo(1.25)
    expect(factors.y).toBeCloseTo(1.25)
    expect(factors.z).toBeCloseTo(1.25)
  })

  it('已越界的旧数据不会被自动改写，但倍率 1 始终可用', () => {
    const item = withScale({ X: 100, Y: 1, Z: 1 })
    const resolve: ScaleRangeResolver = () => [0.1, 5]

    // Scale.X=100 → 视觉 Y 方向只允许缩小（倍率 ≤ 0.05）或保持 1。
    expect(constrainSelectionScaleFactors({ x: 1, y: 2, z: 1 }, 'Y', [item], resolve).y).toBe(1)
    expect(constrainSelectionScaleFactors({ x: 1, y: 1, z: 1 }, 'Y', [item], resolve).y).toBe(1)
    expect(
      constrainSelectionScaleFactors({ x: 1, y: 0.5, z: 1 }, 'Y', [item], resolve).y
    ).toBeCloseTo(0.5)
  })
})

describe('scaleItemsAroundPivot', () => {
  const identityPivot = new Quaternion()

  it('倍率为 1 时位置与缩放都不变', () => {
    const item = makeAppItem({ x: 100, y: -200, z: 30 })
    const next = scaleItemsAroundPivot([item], new Vector3(0, 0, 0), identityPivot, {
      x: 1,
      y: 1,
      z: 1,
    })[0]!

    expect(next.x).toBe(100)
    expect(next.y).toBe(-200)
    expect(next.z).toBe(30)
    expect(next.extra.Scale).toEqual({ X: 1, Y: 1, Z: 1 })
  })

  it('围绕 Pivot 缩放位置，并按视觉轴写入存档 Scale', () => {
    const item = makeAppItem({
      x: 100,
      y: 0,
      z: 0,
      extra: { Scale: { X: 1, Y: 1, Z: 1 }, AttachID: 0 },
    })
    // Pivot 在数据 (50, 0, 0)，世界空间同样只有 X 偏移。
    const next = scaleItemsAroundPivot([item], new Vector3(50, 0, 0), identityPivot, {
      x: 2,
      y: 1,
      z: 1,
    })[0]!

    expect(next.x).toBeCloseTo(150)
    expect(next.y).toBeCloseTo(0)
    // 视觉 X 的倍率写进存档 Scale.Y。
    expect(next.extra.Scale).toEqual({ X: 1, Y: 2, Z: 1 })
  })

  it('缩放是相对于家具当前 Scale 累积的', () => {
    const item = makeAppItem({
      x: 0,
      y: 0,
      z: 0,
      extra: { Scale: { X: 2, Y: 3, Z: 4 }, AttachID: 0 },
    })
    const next = scaleItemsAroundPivot([item], new Vector3(0, 0, 0), identityPivot, {
      x: 2,
      y: 2,
      z: 2,
    })[0]!

    expect(next.extra.Scale).toEqual({ X: 4, Y: 6, Z: 8 })
  })

  it('每个家具都生成新引用', () => {
    const items = [makeAppItem({ internalId: 'a' }), makeAppItem({ internalId: 'b' })]
    const next = scaleItemsAroundPivot(items, new Vector3(0, 0, 0), identityPivot, {
      x: 2,
      y: 1,
      z: 1,
    })

    expect(next[0]).not.toBe(items[0])
    expect(next[1]).not.toBe(items[1])
    expect(items[0]!.extra.Scale).toEqual({ X: 1, Y: 1, Z: 1 })
  })
})

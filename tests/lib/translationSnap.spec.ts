import { describe, expect, it } from 'vitest'
import { Box3, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB, intersectsOBBAfterTranslation } from '@/lib/collision'
import {
  createTranslationSnapBody,
  solveTranslationSnap,
  type TranslationSnapBody,
} from '@/lib/translationSnap'

type Basis = [Vector3, Vector3, Vector3]

const axes: Basis = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

function basisOf(vectors: Vector3[]): Basis {
  return [vectors[0]!.clone(), vectors[1]!.clone(), vectors[2]!.clone()]
}

function box(id: string, center: number[], half: number[] = [50, 50, 5], basis: Basis = axes) {
  return createTranslationSnapBody(id, new OBB(new Vector3(...center), new Vector3(...half), basis))
}

function snap(
  moving: TranslationSnapBody[],
  targets: TranslationSnapBody[],
  options: Partial<Parameters<typeof solveTranslationSnap>[0]> = {}
) {
  return solveTranslationSnap({
    moving,
    targets,
    movementAxes: [axes[0]],
    threshold: 20,
    ...options,
  })
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6)
}

/** 生成 columns × 10 的地板阵列。 */
function floors(prefix: string, columns: number, xStart: number) {
  return Array.from({ length: columns * 10 }, (_, i) =>
    box(`${prefix}${i}`, [xStart + Math.floor(i / 10) * 100, 50 + (i % 10) * 100, 5])
  )
}

describe('solveTranslationSnap', () => {
  it('2×10 接 4×10，选区整体修正 10，数量和遍历顺序不影响位移', () => {
    const moving = floors('m', 2, -160)
    const targets = floors('t', 4, 50)
    const before = JSON.stringify({ moving, targets })

    near(snap(moving, targets)!.offset.x, 10)
    near(snap([...moving].reverse(), [...targets].reverse())!.offset.x, 10)
    // 求解过程不得修改输入。
    expect(JSON.stringify({ moving, targets })).toBe(before)
  })

  it('45° 法线与世界 X 拖动一次消除全部缝隙', () => {
    const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
    const basis = basisOf(axes.map((a) => a.clone().applyMatrix4(rotation)))
    const moving = box('m', basis[0].clone().multiplyScalar(-160).toArray(), [100, 500, 5], basis)
    const target = box('t', [0, 0, 0], [50, 500, 5], basis)

    const result = snap([moving], [target])!
    near(result.offset.x, 10 * Math.SQRT2)
    near(result.offset.y, 0)
    expect(intersectsOBBAfterTranslation(moving.obb, target.obb, result.offset)).toBe(true)
    // 阈值按沿拖动轴的实际位移判断，法线间隙 10 不代表只需移动 10。
    expect(snap([moving], [target], { threshold: 12 })).toBeNull()
  })

  it('旋转地砖的角接触另一块地砖的边，交换移动物后修正方向相反', () => {
    const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
    const basis = basisOf(axes.map((a) => a.clone().applyMatrix4(rotation)))
    const target = box('b', [0, 0, 0])

    for (const gap of [10, 0.05, 0, -0.05, -10]) {
      const moving = box('a', [50 + 50 * Math.SQRT2 + gap, 0, 0], [50, 50, 5], basis)

      for (const direction of [axes[0], axes[0].clone().negate()]) {
        const options = { movementAxes: [direction] }
        const forward = snap([moving], [target], options)
        const reverse = snap([target], [moving], options)

        expect(forward).not.toBeNull()
        expect(reverse).not.toBeNull()
        near(forward!.offset.x, -gap)
        near(reverse!.offset.x, gap)
        // 交换移动物与目标后，修正量必须严格反号。
        near(forward!.offset.clone().add(reverse!.offset).length(), 0)
      }
    }
  })

  it('移动物自身的面形成接触边界时，也能保持目标并按原始位移释放', () => {
    const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
    const basis = basisOf(axes.map((a) => a.clone().applyMatrix4(rotation)))
    const target = box('a', [60 + 50 * Math.SQRT2, 0, 0], [50, 50, 5], basis)

    const first = snap([box('b', [0, 0, 0])], [target])!
    const options = { preferredContact: first.contact, releaseThreshold: 30 }

    // 保持目标时修正量按当前原始位移计算，与首次接触时的位置无关。
    near(snap([box('b', [-15, 0, 0])], [target], options)!.offset.x, 25)
    near(snap([box('b', [15, 0, 0])], [target], options)!.offset.x, -5)
    expect(snap([box('b', [-21, 0, 0])], [target], options)).toBeNull()
  })

  it('不同三维旋转下双方交换保持对称，包括边对边形成的接触', () => {
    let seed = 4213
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const randomBody = (id: string) => {
      const quaternion = new Quaternion().setFromEuler(
        new Euler(random() * 6, random() * 6, random() * 6)
      )
      return box(
        id,
        [random() * 180, random() * 180, random() * 180],
        [10 + random() * 70, 10 + random() * 70, 10 + random() * 70],
        basisOf(axes.map((axis) => axis.clone().applyQuaternion(quaternion)))
      )
    }

    let contacts = 0
    let edgeContacts = 0

    for (let i = 0; i < 300; i++) {
      const a = randomBody('a')
      const b = randomBody('b')
      const direction = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize()
      const options = { movementAxes: [direction], threshold: 60 }

      const forward = snap([a], [b], options)
      const reverse = snap([b], [a], options)
      expect(!!forward).toBe(!!reverse)
      if (!forward) continue

      contacts++
      // 轴索引 >= 6 表示接触法线来自双方边方向的叉积，即边对边接触。
      if (forward.contact.axis >= 6) edgeContacts++

      near(forward.offset.clone().add(reverse!.offset).length(), 0)
      expect(intersectsOBBAfterTranslation(a.obb, b.obb, forward.offset)).toBe(true)

      const intersectsBefore = intersectsOBBAfterTranslation(a.obb, b.obb, new Vector3())
      const normal = forward.offset.clone().normalize()
      const beyond = forward.offset.clone().addScaledVector(normal, 0.001)
      const before = forward.offset.clone().addScaledVector(normal, -0.001)
      // 边界两侧必须恰好一侧分离、一侧相交，而非仅找到一个穿透位置。
      expect(intersectsOBBAfterTranslation(a.obb, b.obb, beyond)).toBe(!intersectsBefore)
      expect(intersectsOBBAfterTranslation(a.obb, b.obb, before)).toBe(intersectsBefore)
    }

    expect(contacts).toBeGreaterThan(50)
    expect(edgeContacts).toBeGreaterThan(10)
  })

  it('旋转长条多选不使用膨胀的整体包围盒作为接触面', () => {
    const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
    const basis = basisOf(axes.map((a) => a.clone().applyMatrix4(rotation)))
    const rotate = (b: TranslationSnapBody) =>
      createTranslationSnapBody(
        b.id,
        new OBB(b.obb.center.clone().applyMatrix4(rotation), b.obb.halfExtents, basis)
      )

    const result = snap(floors('m', 2, -160).map(rotate), floors('t', 4, 50).map(rotate))!
    near(result.offset.x, 10 * Math.SQRT2)
  })

  it('自定义三维工作轴遵守世界空间方向', () => {
    const rotation = new Quaternion().setFromEuler(new Euler(0.3, -0.4, 0.7, 'ZYX'))
    const basis = basisOf(axes.map((a) => a.clone().applyQuaternion(rotation)))
    const moving = box('m', basis[0].clone().multiplyScalar(-110).toArray(), [50, 50, 5], basis)
    const target = box('t', [0, 0, 0], [50, 50, 5], basis)

    const result = snap([moving], [target], { movementAxes: [basis[0]] })!
    near(result.offset.distanceTo(basis[0].clone().multiplyScalar(10)), 0)
  })

  it('侧面错开的干扰物不能把选区向反方向拉', () => {
    const moving = floors('m', 2, -160)
    const distractor = box('distractor', [-261, 1080, 5])

    near(snap(moving, [distractor, ...floors('t', 4, 50)])!.offset.x, 10)
    expect(snap(moving, [distractor])).toBeNull()
  })

  it('不可达面不产生候选，也不会抢走另一个真实可达目标', () => {
    const moving = box('m', [-60, -51, 0])
    const unreachable = box('u', [50, 50, 0])
    const reachable = box('r', [50, -51, 0])

    const result = snap([moving], [unreachable, reachable])!
    near(result.offset.x, 10)
    expect(result.contact.targetId).toBe('r')
  })

  it('L 形与分散多选的空白区域不产生虚假吸附', () => {
    const moving = [box('a', [-60, 0, 0]), box('b', [-60, 400, 0]), box('c', [-160, 0, 0])]

    expect(snap(moving, [box('t', [50, 200, 0])])).toBeNull()
  })

  it('从接缝两侧、轻微穿透和亚 0.1 间隙均能精确接触', () => {
    for (const gap of [10, 0.05, 0, -0.05, -1, -10]) {
      near(snap([box('m', [-100 - gap, 0, 0])], [box('t', [0, 0, 0])])!.offset.x, gap)
      near(snap([box('m', [100 + gap, 0, 0])], [box('t', [0, 0, 0])])!.offset.x, -gap)
    }
  })

  it('平面拖动返回一个实际接触的完整向量', () => {
    const moving = box('m', [-110, 0, 0])
    const targets = [box('x', [0, 0, 0]), box('y', [-110, 112, 0])]

    const result = snap([moving], targets, { movementAxes: [axes[0], axes[1]] })!
    near(result.offset.x, 10)
    near(result.offset.y, 0)

    const target = targets.find((b) => b.id === result.contact.targetId)!
    expect(intersectsOBBAfterTranslation(moving.obb, target.obb, result.offset)).toBe(true)
  })

  it('保持当前目标，越过接缝仍保持，超过脱离距离后释放', () => {
    const targets = [box('a', [0, 0, 0])]
    const first = snap([box('m', [-110, 0, 0])], targets)!
    const options = { preferredContact: first.contact, releaseThreshold: 30 }

    near(snap([box('m', [-125, 0, 0])], targets, options)!.offset.x, 25)
    near(snap([box('m', [-95, 0, 0])], targets, options)!.offset.x, -5)
    expect(snap([box('m', [-131, 0, 0])], targets, options)).toBeNull()
    // 没有保持目标时，同样的距离根本进不了阈值。
    expect(snap([box('m', [-125, 0, 0])], targets)).toBeNull()

    const competitor = box('b', [-5, 0, 0])
    expect(
      snap([box('m', [-110, 0, 0])], [competitor, ...targets], options)!.contact.targetId
    ).toBe('a')
  })

  it('目标不再有侧面重叠时立即释放', () => {
    const targets = [box('a', [0, 0, 0])]
    const first = snap([box('m', [-110, 0, 0])], targets)!

    expect(
      snap([box('m', [-110, 120, 0])], targets, {
        preferredContact: first.contact,
        releaseThreshold: 30,
      })
    ).toBeNull()
  })

  it('无活动轴或阈值为零不吸附', () => {
    const moving = [box('m', [-110, 0, 0])]
    const targets = [box('t', [0, 0, 0])]

    expect(snap(moving, targets, { movementAxes: [] })).toBeNull()
    expect(snap(moving, targets, { threshold: 0 })).toBeNull()
    expect(snap(moving, targets, { movementAxes: [axes[1]] })).toBeNull()
  })
})

describe('OBB 相交判定', () => {
  it('完整 SAT 与 Three.js OBB 实现在不同三维旋转下保持一致', async () => {
    const { OBB: ThreeOBB } = await import('three/addons/math/OBB.js')

    let seed = 8127
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const randomOBB = () => {
      const quaternion = new Quaternion().setFromEuler(
        new Euler(random() * 6, random() * 6, random() * 6)
      )
      return new OBB(
        new Vector3(random() * 200, random() * 200, random() * 200),
        new Vector3(5 + random() * 100, 5 + random() * 100, 5 + random() * 100),
        basisOf(axes.map((a) => a.clone().applyQuaternion(quaternion)))
      )
    }
    const convert = (obb: OBB, offset: Vector3) =>
      new ThreeOBB(
        obb.center.clone().add(offset),
        obb.halfExtents.clone(),
        new Matrix3().setFromMatrix4(new Matrix4().makeBasis(...obb.axes))
      )

    for (let i = 0; i < 300; i++) {
      const moving = randomOBB()
      const target = randomOBB()
      const offset = new Vector3(random() * 20, random() * 20, random() * 20)

      expect(intersectsOBBAfterTranslation(moving, target, offset)).toBe(
        convert(moving, offset).intersectsOBB(convert(target, new Vector3()))
      )
    }
  })

  it('包围盒粗筛范围不小于精确 OBB', () => {
    const body = box('m', [10, 20, 30])
    const corners = body.obb.getCorners()

    for (const corner of corners) {
      expect(body.bounds.containsPoint(corner)).toBe(true)
    }
    expect(body.bounds).toBeInstanceOf(Box3)
  })
})

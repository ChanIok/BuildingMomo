import { describe, expect, it } from 'vitest'
import {
  convertPositionGlobalToWorking,
  convertPositionWorkingToGlobal,
  convertRotationGlobalToWorking,
  convertRotationWorkingToGlobal,
  type Rotation,
} from '@/lib/coordinateTransform'

const rotations: Rotation[] = [
  { x: 0, y: 0, z: 0 },
  { x: 30, y: 0, z: 0 },
  { x: 0, y: 0, z: 45 },
  { x: 15, y: -25, z: 35 },
]

describe('工作坐标系位置转换', () => {
  it('工作坐标系与全局坐标系往返一致', () => {
    for (const workingRotation of rotations) {
      const point = { x: 120, y: -80, z: 40 }
      const global = convertPositionWorkingToGlobal(point, workingRotation)
      const back = convertPositionGlobalToWorking(global, workingRotation)

      expect(back.x).toBeCloseTo(point.x)
      expect(back.y).toBeCloseTo(point.y)
      expect(back.z).toBeCloseTo(point.z)
    }
  })

  it('零旋转时是恒等变换', () => {
    const point = { x: 1, y: 2, z: 3 }
    expect(convertPositionWorkingToGlobal(point, { x: 0, y: 0, z: 0 })).toEqual(point)
  })

  it('工作坐标系的 Z 角采用与 Gizmo 一致的取反约定', () => {
    // 工作坐标系绕 Z 转 +90°，等价于世界空间绕 Z 转 -90°。
    const global = convertPositionWorkingToGlobal({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 90 })

    expect(global.x).toBeCloseTo(0)
    expect(global.y).toBeCloseTo(-1)
    expect(global.z).toBeCloseTo(0)
  })
})

describe('工作坐标系旋转转换', () => {
  it('工作坐标系与全局坐标系往返一致', () => {
    for (const workingRotation of rotations) {
      const relative: Rotation = { x: 10, y: 20, z: 30 }
      const global = convertRotationWorkingToGlobal(relative, workingRotation)
      const back = convertRotationGlobalToWorking(global, workingRotation)

      expect(back.x).toBeCloseTo(relative.x)
      expect(back.y).toBeCloseTo(relative.y)
      expect(back.z).toBeCloseTo(relative.z)
    }
  })

  it('零工作坐标系时旋转转换是恒等的', () => {
    const relative: Rotation = { x: 10, y: 20, z: 30 }
    const global = convertRotationWorkingToGlobal(relative, { x: 0, y: 0, z: 0 })

    expect(global.x).toBeCloseTo(10)
    expect(global.y).toBeCloseTo(20)
    expect(global.z).toBeCloseTo(30)
  })

  it('工作坐标系只绕 Z 时，绕 Z 的相对旋转直接相加', () => {
    const global = convertRotationWorkingToGlobal({ x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: 45 })

    expect(global.x).toBeCloseTo(0)
    expect(global.y).toBeCloseTo(0)
    expect(global.z).toBeCloseTo(75)
  })
})

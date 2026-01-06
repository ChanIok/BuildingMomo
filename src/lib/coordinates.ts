import { Vector3 } from 'three'

export interface Position2D {
  x: number
  y: number
}

export interface Position3D {
  x: number
  y: number
  z: number
}

/**
 * 3D 坐标系转换工具
 * 处理游戏坐标与 Three.js 世界坐标之间的转换
 *
 * 坐标系映射：
 * 游戏坐标 (x, y, z) = Three.js 世界坐标 (x, y, z)
 * - 现已将 Three.js 全局设置为 Z-up 坐标系，与游戏坐标完全一致
 * - 无需再进行轴交换
 *
 * 注意：由于坐标系已统一，大部分转换都是恒等变换
 * 保留这些方法主要是为了代码可读性和未来可能的坐标系调整
 */
export const coordinates3D = {
  /**
   * 游戏坐标转 Three.js 世界坐标
   */
  gameToThree(gamePos: Position3D): Vector3 {
    return new Vector3(gamePos.x, gamePos.y, gamePos.z)
  },

  /**
   * Three.js 世界坐标转游戏坐标
   */
  threeToGame(threePos: Vector3): Position3D {
    return {
      x: threePos.x,
      y: threePos.y,
      z: threePos.z,
    }
  },

  /**
   * 设置 Three.js Vector3 为游戏坐标值（原地修改）
   */
  setThreeFromGame(target: Vector3, gamePos: Position3D): Vector3 {
    return target.set(gamePos.x, gamePos.y, gamePos.z)
  },
}

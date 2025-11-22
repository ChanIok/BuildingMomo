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
 * 游戏坐标 (x, y, z) -> Three.js 世界坐标 (x, z, y)
 * - 游戏的 Y 轴（前后）-> Three.js 的 Z 轴
 * - 游戏的 Z 轴（高度）-> Three.js 的 Y 轴
 */
export const coordinates3D = {
  /**
   * 游戏坐标转 Three.js 世界坐标
   */
  gameToThree(gamePos: Position3D): Vector3 {
    return new Vector3(gamePos.x, gamePos.z, gamePos.y)
  },

  /**
   * 游戏坐标转 Three.js 世界坐标（原地修改 Vector3）
   */
  gameToThreeMut(gamePos: Position3D, target: Vector3): Vector3 {
    return target.set(gamePos.x, gamePos.z, gamePos.y)
  },

  /**
   * Three.js 世界坐标转游戏坐标
   */
  threeToGame(threePos: Vector3): Position3D {
    return {
      x: threePos.x,
      y: threePos.z,
      z: threePos.y,
    }
  },

  /**
   * 游戏坐标增量转 Three.js 世界坐标增量
   */
  gameDeltaToThreeDelta(gameDelta: Position3D): Position3D {
    return {
      x: gameDelta.x, // X 轴不变
      y: gameDelta.z, // 游戏的 Z 增量 -> Three.js 的 Y 增量
      z: gameDelta.y, // 游戏的 Y 增量 -> Three.js 的 Z 增量
    }
  },

  /**
   * Three.js 世界坐标增量转游戏坐标增量
   */
  threeDeltaToGameDelta(threeDelta: Position3D): Position3D {
    return {
      x: threeDelta.x, // X 轴不变
      y: threeDelta.z, // Three.js 的 Z 增量 -> 游戏的 Y 增量
      z: threeDelta.y, // Three.js 的 Y 增量 -> 游戏的 Z 增量
    }
  },

  /**
   * 设置 Three.js Vector3 为游戏坐标值
   */
  setThreeFromGame(target: Vector3, gamePos: Position3D): Vector3 {
    return target.set(gamePos.x, gamePos.z, gamePos.y)
  },
}

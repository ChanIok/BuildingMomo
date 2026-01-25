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
 * @deprecated 此模块已废弃。
 *
 * 由于 Three.js 已设置为 Z-up 坐标系，与游戏坐标完全一致，
 * 此模块中的所有函数均为恒等变换，无实际作用。
 *
 * 请使用 `matrixTransform.ts` 中的函数代替：
 * - 数据空间 <-> 世界空间：`dataPositionToWorld` / `worldPositionToData`
 * - 旋转转换：`dataRotationToVisual` / `visualRotationToData`
 *
 * 或者使用 `uiStore` 中的便捷 API：
 * - `dataToWorking` / `workingToData` / `workingDeltaToData`
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

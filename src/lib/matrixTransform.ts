import { Matrix4, Vector3, Quaternion, Euler, MathUtils } from 'three'
import type { AppItem } from '@/types/editor'
import { useGameDataStore } from '@/stores/gameDataStore'

const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

/**
 * 矩阵变换工具类
 *
 * 处理游戏数据坐标系与 Three.js 渲染空间之间的矩阵变换
 *
 * 核心概念：
 * - 游戏数据坐标：(x, y, z, Roll, Pitch, Yaw)
 * - Three.js 场景父级应用了 Scale(1, -1, 1) 翻转
 * - 需要在数据和世界矩阵之间进行双向转换
 */
export const matrixTransform = {
  /**
   * 父级翻转矩阵（缓存，避免重复创建）
   * Scale(1, -1, 1) - 其逆矩阵也是自己
   */
  parentFlipMatrix: new Matrix4().makeScale(1, -1, 1),

  /**
   * 从游戏数据构建世界矩阵
   *
   * @param item 游戏物品数据
   * @param hasModelConfig 是否有 3D 模型配置（影响 Scale 计算）
   * @returns 世界空间矩阵
   */
  buildWorldMatrixFromItem(item: AppItem, hasModelConfig: boolean): Matrix4 {
    // 1. Position
    // 游戏坐标直接对应 Three.js Local Space（无需转换，因为已统一 Z-up）
    const pos = new Vector3(item.x, item.y, item.z)

    // 2. Rotation
    // Z-Up Rotation: Yaw is around Z, Pitch around Y, Roll around X
    // 由于场景父级在 Y 轴上做了镜像缩放 ([1, -1, 1])，
    // 为了让编辑器中的 Roll / Pitch 与游戏中的方向一致，这里对 Roll 和 Pitch 取反
    const euler = new Euler(
      (-(item.rotation.x ?? 0) * Math.PI) / 180,
      (-(item.rotation.y ?? 0) * Math.PI) / 180,
      ((item.rotation.z ?? 0) * Math.PI) / 180,
      'ZYX'
    )
    const quat = new Quaternion().setFromEuler(euler)

    // 3. Scale
    // 注意：游戏坐标系中 X/Y 与 Three.js 交换（游戏X=南北→Three.js Y，游戏Y=东西→Three.js X）
    // 因此：Scale.X 应用到 World Y (即 Local Y)，Scale.Y 应用到 World X (即 Local X)
    const scaleData = item.extra?.Scale

    let scale: Vector3
    if (hasModelConfig) {
      // Model 模式：只使用用户的 Scale 参数（模型已包含实际尺寸）
      scale = new Vector3(scaleData?.Y ?? 1, scaleData?.X ?? 1, scaleData?.Z ?? 1)
    } else {
      // Box 模式：Scale * furnitureSize
      const gameDataStore = useGameDataStore()
      const furnitureSize = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      const [sizeX, sizeY, sizeZ] = furnitureSize
      scale = new Vector3(
        (scaleData?.Y ?? 1) * sizeX, // Local X 使用 Scale.Y
        (scaleData?.X ?? 1) * sizeY, // Local Y 使用 Scale.X
        (scaleData?.Z ?? 1) * sizeZ
      )
    }

    // 4. Compose Local Matrix
    const localMatrix = new Matrix4().compose(pos, quat, scale)

    // 5. Convert to World Matrix (Apply Parent Scale 1, -1, 1)
    // World = Parent * Local
    return this.parentFlipMatrix.clone().multiply(localMatrix)
  },

  /**
   * 从世界矩阵还原到游戏数据
   *
   * @param worldMatrix 世界空间矩阵
   * @returns 游戏数据格式 { x, y, z, rotation }
   */
  extractItemDataFromWorldMatrix(worldMatrix: Matrix4): {
    x: number
    y: number
    z: number
    rotation: { x: number; y: number; z: number }
  } {
    // 逆向计算回 Local Space
    // Local = ParentInverse * World
    // ParentInverse = Scale(1, -1, 1) (自逆矩阵)
    const localMatrix = this.parentFlipMatrix.clone().multiply(worldMatrix)

    const pos = new Vector3()
    const quat = new Quaternion()
    const scale = new Vector3()
    localMatrix.decompose(pos, quat, scale)

    const euler = new Euler().setFromQuaternion(quat, 'ZYX')

    // 还原到数据格式
    // 渲染时使用了 -Rx, -Ry, Rz
    // 所以：Data.x = -Visual.x, Data.y = -Visual.y, Data.z = Visual.z
    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rotation: {
        x: -MathUtils.radToDeg(euler.x),
        y: -MathUtils.radToDeg(euler.y),
        z: MathUtils.radToDeg(euler.z),
      },
    }
  },

  /**
   * 手动应用父级翻转到矩阵（用于性能优化场景）
   * 直接修改矩阵元素，避免矩阵乘法
   *
   * @param matrix 要修改的矩阵（会被原地修改）
   * @returns 修改后的矩阵（同一个引用）
   */
  applyParentFlipInPlace(matrix: Matrix4): Matrix4 {
    // Matrix4 elements are column-major.
    // Row 1 (Index 1, 5, 9, 13) needs to be negated to apply Scale(1, -1, 1)
    const el = matrix.elements
    el[1] = -el[1]
    el[5] = -el[5]
    el[9] = -el[9]
    el[13] = -el[13]
    return matrix
  },

  /**
   * 克隆并应用父级翻转
   *
   * @param matrix 源矩阵
   * @returns 新的翻转后的矩阵
   */
  applyParentFlip(matrix: Matrix4): Matrix4 {
    return this.applyParentFlipInPlace(matrix.clone())
  },

  /**
   * 将数据空间旋转转换为视觉空间旋转（补偿渲染管线的 X/Y 取反）
   *
   * 变换逻辑：Y 轴取反（Scale(1, -1, 1)）会导致 Quaternion 变换
   * 等效于：x' = x, y' = -y, z' = z
   */
  dataRotationToVisual(rotation: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    return {
      x: rotation.x,
      y: -rotation.y,
      z: rotation.z,
    }
  },

  /**
   * 将视觉空间旋转转换为数据空间旋转（逆变换）
   *
   * 变换逻辑：x' = x, y' = -y, z' = z (自逆变换)
   */
  visualRotationToData(rotation: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    return {
      x: rotation.x,
      y: -rotation.y,
      z: rotation.z,
    }
  },

  /**
   * 将 UI 输入值转换为视觉空间旋转
   * (UI 输入通常直接对应 Data Space，但在 Coordinate 系统中我们希望用户输入的是 Data Space 的值，
   *  但存储为 Visual Space 给 Gizmo 用，或者反之。
   *  目前的设计是：UI/Gizmo 使用 "Visual Space"，而存储使用 "Data Space"。
   *  所以从 UI (Visual) 到 Data，使用 visualRotationToData)
   *
   * 别名，为了语义清晰
   */
  visualRotationToUI(visualRotation: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    return this.visualRotationToData(visualRotation)
  },
}

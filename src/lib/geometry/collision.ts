import {
  Vector3,
  Matrix4,
  Box3,
  LineSegments,
  BufferGeometry,
  LineBasicMaterial,
  Color,
  Float32BufferAttribute,
} from 'three'

/**
 * 从世界矩阵计算轴对齐包围盒（AABB）
 *
 * 坐标系约定：
 * - X/Y 轴：原点在几何中心（向两侧延伸）
 * - Z 轴：原点在底部（向上延伸）
 *   与 BoxGeometry.translate(0, 0, 0.5) 渲染一致
 *
 * 实现说明：
 * - 使用 Box3.applyMatrix4 正确处理旋转
 * - 将局部空间包围盒的 8 个角点变换到世界空间，然后计算 AABB
 * - 修复了旋转物体吸附位置错误的问题
 *
 * @param matrix 世界矩阵（包含位置、旋转、缩放）
 * @param baseSize 基础几何体尺寸（通常为 1,1,1，因为实际尺寸已编码在矩阵 scale 中）
 * @returns 轴对齐包围盒
 */
export function getAABBFromMatrix(matrix: Matrix4, baseSize: Vector3): Box3 {
  // X/Y 轴：原点在中心，向两侧延伸
  const halfX = baseSize.x / 2
  const halfY = baseSize.y / 2

  // 构建局部空间的包围盒
  // Z 轴：原点在底部 (0)，向上延伸到 baseSize.z
  const localBox = new Box3(new Vector3(-halfX, -halfY, 0), new Vector3(+halfX, +halfY, baseSize.z))

  // 应用完整的变换矩阵（包括旋转）
  // Box3.applyMatrix4 内部会变换 8 个角点，然后重新计算 AABB
  return localBox.applyMatrix4(matrix)
}

/**
 * 从世界矩阵和模型包围盒计算 AABB
 * 用于 Model 模式（使用模型实际形状）
 *
 * @param matrix 世界矩阵
 * @param modelBox 模型空间的包围盒（从 geometry.boundingBox 获取）
 * @returns 世界空间的轴对齐包围盒
 */
export function getAABBFromMatrixAndModelBox(matrix: Matrix4, modelBox: Box3): Box3 {
  const worldBox = modelBox.clone()
  worldBox.applyMatrix4(matrix)
  return worldBox
}

/**
 * 计算多个包围盒的合并结果
 *
 * @param boxes 包围盒数组
 * @returns 合并后的包围盒
 */
export function mergeBoxes(boxes: Box3[]): Box3 {
  if (boxes.length === 0) {
    return new Box3()
  }

  const merged = boxes[0]!.clone()
  for (let i = 1; i < boxes.length; i++) {
    const box = boxes[i]
    if (box) {
      merged.union(box)
    }
  }
  return merged
}

/**
 * OBB (Oriented Bounding Box) - 定向包围盒
 *
 * 与 AABB 不同，OBB 可以旋转，能更精确地包围旋转后的物体
 *
 * 结构：
 * - center: 中心点（世界空间）
 * - halfExtents: 半尺寸（局部空间）
 * - axes: 三个局部坐标轴（世界空间单位向量）
 */
export class OBB {
  center: Vector3
  halfExtents: Vector3
  axes: [Vector3, Vector3, Vector3]

  constructor(center: Vector3, halfExtents: Vector3, axes: [Vector3, Vector3, Vector3]) {
    this.center = center
    this.halfExtents = halfExtents
    this.axes = axes
  }

  /**
   * 获取 OBB 的 8 个角点（世界空间）
   *
   * @param out 可选的输出数组，用于对象复用。如果提供，必须包含至少 8 个 Vector3 对象。
   *            如果不提供，会创建新数组（性能较低）。
   * @returns 包含 8 个角点的数组（如果提供 out 参数，则返回 out）
   */
  getCorners(out?: Vector3[]): Vector3[] {
    const { center, halfExtents, axes } = this

    // 如果没有提供输出数组，创建新数组（兼容旧代码）
    const corners = out || []
    if (!out) {
      for (let i = 0; i < 8; i++) {
        corners.push(new Vector3())
      }
    }

    for (let i = 0; i < 8; i++) {
      const signX = i & 1 ? 1 : -1
      const signY = i & 2 ? 1 : -1
      const signZ = i & 4 ? 1 : -1

      // 直接计算角点位置，避免多次 clone()
      corners[i]!.copy(center)
      corners[i]!.addScaledVector(axes[0], signX * halfExtents.x)
      corners[i]!.addScaledVector(axes[1], signY * halfExtents.y)
      corners[i]!.addScaledVector(axes[2], signZ * halfExtents.z)
    }

    return corners
  }

  /**
   * 获取保守的 AABB（用于快速剔除）
   */
  getAABB(): Box3 {
    const corners = this.getCorners()
    const aabb = new Box3()
    for (const corner of corners) {
      aabb.expandByPoint(corner)
    }
    return aabb
  }
}

/**
 * 从世界矩阵创建 OBB
 *
 * @param matrix 世界矩阵
 * @param baseSize 基础尺寸（局部空间）
 * @param applyZOffset 是否应用 Z 轴底部原点偏移（默认 true）- 已废弃，保留用于兼容性
 * @returns OBB 实例
 */
export function getOBBFromMatrix(
  matrix: Matrix4,
  baseSize: Vector3,
  _applyZOffset: boolean = true
): OBB {
  // 1. 提取缩放
  const scale = new Vector3().setFromMatrixScale(matrix)

  // 2. 提取旋转矩阵
  const rotationMatrix = new Matrix4().extractRotation(matrix)

  // 3. 计算局部坐标轴（世界空间单位向量）
  const xAxis = new Vector3(1, 0, 0).applyMatrix4(rotationMatrix).normalize()
  const yAxis = new Vector3(0, 1, 0).applyMatrix4(rotationMatrix).normalize()
  const zAxis = new Vector3(0, 0, 1).applyMatrix4(rotationMatrix).normalize()

  // 4. 计算半尺寸
  const halfX = (baseSize.x * scale.x) / 2
  const halfY = (baseSize.y * scale.y) / 2
  const halfZ = (baseSize.z * scale.z) / 2

  // 5. 计算世界中心
  // 复用 AABB 的中心计算逻辑，确保旋转后中心位置正确
  const aabb = getAABBFromMatrix(matrix, baseSize)
  const worldCenter = new Vector3()
  aabb.getCenter(worldCenter)

  return new OBB(worldCenter, new Vector3(halfX, halfY, halfZ), [xAxis, yAxis, zAxis])
}

/**
 * 从世界矩阵和模型包围盒创建 OBB
 *
 * @param matrix 世界矩阵
 * @param modelBox 模型局部包围盒
 * @returns OBB 实例
 */
export function getOBBFromMatrixAndModelBox(matrix: Matrix4, modelBox: Box3): OBB {
  // 1. 获取模型局部空间的包围盒信息
  const localCenter = new Vector3()
  modelBox.getCenter(localCenter)

  const size = new Vector3()
  modelBox.getSize(size)

  // 2. 将局部中心变换到世界空间
  const worldCenter = localCenter.applyMatrix4(matrix)

  // 3. 提取缩放和旋转
  const scale = new Vector3().setFromMatrixScale(matrix)
  const rotationMatrix = new Matrix4().extractRotation(matrix)

  // 4. 计算局部坐标轴（世界空间单位向量）
  const xAxis = new Vector3(1, 0, 0).applyMatrix4(rotationMatrix).normalize()
  const yAxis = new Vector3(0, 1, 0).applyMatrix4(rotationMatrix).normalize()
  const zAxis = new Vector3(0, 0, 1).applyMatrix4(rotationMatrix).normalize()

  // 5. 计算半尺寸（模型包围盒的尺寸已经是实际尺寸，需要应用scale）
  const halfX = (size.x * scale.x) / 2
  const halfY = (size.y * scale.y) / 2
  const halfZ = (size.z * scale.z) / 2

  return new OBB(worldCenter, new Vector3(halfX, halfY, halfZ), [xAxis, yAxis, zAxis])
}

/**
 * 从局部尺寸信息和世界矩阵快速生成 OBB
 *
 * 🚀 性能优化：用于增量更新选中物品的 OBB，避免每帧重新查询模型包围盒
 *
 * @param matrix 世界矩阵
 * @param localSize 局部空间的尺寸（不包含缩放）
 * @param localCenter 局部空间的中心偏移（可选，默认为原点）
 * @returns OBB 实例
 */
export function transformOBBByMatrix(
  matrix: Matrix4,
  localSize: Vector3,
  localCenter: Vector3 = new Vector3()
): OBB {
  // 1. 将局部中心变换到世界空间
  const worldCenter = localCenter.clone().applyMatrix4(matrix)

  // 2. 提取缩放和旋转
  const scale = new Vector3().setFromMatrixScale(matrix)
  const rotationMatrix = new Matrix4().extractRotation(matrix)

  // 3. 计算局部坐标轴（世界空间单位向量）
  const xAxis = new Vector3(1, 0, 0).applyMatrix4(rotationMatrix).normalize()
  const yAxis = new Vector3(0, 1, 0).applyMatrix4(rotationMatrix).normalize()
  const zAxis = new Vector3(0, 0, 1).applyMatrix4(rotationMatrix).normalize()

  // 4. 计算半尺寸（应用缩放）
  const halfX = (localSize.x * scale.x) / 2
  const halfY = (localSize.y * scale.y) / 2
  const halfZ = (localSize.z * scale.z) / 2

  return new OBB(worldCenter, new Vector3(halfX, halfY, halfZ), [xAxis, yAxis, zAxis])
}

/**
 * 合并多个 OBB 为一个保守的 OBB
 *
 * 支持两种模式：
 * 1. 默认模式：返回包含所有 OBB 的 AABB 再转换为轴对齐的 OBB
 * 2. 参照坐标系模式：在指定的坐标系下计算包围盒，支持工作坐标系等非轴对齐的合并
 *
 * @param obbs OBB 数组
 * @param referenceAxes 可选的参照坐标系轴（三个正交的单位向量）
 * @returns 合并后的 OBB
 */
export function mergeOBBs(obbs: OBB[], referenceAxes?: [Vector3, Vector3, Vector3]): OBB {
  if (obbs.length === 0) {
    return new OBB(new Vector3(), new Vector3(), [
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ])
  }

  // 如果提供了参照坐标系，在该坐标系下计算包围盒
  if (referenceAxes) {
    // 收集所有 OBB 的角点
    const allCorners: Vector3[] = []
    for (const obb of obbs) {
      const corners = obb.getCorners()
      allCorners.push(...corners)
    }

    // 在参照坐标系的每个轴上计算投影范围
    let minX = Infinity,
      maxX = -Infinity
    let minY = Infinity,
      maxY = -Infinity
    let minZ = Infinity,
      maxZ = -Infinity

    for (const corner of allCorners) {
      const projX = corner.dot(referenceAxes[0])
      const projY = corner.dot(referenceAxes[1])
      const projZ = corner.dot(referenceAxes[2])

      minX = Math.min(minX, projX)
      maxX = Math.max(maxX, projX)
      minY = Math.min(minY, projY)
      maxY = Math.max(maxY, projY)
      minZ = Math.min(minZ, projZ)
      maxZ = Math.max(maxZ, projZ)
    }

    // 计算在参照坐标系下的半尺寸
    const halfExtents = new Vector3((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2)

    // 计算中心在参照坐标系下的坐标
    const centerInRef = new Vector3((maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2)

    // 将中心从参照坐标系转换回世界坐标系
    const center = new Vector3()
      .addScaledVector(referenceAxes[0], centerInRef.x)
      .addScaledVector(referenceAxes[1], centerInRef.y)
      .addScaledVector(referenceAxes[2], centerInRef.z)

    return new OBB(center, halfExtents, referenceAxes)
  }

  // 默认模式：计算包含所有 OBB 的 AABB
  const aabb = new Box3()
  for (const obb of obbs) {
    const corners = obb.getCorners()
    for (const corner of corners) {
      aabb.expandByPoint(corner)
    }
  }

  // 将 AABB 转换为轴对齐的 OBB
  const center = new Vector3()
  aabb.getCenter(center)

  const size = new Vector3()
  aabb.getSize(size)

  return new OBB(center, size.multiplyScalar(0.5), [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ])
}

/** 判断平移后的 OBB 是否有面与面接触，排除仅有边或角的接触。 */
export function hasOBBFaceContactAfterTranslation(
  moving: OBB,
  target: OBB,
  offset: Vector3,
  tolerance = 1e-6
): boolean {
  const delta = target.center.clone().sub(moving.center).sub(offset)
  for (let i = 0; i < 3; i++) {
    const normal = moving.axes[i]!
    for (let j = 0; j < 3; j++) {
      if (new Vector3().crossVectors(normal, target.axes[j]!).lengthSq() > 1e-12) continue
      const separation = Math.abs(delta.dot(normal))
      const radius = moving.halfExtents.getComponent(i) + target.halfExtents.getComponent(j)
      if (Math.abs(separation - radius) > tolerance) continue

      // 共面矩形在双方四条面内轴上都严格重叠，等价于交集有正面积。
      // 无需构建交集多边形；容差排除浮点误差产生的极窄伪接触。
      const tangents = [
        ...moving.axes.filter((_, index) => index !== i),
        ...target.axes.filter((_, index) => index !== j),
      ]
      if (
        tangents.every(
          (axis) =>
            getOBBProjectionRadius(moving, axis) +
              getOBBProjectionRadius(target, axis) -
              Math.abs(delta.dot(axis)) >
            tolerance
        )
      )
        return true
    }
  }
  return false
}

/** OBB 在单位轴上的投影半径，不需要生成角点。 */
export function getOBBProjectionRadius(obb: OBB, axis: Vector3): number {
  return (
    Math.abs(obb.axes[0].dot(axis)) * obb.halfExtents.x +
    Math.abs(obb.axes[1].dot(axis)) * obb.halfExtents.y +
    Math.abs(obb.axes[2].dot(axis)) * obb.halfExtents.z
  )
}

/** 双方的面法线及边方向叉积；保留平行边的零向量，使轴索引在平移期间稳定。 */
export function getOBBSeparatingAxes(moving: OBB, target: OBB): Vector3[] {
  const axes = [...target.axes, ...moving.axes]
  for (const movingAxis of moving.axes) {
    for (const targetAxis of target.axes) {
      const cross = new Vector3().crossVectors(movingAxis, targetAxis)
      if (cross.lengthSq() < 1e-12) cross.set(0, 0, 0)
      else cross.normalize()
      axes.push(cross)
    }
  }
  return axes
}

/** 完整的 15 轴 SAT 检查；接触算相交，offset 只应用于 moving，不修改输入。 */
export function intersectsOBBAfterTranslation(
  moving: OBB,
  target: OBB,
  offset: Vector3,
  tolerance = 1e-6
): boolean {
  const centerDelta = moving.center.clone().add(offset).sub(target.center)
  const separated = (axis: Vector3) =>
    Math.abs(centerDelta.dot(axis)) >
    getOBBProjectionRadius(moving, axis) + getOBBProjectionRadius(target, axis) + tolerance

  for (const axis of getOBBSeparatingAxes(moving, target)) if (separated(axis)) return false
  return true
}

/**
 * OBB 可视化辅助对象
 *
 * 类似于 Box3Helper，但用于绘制 OBB（定向包围盒）
 * 绘制 12 条边连接 8 个角点
 */
export class OBBHelper extends LineSegments {
  obb: OBB

  constructor(obb: OBB, color: Color = new Color(0xffff00)) {
    const geometry = new BufferGeometry()
    const material = new LineBasicMaterial({ color, toneMapped: false })

    super(geometry, material)

    this.obb = obb

    this.updateGeometry()
  }

  /**
   * 更新几何体（当 OBB 改变时调用）
   */
  updateGeometry() {
    const corners = this.obb.getCorners()

    // 定义 12 条边的索引对（立方体的 12 条边）
    const indices = [
      // 底面 4 条边
      0, 1, 1, 3, 3, 2, 2, 0,
      // 顶面 4 条边
      4, 5, 5, 7, 7, 6, 6, 4,
      // 垂直 4 条边
      0, 4, 1, 5, 2, 6, 3, 7,
    ]

    // 构建顶点数组
    const positions: number[] = []
    for (let i = 0; i < indices.length; i++) {
      const corner = corners[indices[i]!]
      if (corner) {
        positions.push(corner.x, corner.y, corner.z)
      }
    }

    this.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    this.geometry.computeBoundingSphere()
  }

  /**
   * 清理资源
   */
  dispose() {
    this.geometry.dispose()
    ;(this.material as LineBasicMaterial).dispose()
  }
}

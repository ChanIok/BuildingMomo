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
 * 计算吸附向量：双向检测吸附逻辑
 *
 * 策略：
 * 1. 每个轴同时检测两个对立的面（min 和 max）
 * 2. 选择距离最近且在阈值范围内的面进行吸附
 * 3. 无论从哪个方向移动，都能自动找到最合适的对齐面
 * 4. 只在 enabledAxes 指定的轴上进行吸附（尊重 Gizmo 的轴约束）
 *
 * 优势：
 * - 解决了从重叠状态拖出时无法吸附的问题
 * - 无需考虑移动方向，用户体验更好
 * - 符合游戏编辑器的使用习惯
 * - 只影响正在拖动的轴，不会干扰其他轴
 *
 * @param movingBox 移动物体的包围盒
 * @param staticBox 静止物体的包围盒
 * @param snapThreshold 吸附触发距离阈值
 * @param enabledAxes 启用吸附的轴，默认全部启用 { x: true, y: true, z: true }
 * @returns 吸附向量，未触发吸附返回 null
 */
export function calculateSnapVector(
  movingBox: Box3,
  staticBox: Box3,
  snapThreshold: number,
  enabledAxes: { x: boolean; y: boolean; z: boolean } = { x: true, y: true, z: true }
): Vector3 | null {
  const snapVector = new Vector3()
  let hasSnap = false

  // ✅ X 轴：双向检测，选择距离最近的面（仅当该轴启用时）
  if (enabledAxes.x) {
    // 🔍 预检查：其他轴（Y、Z）必须有重叠，才允许X轴吸附
    // 这样可以避免物体只是从旁边"路过"就被吸住
    const yOverlap =
      Math.min(movingBox.max.y, staticBox.max.y) - Math.max(movingBox.min.y, staticBox.min.y)
    const zOverlap =
      Math.min(movingBox.max.z, staticBox.max.z) - Math.max(movingBox.min.z, staticBox.min.z)

    // 只有当Y和Z都有重叠时（或至少边界接触，容忍0.1的误差），才检测X轴吸附
    if (yOverlap >= -0.1 && zOverlap >= -0.1) {
      const distToLeftFace = Math.abs(staticBox.min.x - movingBox.max.x) // 吸附到左侧面
      const distToRightFace = Math.abs(staticBox.max.x - movingBox.min.x) // 吸附到右侧面

      if (distToLeftFace < distToRightFace && distToLeftFace <= snapThreshold) {
        // 吸附到 staticBox 的左侧面 (min.x)
        // movingBox.max.x → staticBox.min.x
        snapVector.x = staticBox.min.x - movingBox.max.x
        hasSnap = true
      } else if (distToRightFace <= snapThreshold) {
        // 吸附到 staticBox 的右侧面 (max.x)
        // movingBox.min.x → staticBox.max.x
        snapVector.x = staticBox.max.x - movingBox.min.x
        hasSnap = true
      }
    }
  }

  // ✅ Y 轴：双向检测，选择距离最近的面（仅当该轴启用时）
  if (enabledAxes.y) {
    // 🔍 预检查：其他轴（X、Z）必须有重叠
    const xOverlap =
      Math.min(movingBox.max.x, staticBox.max.x) - Math.max(movingBox.min.x, staticBox.min.x)
    const zOverlap =
      Math.min(movingBox.max.z, staticBox.max.z) - Math.max(movingBox.min.z, staticBox.min.z)

    if (xOverlap >= -0.1 && zOverlap >= -0.1) {
      const distToBottomFace = Math.abs(staticBox.min.y - movingBox.max.y) // 吸附到底部
      const distToTopFace = Math.abs(staticBox.max.y - movingBox.min.y) // 吸附到顶部

      if (distToBottomFace < distToTopFace && distToBottomFace <= snapThreshold) {
        // 吸附到 staticBox 的底部 (min.y)
        snapVector.y = staticBox.min.y - movingBox.max.y
        hasSnap = true
      } else if (distToTopFace <= snapThreshold) {
        // 吸附到 staticBox 的顶部 (max.y)
        snapVector.y = staticBox.max.y - movingBox.min.y
        hasSnap = true
      }
    }
  }

  // ✅ Z 轴：双向检测，选择距离最近的面（高度）（仅当该轴启用时）
  if (enabledAxes.z) {
    // 🔍 预检查：其他轴（X、Y）必须有重叠
    const xOverlap =
      Math.min(movingBox.max.x, staticBox.max.x) - Math.max(movingBox.min.x, staticBox.min.x)
    const yOverlap =
      Math.min(movingBox.max.y, staticBox.max.y) - Math.max(movingBox.min.y, staticBox.min.y)

    if (xOverlap >= -0.1 && yOverlap >= -0.1) {
      const distToLowerFace = Math.abs(staticBox.min.z - movingBox.max.z) // 吸附到下表面
      const distToUpperFace = Math.abs(staticBox.max.z - movingBox.min.z) // 吸附到上表面

      if (distToLowerFace < distToUpperFace && distToLowerFace <= snapThreshold) {
        // 吸附到 staticBox 的下表面 (min.z)
        snapVector.z = staticBox.min.z - movingBox.max.z
        hasSnap = true
      } else if (distToUpperFace <= snapThreshold) {
        // 吸附到 staticBox 的上表面 (max.z)
        snapVector.z = staticBox.max.z - movingBox.min.z
        hasSnap = true
      }
    }
  }

  return hasSnap ? snapVector : null
}

// ==================== OBB（定向包围盒）实现 ====================

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
   */
  getCorners(): Vector3[] {
    const corners: Vector3[] = []
    const { center, halfExtents, axes } = this

    for (let i = 0; i < 8; i++) {
      const corner = center.clone()
      const signX = i & 1 ? 1 : -1
      const signY = i & 2 ? 1 : -1
      const signZ = i & 4 ? 1 : -1

      corner.add(axes[0].clone().multiplyScalar(signX * halfExtents.x))
      corner.add(axes[1].clone().multiplyScalar(signY * halfExtents.y))
      corner.add(axes[2].clone().multiplyScalar(signZ * halfExtents.z))

      corners.push(corner)
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
 * 合并多个 OBB 为一个保守的 OBB
 *
 * 注意：这是一个简化实现，返回包含所有 OBB 的 AABB 再转换为轴对齐的 OBB
 *
 * @param obbs OBB 数组
 * @returns 合并后的 OBB
 */
export function mergeOBBs(obbs: OBB[]): OBB {
  if (obbs.length === 0) {
    return new OBB(new Vector3(), new Vector3(), [
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ])
  }

  // 计算包含所有 OBB 的 AABB
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

/**
 * 计算点在轴上的投影范围
 */
function projectOBBOnAxis(obb: OBB, axis: Vector3): { min: number; max: number } {
  const corners = obb.getCorners()
  let min = Infinity
  let max = -Infinity

  for (const corner of corners) {
    const projection = corner.dot(axis)
    min = Math.min(min, projection)
    max = Math.max(max, projection)
  }

  return { min, max }
}

/**
 * 使用分离轴定理（SAT）计算 OBB vs OBB 吸附向量
 *
 * 策略：
 * 1. 只测试静态物体的面法线（3 个轴）
 *    - 吸附的本质是"贴到目标表面"，移动物体的朝向不应影响吸附行为
 * 2. 对于每个轴，计算两个 OBB 的投影范围
 * 3. 找到最小间隙的轴，计算吸附向量
 * 4. 将吸附向量投影到 Gizmo 允许的移动轴上
 *
 * @param movingOBB 移动物体的 OBB
 * @param staticOBB 静止物体的 OBB（吸附目标）
 * @param snapThreshold 吸附阈值
 * @param enabledAxes 启用的世界轴（Gizmo 约束）
 * @returns 吸附向量，或 null
 */
export function calculateOBBSnapVector(
  movingOBB: OBB,
  staticOBB: OBB,
  snapThreshold: number,
  _enabledAxes?: { x: boolean; y: boolean; z: boolean } // 保留用于未来扩展，当前由调用方处理轴约束
): Vector3 | null {
  // 收集需要测试的分离轴：只使用静态物体的面法线
  // 吸附的本质是"贴到目标表面"，移动物体的朝向不应影响"吸到哪里"
  const testAxes: Vector3[] = []

  // 只添加静态物体的局部轴（它的表面法线）
  for (const axis of staticOBB.axes) {
    testAxes.push(axis.clone().normalize())
  }

  // staticOBB 的三个轴本身就是正交的，不需要去重
  const uniqueAxes = testAxes

  // 查找最小间隙的轴
  let bestAxis: Vector3 | null = null
  let bestGap = Infinity
  let bestCorrection = 0

  for (const axis of uniqueAxes) {
    // 计算两个 OBB 在该轴上的投影
    const proj1 = projectOBBOnAxis(movingOBB, axis)
    const proj2 = projectOBBOnAxis(staticOBB, axis)

    // 计算重叠或间隙
    const overlap = Math.min(proj1.max, proj2.max) - Math.max(proj1.min, proj2.min)
    const gap = -overlap

    // 只关注有间隙且在阈值内的情况
    if (gap > 0 && gap <= snapThreshold && gap < bestGap) {
      bestGap = gap
      bestAxis = axis

      // 决定吸附方向
      if (proj1.max < proj2.min) {
        // moving 在 static 的负方向
        bestCorrection = proj2.min - proj1.max
      } else if (proj1.min > proj2.max) {
        // moving 在 static 的正方向
        bestCorrection = proj2.max - proj1.min
      }
    }
  }

  if (!bestAxis) {
    return null // 没有找到合适的吸附轴
  }

  // 计算吸附向量（在最佳轴方向）
  // 直接返回原始吸附向量，不做 enabledAxes 过滤
  // 投影约束由调用方（applyCollisionSnap）统一处理
  // 这样可以避免吸附力被多次投影而削弱
  const snapDirection = bestAxis.clone().multiplyScalar(bestCorrection)

  return snapDirection.length() > 0.1 ? snapDirection : null
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

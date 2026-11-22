import { Matrix4, Euler, Vector3, Quaternion } from 'three'

/**
 * 坐标转换工具库
 *
 * 提供工作坐标系（Working Coordinate System）与全局坐标系之间的转换
 * 包括位置转换（使用矩阵）和旋转转换（使用四元数）
 */

// ========== 类型定义 ==========

export interface Rotation {
  x: number
  y: number
  z: number
}

export interface Position {
  x: number
  y: number
  z: number
}

// ========== 位置转换（矩阵版本） ==========

/**
 * 位置转换：工作坐标系 -> 全局坐标系（世界空间）
 *
 * @param point 工作坐标系中的点（世界空间语义）
 * @param workingRotation 工作坐标系的旋转角度（视觉空间，度）
 * @returns 全局坐标系中的点（世界空间）
 */
export function convertPositionWorkingToGlobal(
  point: Position,
  workingRotation: Rotation
): Position {
  const vec = new Vector3(point.x, point.y, point.z)

  // 构建 Gizmo 的旋转矩阵（与 useThreeTransformGizmo 完全一致）
  const euler = new Euler(
    (workingRotation.x * Math.PI) / 180,
    (workingRotation.y * Math.PI) / 180,
    -(workingRotation.z * Math.PI) / 180, // Z 轴取反
    'ZYX'
  )
  const matrix = new Matrix4().makeRotationFromEuler(euler)

  vec.applyMatrix4(matrix)

  return {
    x: vec.x,
    y: vec.y,
    z: vec.z,
  }
}

/**
 * 位置转换：全局坐标系（世界空间）-> 工作坐标系
 *
 * @param point 全局坐标系中的点（世界空间）
 * @param workingRotation 工作坐标系的旋转角度（视觉空间，度）
 * @returns 工作坐标系中的点（世界空间语义，与 Gizmo 方向一致）
 */
export function convertPositionGlobalToWorking(
  point: Position,
  workingRotation: Rotation
): Position {
  const worldVec = new Vector3(point.x, point.y, point.z)

  // 构建 Gizmo 旋转矩阵的逆矩阵
  const euler = new Euler(
    (workingRotation.x * Math.PI) / 180,
    (workingRotation.y * Math.PI) / 180,
    -(workingRotation.z * Math.PI) / 180,
    'ZYX'
  )
  const matrix = new Matrix4().makeRotationFromEuler(euler)
  matrix.invert()

  worldVec.applyMatrix4(matrix)

  return {
    x: worldVec.x,
    y: worldVec.y,
    z: worldVec.z,
  }
}

// ========== 旋转转换（四元数版本，精确处理三轴旋转） ==========

/**
 * 旋转转换：工作坐标系 -> 全局坐标系
 *
 * 使用四元数确保旋转组合的正确性，避免欧拉角的万向锁问题
 *
 * 算法：globalRotation = workingRotation × relativeRotation
 *
 * @param relativeRotation 工作坐标系中的相对旋转（度）
 * @param workingRotation 工作坐标系的旋转角度（度）
 * @returns 全局坐标系中的绝对旋转（度）
 */
export function convertRotationWorkingToGlobal(
  relativeRotation: Rotation,
  workingRotation: Rotation
): Rotation {
  // 1. 工作坐标系的旋转 -> 四元数
  // 注意：Z 轴取反，与 Gizmo 的旋转约定一致
  const workingEuler = new Euler(
    (workingRotation.x * Math.PI) / 180,
    (workingRotation.y * Math.PI) / 180,
    -(workingRotation.z * Math.PI) / 180,
    'ZYX'
  )
  const workingQuat = new Quaternion().setFromEuler(workingEuler)

  // 2. 相对旋转 -> 四元数
  // 注意：Z 轴取反，与 Gizmo 的旋转约定一致
  const relativeEuler = new Euler(
    (relativeRotation.x * Math.PI) / 180,
    (relativeRotation.y * Math.PI) / 180,
    -(relativeRotation.z * Math.PI) / 180,
    'ZYX'
  )
  const relativeQuat = new Quaternion().setFromEuler(relativeEuler)

  // 3. 全局旋转 = 工作坐标系旋转 × 相对旋转
  const globalQuat = workingQuat.clone().multiply(relativeQuat)

  // 4. 转回欧拉角
  const globalEuler = new Euler().setFromQuaternion(globalQuat, 'ZYX')

  // 输出时 Z 轴取反回来，保持与输入一致的语义
  return {
    x: (globalEuler.x * 180) / Math.PI,
    y: (globalEuler.y * 180) / Math.PI,
    z: -(globalEuler.z * 180) / Math.PI,
  }
}

/**
 * 旋转转换：全局坐标系 -> 工作坐标系
 *
 * 使用四元数确保旋转分解的正确性，避免欧拉角的万向锁问题
 *
 * 算法：relativeRotation = workingRotation⁻¹ × globalRotation
 *
 * @param globalRotation 全局坐标系中的绝对旋转（度）
 * @param workingRotation 工作坐标系的旋转角度（度）
 * @returns 工作坐标系中的相对旋转（度）
 */
export function convertRotationGlobalToWorking(
  globalRotation: Rotation,
  workingRotation: Rotation
): Rotation {
  // 1. 工作坐标系的旋转 -> 四元数（逆）
  // 注意：Z 轴取反，与 Gizmo 的旋转约定一致
  const workingEuler = new Euler(
    (workingRotation.x * Math.PI) / 180,
    (workingRotation.y * Math.PI) / 180,
    -(workingRotation.z * Math.PI) / 180,
    'ZYX'
  )
  const workingQuatInv = new Quaternion().setFromEuler(workingEuler).invert()

  // 2. 全局旋转 -> 四元数
  // 注意：Z 轴取反，与 Gizmo 的旋转约定一致
  const globalEuler = new Euler(
    (globalRotation.x * Math.PI) / 180,
    (globalRotation.y * Math.PI) / 180,
    -(globalRotation.z * Math.PI) / 180,
    'ZYX'
  )
  const globalQuat = new Quaternion().setFromEuler(globalEuler)

  // 3. 相对旋转 = 工作坐标系旋转⁻¹ × 全局旋转
  const relativeQuat = workingQuatInv.clone().multiply(globalQuat)

  // 4. 转回欧拉角
  const relativeEuler = new Euler().setFromQuaternion(relativeQuat, 'ZYX')

  // 输出时 Z 轴取反回来，保持与输入一致的语义
  return {
    x: (relativeEuler.x * 180) / Math.PI,
    y: (relativeEuler.y * 180) / Math.PI,
    z: -(relativeEuler.z * 180) / Math.PI,
  }
}

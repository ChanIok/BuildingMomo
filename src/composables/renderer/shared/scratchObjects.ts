import { markRaw } from 'vue'
import { Matrix4, Vector3, Euler, Quaternion, Color } from 'three'

/**
 * 共享的临时对象，用于避免频繁创建/销毁对象
 *
 * 注意：这些对象在同一调用链中同步复用，不支持并发
 */
export const scratchMatrix = markRaw(new Matrix4())
export const scratchPosition = markRaw(new Vector3())
export const scratchEuler = markRaw(new Euler())
export const scratchQuaternion = markRaw(new Quaternion())
export const scratchScale = markRaw(new Vector3())
export const scratchColor = markRaw(new Color())
export const scratchTmpVec3 = markRaw(new Vector3(0, 0, 1)) // Default Plane Normal (+Z)
export const scratchDefaultNormal = markRaw(new Vector3(0, 0, 1)) // Default Plane Normal (+Z)
export const scratchUpVec3 = markRaw(new Vector3(0, 1, 0)) // Temp Up (Y)
export const scratchLookAtTarget = markRaw(new Vector3())

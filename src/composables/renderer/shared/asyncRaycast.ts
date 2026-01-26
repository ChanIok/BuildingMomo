import { Mesh, Matrix4, Raycaster, Sphere, type InstancedMesh, type Intersection } from 'three'
import type { RaycastHit, RaycastTask } from '../types'

// ============================================================
// 配置常量
// ============================================================

/** 每帧时间预算（毫秒） */
const BUDGET_MS = 5

/** 每隔多少个实例检查一次时间 */
const INSTANCES_PER_CHECK = 500

// ============================================================
// 复用对象（避免 GC）
// ============================================================

const _instanceMatrix = new Matrix4()
const _instanceWorldMatrix = new Matrix4()
const _mesh = new Mesh()
const _sphere = new Sphere()
const _instanceIntersects: Intersection[] = []

// ============================================================
// 工具函数
// ============================================================

/**
 * 让出主线程一帧
 *
 * 优先使用 scheduler.yield()（现代浏览器），
 * 回退到 requestAnimationFrame
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if ('scheduler' in globalThis && 'yield' in (globalThis as any).scheduler) {
      ;(globalThis as any).scheduler.yield().then(resolve)
    } else {
      requestAnimationFrame(() => resolve())
    }
  })
}

/**
 * 创建射线检测任务
 */
export function createRaycastTask(): RaycastTask {
  return { cancelled: false }
}

/**
 * 取消射线检测任务
 */
export function cancelTask(task: RaycastTask | null): void {
  if (task) {
    task.cancelled = true
  }
}

// ============================================================
// 核心：可中断的 InstancedMesh 射线检测
// ============================================================

/**
 * 对单个 InstancedMesh 执行可中断的异步射线检测
 *
 * 基于 Three.js InstancedMesh.raycast 源码改写，
 * 在实例遍历循环中加入时间检查和 yield，避免长时间阻塞主线程
 *
 * @param mesh - 要检测的 InstancedMesh
 * @param raycaster - Three.js Raycaster 实例
 * @param task - 任务对象，用于检查是否被取消
 * @param localIndexMap - 局部索引映射（instanceId -> internalId）
 * @returns 最近的命中结果，或 null（无命中/被取消）
 */
export async function raycastInstancedMeshAsync(
  mesh: InstancedMesh,
  raycaster: Raycaster,
  task: RaycastTask,
  localIndexMap: Map<number, string>
): Promise<RaycastHit | null> {
  if (!mesh || mesh.count === 0) return null

  const matrixWorld = mesh.matrixWorld
  const count = mesh.count

  // 复用临时 Mesh
  _mesh.geometry = mesh.geometry
  _mesh.material = mesh.material as any

  if (!_mesh.material) return null

  // 1. 先用 boundingSphere 快速排除
  if (mesh.boundingSphere === null) {
    mesh.computeBoundingSphere()
  }

  if (mesh.boundingSphere) {
    _sphere.copy(mesh.boundingSphere)
    _sphere.applyMatrix4(matrixWorld)

    if (!raycaster.ray.intersectsSphere(_sphere)) {
      return null
    }
  }

  // 2. 时间切片遍历所有实例
  let frameStart = performance.now()
  let closestHit: RaycastHit | null = null

  for (let instanceId = 0; instanceId < count; instanceId++) {
    // 检查是否被取消
    if (task.cancelled) return null

    // 每 N 个实例检查一次时间
    if (instanceId % INSTANCES_PER_CHECK === 0 && instanceId > 0) {
      if (performance.now() - frameStart > BUDGET_MS) {
        await yieldToMain()
        if (task.cancelled) return null
        frameStart = performance.now()
      }
    }

    // 计算实例的世界矩阵
    mesh.getMatrixAt(instanceId, _instanceMatrix)
    _instanceWorldMatrix.multiplyMatrices(matrixWorld, _instanceMatrix)

    // 设置临时 Mesh 的世界矩阵
    _mesh.matrixWorld = _instanceWorldMatrix

    // 执行射线检测（会使用 BVH 加速，如果有的话）
    _instanceIntersects.length = 0
    _mesh.raycast(raycaster, _instanceIntersects)

    // 处理命中结果
    if (_instanceIntersects.length > 0) {
      const hit = _instanceIntersects[0]
      if (!hit) continue

      // 获取 internalId
      const internalId = localIndexMap.get(instanceId)
      if (!internalId) continue

      // 更新最近命中
      if (!closestHit || hit.distance < closestHit.distance) {
        closestHit = {
          instanceId,
          internalId,
          distance: hit.distance,
        }
      }
    }
  }

  return closestHit
}

/**
 * 对多个 InstancedMesh 执行可中断的异步射线检测
 *
 * @param meshes - 要检测的 InstancedMesh 数组
 * @param raycaster - Three.js Raycaster 实例
 * @param task - 任务对象
 * @param getMeshLocalIndexMap - 获取 mesh 对应的局部索引映射
 * @returns 最近的命中结果，或 null
 */
export async function raycastMultipleMeshesAsync(
  meshes: InstancedMesh[],
  raycaster: Raycaster,
  task: RaycastTask,
  getMeshLocalIndexMap: (mesh: InstancedMesh) => Map<number, string> | undefined
): Promise<RaycastHit | null> {
  let closestHit: RaycastHit | null = null

  for (const mesh of meshes) {
    if (task.cancelled) return null

    const localIndexMap = getMeshLocalIndexMap(mesh)
    if (!localIndexMap) continue

    const hit = await raycastInstancedMeshAsync(mesh, raycaster, task, localIndexMap)

    if (hit && (!closestHit || hit.distance < closestHit.distance)) {
      closestHit = hit
    }
  }

  return closestHit
}

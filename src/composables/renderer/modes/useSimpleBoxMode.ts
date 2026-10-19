import { ref, markRaw } from 'vue'
import { BoxGeometry, InstancedMesh, DynamicDrawUsage, Sphere, Vector3 } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { nextInstancedPoolCapacity, requiredInstanceCount } from '@/lib/renderInstanceBudget'
import { createBoxMaterial } from '@nuan5-pro/render'
import {
  scratchMatrix,
  scratchPosition,
  scratchEuler,
  scratchQuaternion,
  scratchScale,
  scratchColor,
  scratchTmpVec3,
} from '../shared/scratchObjects'

function detachInstancedMesh(mesh: InstancedMesh) {
  mesh.geometry = null as any
  mesh.material = null as any
}

/**
 * Simple Box 渲染模式
 *
 * 简化方块渲染（固定尺寸 100x100x100，支持符号缩放）
 * 适用于快速预览和大批量物品场景
 */
export function useSimpleBoxMode() {
  const editorStore = useEditorStore()
  const settingsStore = useSettingsStore()

  // 基础几何体 1x1x1
  const baseGeometry = new BoxGeometry(1, 1, 1)
  // 修正：将几何体原点从中心移动到底部 (Z: -0.5~0.5 -> 0~1)
  baseGeometry.translate(0, 0, 0.5)

  // 构建 BVH 加速结构
  baseGeometry.computeBoundsTree({
    setBoundingBox: true,
  })

  const material = createBoxMaterial(0.95)

  const simpleBoxInstancedMesh = ref<InstancedMesh | null>(null)

  function ensureMeshPool(requiredInstances: number) {
    const current = simpleBoxInstancedMesh.value?.instanceMatrix.count ?? 0
    const targetPool = nextInstancedPoolCapacity(requiredInstances, current)
    if (simpleBoxInstancedMesh.value && current >= targetPool) return

    if (simpleBoxInstancedMesh.value) {
      detachInstancedMesh(simpleBoxInstancedMesh.value)
    }
    const mesh = new InstancedMesh(baseGeometry, material, targetPool)
    mesh.frustumCulled = false
    mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0
    simpleBoxInstancedMesh.value = markRaw(mesh)
  }

  /**
   * 重建所有实例
   */
  function rebuild() {
    const items = editorStore.activeScheme?.items.value ?? []
    const instanceCount = requiredInstanceCount(items.length)
    ensureMeshPool(instanceCount)

    const mesh = simpleBoxInstancedMesh.value
    if (!mesh) return

    mesh.count = instanceCount

    const symbolScale = settingsStore.settings.threeSymbolScale

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) continue

      // 位置
      scratchPosition.set(item.x, item.y, item.z)

      // 旋转：同 Box 模式，需要对 Roll / Pitch 取反以抵消父级 Y 轴镜像
      const Rotation = item.rotation
      scratchEuler.set(
        (-Rotation.x * Math.PI) / 180,
        (-Rotation.y * Math.PI) / 180,
        (Rotation.z * Math.PI) / 180,
        'ZYX'
      )
      scratchQuaternion.setFromEuler(scratchEuler)

      // 缩放：基础 100 * symbolScale
      const s = 100 * symbolScale
      scratchScale.set(s, s, s)

      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      mesh.setMatrixAt(index, scratchMatrix)

      // 颜色占位（由 colorManager 统一更新）
      scratchColor.setHex(0x94a3b8)
      mesh.setColorAt(index, scratchColor)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  /**
   * 更新符号缩放（当 symbolScale 设置变化时调用）
   */
  function updateScale() {
    const mesh = simpleBoxInstancedMesh.value
    if (!mesh) return

    const scale = settingsStore.settings.threeSymbolScale
    const s = 100 * scale
    scratchScale.set(s, s, s)
    const count = mesh.count
    for (let index = 0; index < count; index++) {
      mesh.getMatrixAt(index, scratchMatrix)
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchTmpVec3)
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      mesh.setMatrixAt(index, scratchMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  /**
   * 清理资源
   */
  function dispose() {
    if (baseGeometry.boundsTree) {
      baseGeometry.disposeBoundsTree()
    }
    baseGeometry.dispose()
    material.dispose()
    if (simpleBoxInstancedMesh.value) {
      detachInstancedMesh(simpleBoxInstancedMesh.value)
      simpleBoxInstancedMesh.value = null
    }
  }

  return {
    mesh: simpleBoxInstancedMesh,
    rebuild,
    updateScale,
    dispose,
  }
}

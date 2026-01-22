import { ref, markRaw } from 'vue'
import { BoxGeometry, InstancedMesh, DynamicDrawUsage, Sphere, Vector3 } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { coordinates3D } from '@/lib/coordinates'
import { createBoxMaterial } from '../shared/materials'
import {
  scratchMatrix,
  scratchPosition,
  scratchEuler,
  scratchQuaternion,
  scratchScale,
  scratchColor,
} from '../shared/scratchObjects'
import { MAX_RENDER_INSTANCES as MAX_INSTANCES } from '@/types/constants'

// 当缺少尺寸信息时使用的默认尺寸（游戏坐标：X=长, Y=宽, Z=高）
const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

/**
 * Box 渲染模式
 *
 * 完整体积渲染（基于家具实际尺寸，带边框效果）
 * 最准确地反映游戏中家具的真实占用空间
 */
export function useBoxMode() {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()

  // 基础几何体 1x1x1
  const baseGeometry = new BoxGeometry(1, 1, 1)
  // 修正：将几何体原点从中心移动到底部 (Z: -0.5~0.5 -> 0~1)
  baseGeometry.translate(0, 0, 0.5)

  // 构建 BVH 加速结构
  baseGeometry.computeBoundsTree({
    setBoundingBox: true,
  })

  const material = createBoxMaterial(0.9)

  // 创建 InstancedMesh
  const mesh = new InstancedMesh(baseGeometry, material, MAX_INSTANCES)
  mesh.frustumCulled = false
  mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0

  const instancedMesh = ref<InstancedMesh | null>(markRaw(mesh))

  /**
   * 重建所有实例
   */
  function rebuild() {
    const items = editorStore.activeScheme?.items.value ?? []
    const instanceCount = Math.min(items.length, MAX_INSTANCES)

    mesh.count = instanceCount

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) continue

      // 位置
      coordinates3D.setThreeFromGame(scratchPosition, { x: item.x, y: item.y, z: item.z })

      // 缩放参数和尺寸
      const Scale = item.extra.Scale
      const furnitureSize = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      const [sizeX, sizeY, sizeZ] = furnitureSize

      // 旋转
      // Z-Up Rotation: Yaw is around Z, Pitch around Y, Roll around X
      // 由于场景父级在 Y 轴上做了镜像缩放 ([1, -1, 1])，
      // 为了让编辑器中的 Roll / Pitch 与游戏中的方向一致，这里对 Roll 和 Pitch 取反
      const Rotation = item.rotation
      scratchEuler.set(
        (-Rotation.x * Math.PI) / 180, // Roll around X (取反修正镜像)
        (-Rotation.y * Math.PI) / 180, // Pitch around Y (取反修正镜像)
        (Rotation.z * Math.PI) / 180, // Yaw around Z 保持不变
        'ZYX'
      )
      scratchQuaternion.setFromEuler(scratchEuler)

      // 缩放：使用家具实际尺寸
      // Z-up: sizeX=Length, sizeY=Width, sizeZ=Height
      // 注意：游戏坐标系中 X/Y 与 Three.js 交换（游戏X=南北→Three.js Y，游戏Y=东西→Three.js X）
      scratchScale.set((Scale.Y || 1) * sizeX, (Scale.X || 1) * sizeY, (Scale.Z || 1) * sizeZ)

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
   * 清理资源
   */
  function dispose() {
    if (baseGeometry.boundsTree) {
      baseGeometry.disposeBoundsTree()
    }
    baseGeometry.dispose()
    material.dispose()
    if (instancedMesh.value) {
      instancedMesh.value.geometry = null as any
      instancedMesh.value.material = null as any
      instancedMesh.value = null
    }
  }

  return {
    mesh: instancedMesh,
    rebuild,
    dispose,
  }
}

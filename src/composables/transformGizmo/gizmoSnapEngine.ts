import { ref, type Ref } from 'vue'
import { Box3Helper, Color, Euler, Matrix4, Vector3, type Object3D } from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { useGameDataStore } from '@/stores/gameDataStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import { matrixTransform } from '@/lib/matrixTransform'
import {
  OBB,
  OBBHelper,
  getOBBFromMatrix,
  getOBBFromMatrixAndModelBox,
  mergeOBBs,
  calculateOBBSnapVector,
  transformOBBByMatrix,
} from '@/lib/collision'
import { getThreeModelManager } from '@/composables/useThreeModelManager'

interface StaticCollisionData {
  obb: OBB
  corners: Vector3[]
  center: Vector3
  radius: number
}

interface SelectedItemOBBInfo {
  id: string
  localSize: Vector3
  localCenter: Vector3
}

interface CreateGizmoSnapEngineOptions {
  editorStore: ReturnType<typeof useEditorStore>
  gameDataStore: ReturnType<typeof useGameDataStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  pivotRef: Ref<Object3D | null>
  transformRef?: Ref<any | null>
  getEffectiveGizmoRotation: () => { x: number; y: number; z: number }
  isSnapTemporarilyDisabled: () => boolean
}

const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]
const DEBUG_SHOW_BOUNDING_BOXES = false

export function createGizmoSnapEngine({
  editorStore,
  gameDataStore,
  settingsStore,
  pivotRef,
  transformRef,
  getEffectiveGizmoRotation,
  isSnapTemporarilyDisabled,
}: CreateGizmoSnapEngineOptions) {
  const staticWorldMatrices = ref(new Map<string, StaticCollisionData>())
  const selectedItemsOBBInfo = ref<SelectedItemOBBInfo[]>([])
  const debugHelpers: (Box3Helper | OBBHelper)[] = []

  function clearDebugHelpers() {
    if (!DEBUG_SHOW_BOUNDING_BOXES) return

    const pivot = pivotRef.value
    if (!pivot || !pivot.parent) return

    for (const helper of debugHelpers) {
      pivot.parent.remove(helper)
      helper.dispose()
    }
    debugHelpers.length = 0
  }

  function clearCollisionData() {
    staticWorldMatrices.value = new Map()
    selectedItemsOBBInfo.value = []
    clearDebugHelpers()
  }

  function resolveEnabledAxes() {
    const enabledAxes = { x: false, y: false, z: false }

    if (!transformRef?.value) return enabledAxes
    const controls = transformRef.value.instance || transformRef.value.value
    if (!controls?.axis) return enabledAxes

    const axis = controls.axis.toUpperCase()
    if (axis.includes('X')) enabledAxes.x = true
    if (axis.includes('Y')) enabledAxes.y = true
    if (axis.includes('Z')) enabledAxes.z = true
    return enabledAxes
  }

  function resolveGizmoWorldAxes() {
    const gizmoWorldAxes = {
      x: new Vector3(1, 0, 0),
      y: new Vector3(0, 1, 0),
      z: new Vector3(0, 0, 1),
    }

    const effectiveRotation = getEffectiveGizmoRotation()
    const hasRotation =
      effectiveRotation.x !== 0 || effectiveRotation.y !== 0 || effectiveRotation.z !== 0
    if (!hasRotation) return gizmoWorldAxes

    const euler = new Euler(
      (effectiveRotation.x * Math.PI) / 180,
      (effectiveRotation.y * Math.PI) / 180,
      -(effectiveRotation.z * Math.PI) / 180,
      'ZYX'
    )
    const rotationMatrix = new Matrix4().makeRotationFromEuler(euler)
    gizmoWorldAxes.x.applyMatrix4(rotationMatrix)
    gizmoWorldAxes.y.applyMatrix4(rotationMatrix)
    gizmoWorldAxes.z.applyMatrix4(rotationMatrix)
    return gizmoWorldAxes
  }

  function prepareCollisionData(scheme: any) {
    if (!scheme) return

    const selectedIds = scheme.selectedItemIds.value as Set<string>
    const currentMode = settingsStore.settings.threeDisplayMode
    const modelManager = getThreeModelManager()

    const obbInfoList: SelectedItemOBBInfo[] = []
    for (const id of selectedIds) {
      const item = editorStore.itemsMap.get(id)
      if (!item) continue

      let localSize: Vector3
      let localCenter: Vector3

      if (currentMode === 'model') {
        const modelBox = modelManager.getModelBoundingBox(item.gameId)
        if (modelBox) {
          localSize = new Vector3()
          modelBox.getSize(localSize)
          localCenter = new Vector3()
          modelBox.getCenter(localCenter)
        } else {
          const size = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
          localSize = new Vector3(...size)
          localCenter = new Vector3()
        }
      } else if (currentMode === 'box') {
        localSize = new Vector3(1, 1, 1)
        localCenter = new Vector3(0, 0, 0.5)
      } else {
        localSize = new Vector3(1, 1, 1)
        localCenter = new Vector3()
      }

      obbInfoList.push({ id, localSize, localCenter })
    }
    selectedItemsOBBInfo.value = obbInfoList

    if (!settingsStore.settings.enableSurfaceSnap) {
      staticWorldMatrices.value = new Map()
      return
    }

    const staticMatrices = new Map<string, StaticCollisionData>()
    for (const item of scheme.items.value) {
      if (selectedIds.has(item.internalId)) continue

      const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
      const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
      const useModelScale = !!(currentMode === 'model' && hasValidModel)
      const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)

      const furnitureSize = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
      let obb: OBB
      if (currentMode === 'model') {
        const modelBox = modelManager.getModelBoundingBox(item.gameId)
        if (modelBox) {
          obb = getOBBFromMatrixAndModelBox(matrix, modelBox)
        } else {
          obb = getOBBFromMatrix(matrix, new Vector3(...furnitureSize))
        }
      } else {
        obb = getOBBFromMatrix(matrix, new Vector3(1, 1, 1))
      }

      const corners = obb.getCorners()
      const radius = obb.halfExtents.length()

      staticMatrices.set(item.internalId, {
        obb,
        corners,
        center: obb.center.clone(),
        radius,
      })
    }

    staticWorldMatrices.value = staticMatrices
  }

  function applyCollisionSnap(newWorldMatrices: Map<string, Matrix4>): Map<string, Matrix4> {
    if (!settingsStore.settings.enableSurfaceSnap || isSnapTemporarilyDisabled()) {
      return newWorldMatrices
    }

    if (editorStore.gizmoMode !== 'translate') {
      return newWorldMatrices
    }

    const enabledAxes = resolveEnabledAxes()
    if (!enabledAxes.x && !enabledAxes.y && !enabledAxes.z) {
      console.log('[Snap] 未检测到活动轴，跳过吸附')
      return newWorldMatrices
    }

    const scheme = editorStore.activeScheme
    if (!scheme) return newWorldMatrices

    const gizmoWorldAxes = resolveGizmoWorldAxes()
    const selectedOBBs: OBB[] = []

    for (const obbInfo of selectedItemsOBBInfo.value) {
      const matrix = newWorldMatrices.get(obbInfo.id)
      if (!matrix) continue

      const obb = transformOBBByMatrix(matrix, obbInfo.localSize, obbInfo.localCenter)
      selectedOBBs.push(obb)
    }

    if (selectedOBBs.length === 0) return newWorldMatrices

    let selectionOBB: OBB
    if (selectedOBBs.length === 1) {
      selectionOBB = selectedOBBs[0]!
    } else {
      const referenceAxes: [Vector3, Vector3, Vector3] = [
        gizmoWorldAxes.x.clone(),
        gizmoWorldAxes.y.clone(),
        gizmoWorldAxes.z.clone(),
      ]
      selectionOBB = mergeOBBs(selectedOBBs, referenceAxes)
    }

    if (DEBUG_SHOW_BOUNDING_BOXES) {
      clearDebugHelpers()
      const pivot = pivotRef.value
      if (pivot && pivot.parent) {
        const obbHelper = new OBBHelper(selectionOBB, new Color(0x00ffff))
        pivot.parent.add(obbHelper)
        debugHelpers.push(obbHelper)

        const aabbHelper = new Box3Helper(selectionOBB.getAABB(), new Color(0x00ff00))
        pivot.parent.add(aabbHelper)
        debugHelpers.push(aabbHelper)
      }
    }

    const snapByAxis = {
      x: { vector: null as Vector3 | null, distance: Infinity },
      y: { vector: null as Vector3 | null, distance: Infinity },
      z: { vector: null as Vector3 | null, distance: Infinity },
    }
    const snapThreshold = settingsStore.settings.surfaceSnapThreshold

    const selectionCenter = selectionOBB.center
    const selectionRadius = selectionOBB.halfExtents.length()
    const selectionCornersPool: Vector3[] = Array.from({ length: 8 }, () => new Vector3())
    const selectionCorners = selectionOBB.getCorners(selectionCornersPool)

    for (const data of staticWorldMatrices.value.values()) {
      const dynamicCullRadius = selectionRadius + data.radius + snapThreshold
      const distanceToCandidate = selectionCenter.distanceTo(data.center)

      if (distanceToCandidate > dynamicCullRadius) {
        continue
      }

      const snapVector = calculateOBBSnapVector(
        selectionOBB,
        data.obb,
        snapThreshold,
        enabledAxes,
        selectionCorners,
        data.corners
      )
      if (!snapVector) continue

      if (enabledAxes.x) {
        const projX = snapVector.dot(gizmoWorldAxes.x)
        if (Math.abs(projX) > 0.1) {
          const distX = Math.abs(projX)
          if (distX < snapByAxis.x.distance) {
            snapByAxis.x.vector = gizmoWorldAxes.x.clone().multiplyScalar(projX)
            snapByAxis.x.distance = distX
          }
        }
      }

      if (enabledAxes.y) {
        const projY = snapVector.dot(gizmoWorldAxes.y)
        if (Math.abs(projY) > 0.1) {
          const distY = Math.abs(projY)
          if (distY < snapByAxis.y.distance) {
            snapByAxis.y.vector = gizmoWorldAxes.y.clone().multiplyScalar(projY)
            snapByAxis.y.distance = distY
          }
        }
      }

      if (enabledAxes.z) {
        const projZ = snapVector.dot(gizmoWorldAxes.z)
        if (Math.abs(projZ) > 0.1) {
          const distZ = Math.abs(projZ)
          if (distZ < snapByAxis.z.distance) {
            snapByAxis.z.vector = gizmoWorldAxes.z.clone().multiplyScalar(projZ)
            snapByAxis.z.distance = distZ
          }
        }
      }
    }

    const finalSnapOffset = new Vector3()
    if (snapByAxis.x.vector) finalSnapOffset.add(snapByAxis.x.vector)
    if (snapByAxis.y.vector) finalSnapOffset.add(snapByAxis.y.vector)
    if (snapByAxis.z.vector) finalSnapOffset.add(snapByAxis.z.vector)

    if (finalSnapOffset.length() <= 0.1) {
      return newWorldMatrices
    }

    const snappedMatrices = new Map<string, Matrix4>()
    for (const [id, matrix] of newWorldMatrices) {
      const snapped = matrix.clone()
      const pos = new Vector3().setFromMatrixPosition(snapped)
      pos.add(finalSnapOffset)
      snapped.setPosition(pos)
      snappedMatrices.set(id, snapped)
    }

    return snappedMatrices
  }

  return {
    prepareCollisionData,
    clearCollisionData,
    applyCollisionSnap,
  }
}

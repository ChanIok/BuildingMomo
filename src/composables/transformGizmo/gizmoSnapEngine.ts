import type { Ref } from 'vue'
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { useGameDataStore } from '@/stores/gameDataStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import type { HomeScheme } from '@/types/editor'
import { OBB } from '@/lib/collision'
import { buildItemOBB } from '@/lib/alignmentHelpers'
import {
  createTranslationSnapBody,
  solveTranslationSnap,
  type TranslationSnapBody,
  type TranslationSnapContact,
} from '@/lib/translationSnap'
import { getThreeModelManager } from '@/composables/useThreeModelManager'

interface CreateGizmoSnapEngineOptions {
  editorStore: ReturnType<typeof useEditorStore>
  gameDataStore: ReturnType<typeof useGameDataStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  pivotRef: Ref<Object3D | null>
  transformRef?: Ref<any | null>
  isSnapTemporarilyDisabled: () => boolean
}

// 脱离距离略大于进入距离，避免在阈值附近反复切换目标。
const SNAP_RELEASE_MULTIPLIER = 1.5

export function createGizmoSnapEngine({
  editorStore,
  gameDataStore,
  settingsStore,
  pivotRef,
  transformRef,
  isSnapTemporarilyDisabled,
}: CreateGizmoSnapEngineOptions) {
  let targets: TranslationSnapBody[] = []
  let selected: { body: TranslationSnapBody; startPosition: Vector3 }[] = []
  let movementAxes: Vector3[] = []
  let activeContact: TranslationSnapContact | null = null

  function clearCollisionData() {
    targets = []
    selected = []
    movementAxes = []
    activeContact = null
  }

  function prepareCollisionData(scheme: HomeScheme, startMatrices: Map<string, Matrix4>) {
    clearCollisionData()
    if (!settingsStore.settings.enableSurfaceSnap) return

    const controls =
      transformRef?.value?.instance || transformRef?.value?.value || transformRef?.value
    const axis = controls?.axis?.toUpperCase() ?? ''
    const pivot = pivotRef.value
    if (!pivot || !axis) return

    // 直接使用拖拽起点的 Gizmo 世界姿态，避免另写工作坐标系的旋转转换。
    const rotation = pivot.getWorldQuaternion(new Quaternion())
    movementAxes = [
      { name: 'X', direction: new Vector3(1, 0, 0) },
      { name: 'Y', direction: new Vector3(0, 1, 0) },
      { name: 'Z', direction: new Vector3(0, 0, 1) },
    ]
      .filter(({ name }) => axis.includes(name))
      .map(({ direction }) => direction.applyQuaternion(rotation))

    const modelManager = getThreeModelManager()
    for (const item of scheme.items.value) {
      // 选中与静态家具使用同一套显示补偿、模型边界和底部原点语义。
      const body = createTranslationSnapBody(
        item.internalId,
        buildItemOBB(item, settingsStore.settings.threeDisplayMode, gameDataStore, modelManager)
      )
      if (scheme.selectedItemIds.value.has(item.internalId)) {
        const matrix = startMatrices.get(item.internalId)
        if (matrix) {
          selected.push({ body, startPosition: new Vector3().setFromMatrixPosition(matrix) })
        }
      } else {
        targets.push(body)
      }
    }
  }

  function applyCollisionSnap(rawMatrices: Map<string, Matrix4>): Map<string, Matrix4> {
    if (
      !settingsStore.settings.enableSurfaceSnap ||
      isSnapTemporarilyDisabled() ||
      editorStore.gizmoMode !== 'translate'
    ) {
      activeContact = null
      return rawMatrices
    }

    // 纯平移只更新中心和粗筛边界，朝向与尺寸始终复用拖拽起点的 OBB。
    const moving: TranslationSnapBody[] = []
    for (const { body, startPosition } of selected) {
      const matrix = rawMatrices.get(body.id)
      if (!matrix) continue
      const delta = new Vector3().setFromMatrixPosition(matrix).sub(startPosition)
      moving.push({
        id: body.id,
        obb: new OBB(body.obb.center.clone().add(delta), body.obb.halfExtents, body.obb.axes),
        bounds: body.bounds.clone().translate(delta),
      })
    }

    const threshold = settingsStore.settings.surfaceSnapThreshold
    const result = solveTranslationSnap({
      moving,
      targets,
      movementAxes,
      threshold,
      allowEdgeSnap: settingsStore.settings.allowEdgeSnap,
      preferredContact: activeContact,
      releaseThreshold: threshold * SNAP_RELEASE_MULTIPLIER,
    })
    activeContact = result?.contact ?? null
    if (!result) return rawMatrices

    const matrices = new Map<string, Matrix4>()
    for (const [id, matrix] of rawMatrices) {
      const snapped = matrix.clone()
      const position = new Vector3().setFromMatrixPosition(matrix).add(result.offset)
      snapped.setPosition(position)
      matrices.set(id, snapped)
    }
    return matrices
  }

  return { prepareCollisionData, clearCollisionData, applyCollisionSnap }
}

import { computed, ref, watchEffect, markRaw, watch, onUnmounted, type Ref } from 'vue'
import { useMagicKeys } from '@vueuse/core'
import { Object3D, Vector3, Euler, Matrix4, Plane, Raycaster, Vector2, type Camera } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useClipboard } from '@/composables/useClipboard'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { matrixTransform } from '@/lib/matrixTransform'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import type { AppItem } from '@/types/editor'
import { createGizmoAppearanceManager } from '@/composables/transformGizmo/gizmoAppearance'
import { createGizmoSnapEngine } from '@/composables/transformGizmo/gizmoSnapEngine'
import {
  createGizmoTouchTranslateController,
  type PatchedTransformControls,
} from '@/composables/transformGizmo/gizmoTouchTranslate'

export function useThreeTransformGizmo(
  pivotRef: Ref<Object3D | null>,
  updateSelectedInstancesMatrix: (
    idToWorldMatrixMap: Map<string, Matrix4>,
    skipBVHRefit?: boolean
  ) => void,
  isTransformDragging: Ref<boolean>,
  orbitControlsRef?: Ref<any | null>,
  activeCameraRef?: Ref<any | null>,
  transformRef?: Ref<any | null>
) {
  const gizmoStartMatrix = markRaw(new Matrix4())
  const itemStartWorldMatrices = ref(new Map<string, Matrix4>())
  const hasStartedTransform = ref(false)

  const isRotateMode = ref(false)
  const rotateAxis = ref<'X' | 'Y' | 'Z' | null>(null)
  const startMouseAngle = ref(0)
  const startGizmoRotation = markRaw(new Euler())
  const hasInitializedRotation = ref(false)
  const lastRotationMatrices = ref<Map<string, Matrix4> | null>(null)
  const lastTranslateMatrices = ref<Map<string, Matrix4> | null>(null)

  const altDragCopyPending = ref(false)
  const altDragCopyExecuted = ref(false)
  const gizmoStartPosition = markRaw(new Vector3())

  const scratchDeltaMatrix = markRaw(new Matrix4())
  const scratchInverseStartMatrix = markRaw(new Matrix4())

  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const gameDataStore = useGameDataStore()
  const settingsStore = useSettingsStore()
  const { saveHistory } = useEditorHistory()
  const { commitBatchedTransform, getSelectedItemsCenter } = useEditorManipulation()
  const { pasteItems, buildClipboardDataFromSelection } = useClipboard()

  const { Alt, Control, Meta } = useMagicKeys()

  function isSnapTemporarilyDisabled(): boolean {
    return (Control?.value ?? false) || (Meta?.value ?? false)
  }

  function getEffectiveGizmoRotation(): { x: number; y: number; z: number } {
    const scheme = editorStore.activeScheme
    if (!scheme) return { x: 0, y: 0, z: 0 }

    const selectedIds = scheme.selectedItemIds.value
    return (
      uiStore.getEffectiveCoordinateRotation(selectedIds, editorStore.itemsMap) || {
        x: 0,
        y: 0,
        z: 0,
      }
    )
  }

  const snapEngine = createGizmoSnapEngine({
    editorStore,
    gameDataStore,
    settingsStore,
    pivotRef,
    transformRef,
    getEffectiveGizmoRotation,
    isSnapTemporarilyDisabled,
  })

  const touchTranslateController = createGizmoTouchTranslateController({
    editorStore,
    settingsStore,
    uiStore,
    pivotRef,
    transformRef,
    activeCameraRef,
    itemStartWorldMatrices,
    isTransformDragging,
    isSnapTemporarilyDisabled,
    applyCollisionSnap: (newWorldMatrices) => snapEngine.applyCollisionSnap(newWorldMatrices),
    onFirstTransform: () => {
      if (!hasStartedTransform.value) {
        saveHistory('edit')
        hasStartedTransform.value = true
      }
    },
    onPreviewMatrices: (newWorldMatrices) => {
      lastTranslateMatrices.value = newWorldMatrices
      updateSelectedInstancesMatrix(newWorldMatrices, true)
    },
  })

  const setupGizmoAppearance = createGizmoAppearanceManager(
    editorStore,
    gameDataStore,
    settingsStore,
    uiStore
  )

  /**
   * 计算鼠标在旋转平面上的角度
   * @param gizmoWorldPos Gizmo 中心的世界坐标
   * @param mouseClientX 鼠标 X 坐标
   * @param mouseClientY 鼠标 Y 坐标
   * @param camera 当前相机
   * @param axis 旋转轴
   * @param containerRect 容器的布局信息
   * @returns 角度（弧度），失败返回 null
   */
  function calculateRotationAngle(
    gizmoWorldPos: Vector3,
    mouseClientX: number,
    mouseClientY: number,
    camera: Camera,
    axis: 'X' | 'Y' | 'Z',
    containerRect: { left: number; top: number; width: number; height: number }
  ): number | null {
    const mouseNDC = new Vector2(
      ((mouseClientX - containerRect.left) / containerRect.width) * 2 - 1,
      -((mouseClientY - containerRect.top) / containerRect.height) * 2 + 1
    )

    let planeNormal: Vector3
    if (axis === 'X') {
      planeNormal = new Vector3(1, 0, 0)
    } else if (axis === 'Y') {
      planeNormal = new Vector3(0, 1, 0)
    } else {
      planeNormal = new Vector3(0, 0, 1)
    }

    const effectiveRotation = getEffectiveGizmoRotation()
    const hasRotation =
      effectiveRotation.x !== 0 || effectiveRotation.y !== 0 || effectiveRotation.z !== 0
    if (hasRotation && pivotRef.value) {
      const euler = new Euler(
        (effectiveRotation.x * Math.PI) / 180,
        (effectiveRotation.y * Math.PI) / 180,
        -(effectiveRotation.z * Math.PI) / 180,
        'ZYX'
      )
      const rotationMatrix = new Matrix4().makeRotationFromEuler(euler)
      planeNormal.applyMatrix4(rotationMatrix)
    }

    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, gizmoWorldPos)

    const raycaster = new Raycaster()
    raycaster.setFromCamera(mouseNDC, camera)
    const intersection = new Vector3()
    const hit = raycaster.ray.intersectPlane(plane, intersection)

    if (!hit) {
      return null
    }

    const localPos = intersection.clone().sub(gizmoWorldPos)
    if (hasRotation) {
      const euler = new Euler(
        (effectiveRotation.x * Math.PI) / 180,
        (effectiveRotation.y * Math.PI) / 180,
        -(effectiveRotation.z * Math.PI) / 180,
        'ZYX'
      )
      const rotationMatrix = new Matrix4().makeRotationFromEuler(euler)
      rotationMatrix.invert()
      localPos.applyMatrix4(rotationMatrix)
    }

    if (axis === 'X') {
      return Math.atan2(localPos.z, localPos.y)
    }
    if (axis === 'Y') {
      return Math.atan2(localPos.x, localPos.z)
    }
    return Math.atan2(localPos.y, localPos.x)
  }

  const shouldShowGizmo = computed(
    () =>
      (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0 &&
      editorStore.gizmoMode !== null
  )

  const transformSpace = computed<'local' | 'world'>(() => 'local')

  watchEffect(() => {
    if (isTransformDragging.value) {
      return
    }

    let center: { x: number; y: number; z: number } | null = null
    const scheme = editorStore.activeScheme

    if (uiStore.customPivotEnabled && uiStore.customPivotPosition) {
      center = uiStore.customPivotPosition
    } else if (scheme) {
      const selectedIds = scheme.selectedItemIds.value
      const groupId = editorStore.getGroupIdIfEntireGroupSelected(selectedIds)
      if (groupId !== null) {
        const originItemId = scheme.groupOrigins.value.get(groupId)
        if (originItemId) {
          const originItem = editorStore.itemsMap.get(originItemId)
          if (originItem) {
            center = { x: originItem.x, y: originItem.y, z: originItem.z }
          }
        }
      }
    }

    if (!center) {
      center = getSelectedItemsCenter()
    }

    const pivot = pivotRef.value
    if (!center || !pivot) {
      return
    }

    pivot.position.set(center.x, -center.y, center.z)

    const effectiveRotation = getEffectiveGizmoRotation()
    const euler = new Euler(
      (effectiveRotation.x * Math.PI) / 180,
      (effectiveRotation.y * Math.PI) / 180,
      -(effectiveRotation.z * Math.PI) / 180,
      'ZYX'
    )
    pivot.setRotationFromEuler(euler)
  })

  function setOrbitControlsEnabled(enabled: boolean) {
    if (!orbitControlsRef?.value) return

    const wrapper = orbitControlsRef.value as any
    const controls = wrapper.instance

    if (controls && typeof controls.enabled === 'boolean') {
      controls.enabled = enabled
    }
  }

  watch(
    () => {
      if (!transformRef?.value) return null
      return transformRef.value.instance || transformRef.value.value || transformRef.value
    },
    (controls, prevControls) => {
      if (prevControls && prevControls !== controls) {
        touchTranslateController.unpatchTransformControlsPointerMove(
          prevControls as PatchedTransformControls
        )
      }
      if (controls) {
        touchTranslateController.patchTransformControlsPointerMove(controls)
      }
    },
    { immediate: true }
  )

  function startTransform(startEvent?: any) {
    const pivot = pivotRef.value
    if (!pivot) return

    isTransformDragging.value = true
    hasStartedTransform.value = false

    const scheme = editorStore.activeScheme
    if (Alt && Alt.value && scheme && scheme.selectedItemIds.value.size > 0) {
      altDragCopyPending.value = true
      altDragCopyExecuted.value = false
    } else {
      altDragCopyPending.value = false
      altDragCopyExecuted.value = false
    }

    pivot.updateMatrixWorld(true)
    gizmoStartMatrix.copy(pivot.matrixWorld)
    gizmoStartPosition.setFromMatrixPosition(pivot.matrixWorld)

    touchTranslateController.beginSession(startEvent, gizmoStartPosition)

    if (editorStore.gizmoMode === 'rotate' && transformRef?.value) {
      const controls = transformRef.value.instance || transformRef.value.value
      if (controls && controls.axis) {
        const axis = controls.axis.toUpperCase()
        if (axis === 'X' || axis === 'Y' || axis === 'Z') {
          isRotateMode.value = true
          rotateAxis.value = axis as 'X' | 'Y' | 'Z'
          startGizmoRotation.copy(pivot.rotation)
          hasInitializedRotation.value = false
        }
      }
    } else {
      isRotateMode.value = false
      rotateAxis.value = null
    }

    if (scheme) {
      itemStartWorldMatrices.value = buildItemWorldMatricesMap(scheme, scheme.selectedItemIds.value)
      snapEngine.prepareCollisionData(scheme)
    }

    setOrbitControlsEnabled(false)
  }

  function endTransform() {
    touchTranslateController.resetSession()

    isTransformDragging.value = false
    itemStartWorldMatrices.value = new Map()
    hasStartedTransform.value = false
    altDragCopyPending.value = false
    altDragCopyExecuted.value = false
    isRotateMode.value = false
    rotateAxis.value = null
    hasInitializedRotation.value = false
    lastRotationMatrices.value = null
    lastTranslateMatrices.value = null

    snapEngine.clearCollisionData()
    setOrbitControlsEnabled(true)
  }

  function handleGizmoDragging(isDragging: boolean) {
    if (!isDragging) {
      endTransform()
    }
  }

  function handleGizmoMouseDown(event?: any) {
    const sourceEvent = event?.sourceEvent || event
    startTransform(sourceEvent)
  }

  function calculateCurrentTransforms() {
    const pivot = pivotRef.value
    if (!pivot) return null

    pivot.updateMatrixWorld(true)
    const currentGizmoMatrix = pivot.matrixWorld

    scratchInverseStartMatrix.copy(gizmoStartMatrix).invert()
    scratchDeltaMatrix.multiplyMatrices(currentGizmoMatrix, scratchInverseStartMatrix)

    const newWorldMatrices = new Map<string, Matrix4>()
    for (const [id, startWorldMatrix] of itemStartWorldMatrices.value.entries()) {
      const newWorldMatrix = scratchDeltaMatrix.clone().multiply(startWorldMatrix)
      newWorldMatrices.set(id, newWorldMatrix)
    }

    return newWorldMatrices
  }

  async function handleGizmoChange(event?: any) {
    if (!isTransformDragging.value) return

    const pivot = pivotRef.value
    if (!pivot) return

    if (isRotateMode.value && rotateAxis.value) {
      pivot.rotation.copy(startGizmoRotation)
    }

    if (
      isRotateMode.value &&
      rotateAxis.value &&
      activeCameraRef?.value &&
      uiStore.editorContainerRect
    ) {
      const mouseEvent = event?.sourceEvent || (window as any).event
      if (mouseEvent && mouseEvent.clientX !== undefined && mouseEvent.clientY !== undefined) {
        const cameraComponent = activeCameraRef.value
        const camera = cameraComponent?.value || cameraComponent?.instance || cameraComponent
        const gizmoPos = new Vector3().setFromMatrixPosition(pivot.matrixWorld)

        const currentAngle = calculateRotationAngle(
          gizmoPos,
          mouseEvent.clientX,
          mouseEvent.clientY,
          camera,
          rotateAxis.value,
          uiStore.editorContainerRect
        )

        if (currentAngle !== null) {
          if (!hasInitializedRotation.value) {
            startMouseAngle.value = currentAngle
            hasInitializedRotation.value = true
            return
          }

          let deltaAngle = currentAngle - startMouseAngle.value
          if (deltaAngle > Math.PI) {
            deltaAngle -= 2 * Math.PI
          } else if (deltaAngle < -Math.PI) {
            deltaAngle += 2 * Math.PI
          }

          if (
            settingsStore.settings.rotationSnap &&
            settingsStore.settings.rotationSnap > 0 &&
            !isSnapTemporarilyDisabled()
          ) {
            const snapRad = settingsStore.settings.rotationSnap
            deltaAngle = Math.round(deltaAngle / snapRad) * snapRad
          }

          const localRotationMatrix = new Matrix4()
          if (rotateAxis.value === 'X') {
            localRotationMatrix.makeRotationX(deltaAngle)
          } else if (rotateAxis.value === 'Y') {
            localRotationMatrix.makeRotationY(deltaAngle)
          } else {
            localRotationMatrix.makeRotationZ(deltaAngle)
          }

          const gizmoRotationMatrix = new Matrix4().makeRotationFromEuler(pivot.rotation)
          const gizmoRotationInverse = gizmoRotationMatrix.clone().invert()
          const worldRotationMatrix = new Matrix4()
            .multiplyMatrices(gizmoRotationMatrix, localRotationMatrix)
            .multiply(gizmoRotationInverse)

          const newWorldMatrices = new Map<string, Matrix4>()
          const gizmoWorldPos = new Vector3().setFromMatrixPosition(pivot.matrixWorld)

          for (const [id, startMatrix] of itemStartWorldMatrices.value.entries()) {
            const startPos = new Vector3().setFromMatrixPosition(startMatrix)
            const relativePos = startPos.clone().sub(gizmoWorldPos)
            relativePos.applyMatrix4(worldRotationMatrix)
            const newPos = gizmoWorldPos.clone().add(relativePos)

            const newMatrix = worldRotationMatrix.clone().multiply(startMatrix)
            newMatrix.setPosition(newPos)
            newWorldMatrices.set(id, newMatrix)
          }

          if (!hasStartedTransform.value) {
            saveHistory('edit')
            hasStartedTransform.value = true
          }

          lastRotationMatrices.value = newWorldMatrices
          updateSelectedInstancesMatrix(newWorldMatrices, true)
        }
      }

      return
    }

    if (touchTranslateController.tryApply(event, gizmoStartPosition)) {
      return
    }

    if (altDragCopyPending.value && !altDragCopyExecuted.value) {
      pivot.updateMatrixWorld(true)
      const currentPos = new Vector3().setFromMatrixPosition(pivot.matrixWorld)
      const startPos = new Vector3().setFromMatrixPosition(gizmoStartMatrix)
      const distance = currentPos.distanceTo(startPos)

      if (distance > 10) {
        const scheme = editorStore.activeScheme
        if (scheme && scheme.selectedItemIds.value.size > 0) {
          const clipboardData = buildClipboardDataFromSelection()

          if (clipboardData.items.length > 0) {
            isTransformDragging.value = false
            pasteItems(clipboardData, 0, 0)
            altDragCopyExecuted.value = true

            await new Promise((resolve) => requestAnimationFrame(resolve))

            isTransformDragging.value = true
            itemStartWorldMatrices.value = buildItemWorldMatricesMap(
              scheme,
              scheme.selectedItemIds.value
            )
          }
        }
      } else {
        return
      }
    }

    let newWorldMatrices = calculateCurrentTransforms()
    if (!newWorldMatrices) return

    newWorldMatrices = snapEngine.applyCollisionSnap(newWorldMatrices)

    if (!hasStartedTransform.value) {
      saveHistory('edit')
      hasStartedTransform.value = true
    }

    updateSelectedInstancesMatrix(newWorldMatrices, true)
  }

  function handleGizmoMouseUp() {
    if (!hasStartedTransform.value) {
      endTransform()
      return
    }

    let newWorldMatrices: Map<string, Matrix4> | null = null
    if (isRotateMode.value && lastRotationMatrices.value) {
      newWorldMatrices = lastRotationMatrices.value
    } else if (editorStore.gizmoMode === 'translate' && lastTranslateMatrices.value) {
      newWorldMatrices = lastTranslateMatrices.value
    } else {
      newWorldMatrices = calculateCurrentTransforms()
    }

    if (newWorldMatrices) {
      newWorldMatrices = snapEngine.applyCollisionSnap(newWorldMatrices)
      updateSelectedInstancesMatrix(newWorldMatrices, false)

      const updates: any[] = []
      for (const [id, worldMatrix] of newWorldMatrices.entries()) {
        const itemData = matrixTransform.extractItemDataFromWorldMatrix(worldMatrix)
        updates.push({ id, ...itemData })
      }

      if (updates.length > 0) {
        commitBatchedTransform(updates, { saveHistory: false })
      }
    }

    endTransform()
  }

  function buildItemWorldMatricesMap(scheme: any, selectedIds: Set<string>): Map<string, Matrix4> {
    const map = new Map<string, Matrix4>()
    const itemMap = new Map<string, AppItem>()

    scheme.items.value.forEach((item: AppItem) => {
      if (selectedIds.has(item.internalId)) {
        itemMap.set(item.internalId, item)
      }
    })

    for (const id of selectedIds) {
      const item = itemMap.get(id)
      if (item) {
        const currentMode = settingsStore.settings.threeDisplayMode
        const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
        const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
        const useModelScale = !!(currentMode === 'model' && hasValidModel)
        const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)
        map.set(id, matrix)
      }
    }

    return map
  }

  onUnmounted(() => {
    touchTranslateController.cleanup()
    snapEngine.clearCollisionData()
  })

  return {
    shouldShowGizmo,
    isTransformDragging,
    transformSpace,
    handleGizmoDragging,
    handleGizmoMouseDown,
    handleGizmoMouseUp,
    handleGizmoChange,
    setupGizmoAppearance,
  }
}

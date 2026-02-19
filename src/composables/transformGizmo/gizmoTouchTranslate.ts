import { markRaw, ref, type Ref } from 'vue'
import { Matrix4, Plane, Quaternion, Raycaster, Vector2, Vector3, type Object3D } from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import type { useUIStore } from '@/stores/uiStore'

export type TouchTranslateAxis = 'X' | 'Y' | 'Z' | 'XY' | 'XZ' | 'YZ'

interface TouchTranslateBaseState {
  active: boolean
  axis: TouchTranslateAxis
  pointerId: number | null
}

interface TouchTranslateLineState extends TouchTranslateBaseState {
  kind: 'line'
  axis: 'X' | 'Y' | 'Z'
  axisWorld: Vector3
  startParam: number | null
}

interface TouchTranslatePlaneState extends TouchTranslateBaseState {
  kind: 'plane'
  axis: 'XY' | 'XZ' | 'YZ'
  movementPlane: Plane
  startPlanePoint: Vector3 | null
  pivotQuaternion: Quaternion
  pivotQuaternionInverse: Quaternion
}

type TouchTranslateState = TouchTranslateLineState | TouchTranslatePlaneState

export interface PatchedTransformControls {
  pointerMove: (pointer: any) => void
  dragging?: boolean
  axis?: string | null
  __momoPointerMovePatched?: boolean
  __momoOriginalPointerMove?: (pointer: any) => void
}

interface CreateGizmoTouchTranslateControllerOptions {
  editorStore: ReturnType<typeof useEditorStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  uiStore: ReturnType<typeof useUIStore>
  pivotRef: Ref<Object3D | null>
  transformRef?: Ref<any | null>
  activeCameraRef?: Ref<any | null>
  itemStartWorldMatrices: Ref<Map<string, Matrix4>>
  isTransformDragging: Ref<boolean>
  isSnapTemporarilyDisabled: () => boolean
  applyCollisionSnap: (newWorldMatrices: Map<string, Matrix4>) => Map<string, Matrix4>
  onFirstTransform: () => void
  onPreviewMatrices: (newWorldMatrices: Map<string, Matrix4>) => void
}

export function createGizmoTouchTranslateController({
  editorStore,
  settingsStore,
  uiStore,
  pivotRef,
  transformRef,
  activeCameraRef,
  itemStartWorldMatrices,
  isTransformDragging,
  isSnapTemporarilyDisabled,
  applyCollisionSnap,
  onFirstTransform,
  onPreviewMatrices,
}: CreateGizmoTouchTranslateControllerOptions) {
  const touchRaycaster = markRaw(new Raycaster())
  const touchPointerNdc = markRaw(new Vector2())

  const touchTranslateState = ref<TouchTranslateState | null>(null)
  const touchPointerPoint = ref<{ x: number; y: number } | null>(null)

  let touchPointerMoveHandler: ((evt: PointerEvent) => void) | null = null
  let touchPointerEndHandler: ((evt: PointerEvent) => void) | null = null
  const patchedControlsRef = ref<PatchedTransformControls | null>(null)

  function isCoarsePointerDevice(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(pointer: coarse)').matches
  }

  function getControlsAxis(): string | null {
    const controls: any =
      (transformRef?.value && (transformRef.value.instance || transformRef.value.value)) || null
    return controls?.axis ?? null
  }

  function isTouchTranslateAxis(axis: string | null): axis is TouchTranslateAxis {
    return (
      axis === 'X' ||
      axis === 'Y' ||
      axis === 'Z' ||
      axis === 'XY' ||
      axis === 'XZ' ||
      axis === 'YZ'
    )
  }

  function getTouchTranslateAxis(): TouchTranslateAxis | null {
    const axis = getControlsAxis()
    if (!axis) return null
    const normalizedAxis = axis.toUpperCase()
    return isTouchTranslateAxis(normalizedAxis) ? normalizedAxis : null
  }

  function shouldUseCustomTouchTranslate(): boolean {
    if (editorStore.gizmoMode !== 'translate') return false
    if (!isCoarsePointerDevice()) return false
    return getTouchTranslateAxis() !== null
  }

  function clearTouchPointerTracking() {
    if (typeof document === 'undefined') {
      touchPointerMoveHandler = null
      touchPointerEndHandler = null
      touchPointerPoint.value = null
      return
    }

    if (touchPointerMoveHandler) {
      document.removeEventListener('pointermove', touchPointerMoveHandler)
      touchPointerMoveHandler = null
    }
    if (touchPointerEndHandler) {
      document.removeEventListener('pointerup', touchPointerEndHandler)
      document.removeEventListener('pointercancel', touchPointerEndHandler)
      touchPointerEndHandler = null
    }
    touchPointerPoint.value = null
  }

  function setupTouchPointerTracking(pointerId: number | null, onTranslate: (event?: any) => void) {
    clearTouchPointerTracking()
    if (typeof document === 'undefined') return

    touchPointerMoveHandler = (evt: PointerEvent) => {
      if (evt.pointerType !== 'touch') return
      const state = touchTranslateState.value
      if (!state?.active) return

      if (state.pointerId === null) {
        state.pointerId = evt.pointerId
      }
      if (evt.pointerId !== state.pointerId) return

      touchPointerPoint.value = { x: evt.clientX, y: evt.clientY }
      onTranslate(evt)
    }

    touchPointerEndHandler = (evt: PointerEvent) => {
      const state = touchTranslateState.value
      if (!state?.active) return
      if (evt.pointerType !== 'touch') return
      if (state.pointerId !== null && evt.pointerId !== state.pointerId) return

      touchPointerPoint.value = null
    }

    document.addEventListener('pointermove', touchPointerMoveHandler, { passive: true })
    document.addEventListener('pointerup', touchPointerEndHandler, { passive: true })
    document.addEventListener('pointercancel', touchPointerEndHandler, { passive: true })

    if (pointerId !== null && touchTranslateState.value) {
      touchTranslateState.value.pointerId = pointerId
    }
  }

  function shouldBypassTransformControlsPointerMove(
    controls: PatchedTransformControls,
    pointer: any
  ): boolean {
    if (!touchTranslateState.value?.active) return false
    if (!isTransformDragging.value) return false
    if (editorStore.gizmoMode !== 'translate') return false
    if (!controls?.dragging) return false

    const activeState = touchTranslateState.value
    if (!activeState) return false

    const axis = typeof controls.axis === 'string' ? controls.axis.toUpperCase() : null
    if (!isTouchTranslateAxis(axis)) return false
    if (axis !== activeState.axis) return false

    if (pointer && typeof pointer.button === 'number' && pointer.button !== -1) return false
    return true
  }

  function unpatchTransformControlsPointerMove(controls?: PatchedTransformControls | null) {
    const target = controls ?? patchedControlsRef.value
    if (!target?.__momoPointerMovePatched || !target.__momoOriginalPointerMove) return

    target.pointerMove = target.__momoOriginalPointerMove
    delete target.__momoOriginalPointerMove
    delete target.__momoPointerMovePatched

    if (patchedControlsRef.value === target) {
      patchedControlsRef.value = null
    }
  }

  function patchTransformControlsPointerMove(controls: any) {
    if (!controls || typeof controls.pointerMove !== 'function') return

    const target = controls as PatchedTransformControls
    if (target.__momoPointerMovePatched) return

    const originalPointerMove = target.pointerMove
    target.__momoOriginalPointerMove = originalPointerMove
    target.pointerMove = function patchedPointerMove(pointer: any) {
      if (shouldBypassTransformControlsPointerMove(this as PatchedTransformControls, pointer)) {
        return
      }
      return originalPointerMove.call(this, pointer)
    }
    target.__momoPointerMovePatched = true
    patchedControlsRef.value = target
  }

  function getTouchClientPoint(event?: any): { x: number; y: number } | null {
    const sourceEvt = event?.sourceEvent || event
    if (
      sourceEvt &&
      sourceEvt.pointerType === 'touch' &&
      typeof sourceEvt.clientX === 'number' &&
      typeof sourceEvt.clientY === 'number'
    ) {
      const state = touchTranslateState.value
      if (state?.active) {
        if (state.pointerId === null && typeof sourceEvt.pointerId === 'number') {
          state.pointerId = sourceEvt.pointerId
        }
        if (
          state.pointerId !== null &&
          typeof sourceEvt.pointerId === 'number' &&
          sourceEvt.pointerId !== state.pointerId
        ) {
          return touchPointerPoint.value
        }
      }

      touchPointerPoint.value = { x: sourceEvt.clientX, y: sourceEvt.clientY }
      return touchPointerPoint.value
    }

    return touchPointerPoint.value
  }

  function projectTouchPointToAxisParam(
    clientPoint: { x: number; y: number },
    axisWorld: Vector3,
    axisOrigin: Vector3
  ): number | null {
    const cameraComponent = activeCameraRef?.value
    if (!cameraComponent || !uiStore.editorContainerRect) return null
    const camera = cameraComponent?.value || cameraComponent?.instance || cameraComponent
    if (!camera) return null

    const rect = uiStore.editorContainerRect
    if (rect.width <= 0 || rect.height <= 0) return null

    touchPointerNdc.x = ((clientPoint.x - rect.left) / rect.width) * 2 - 1
    touchPointerNdc.y = -((clientPoint.y - rect.top) / rect.height) * 2 + 1
    touchRaycaster.setFromCamera(touchPointerNdc, camera)

    const rayOrigin = touchRaycaster.ray.origin
    const rayDir = touchRaycaster.ray.direction

    const w0 = axisOrigin.clone().sub(rayOrigin)
    const b = axisWorld.dot(rayDir)
    const d = axisWorld.dot(w0)
    const e = rayDir.dot(w0)
    const denom = 1 - b * b

    if (Math.abs(denom) < 1e-4) {
      return null
    }

    return (b * e - d) / denom
  }

  function projectTouchPointToPlanePoint(
    clientPoint: { x: number; y: number },
    movementPlane: Plane
  ): Vector3 | null {
    const cameraComponent = activeCameraRef?.value
    if (!cameraComponent || !uiStore.editorContainerRect) return null
    const camera = cameraComponent?.value || cameraComponent?.instance || cameraComponent
    if (!camera) return null

    const rect = uiStore.editorContainerRect
    if (rect.width <= 0 || rect.height <= 0) return null

    touchPointerNdc.x = ((clientPoint.x - rect.left) / rect.width) * 2 - 1
    touchPointerNdc.y = -((clientPoint.y - rect.top) / rect.height) * 2 + 1
    touchRaycaster.setFromCamera(touchPointerNdc, camera)

    const intersection = new Vector3()
    const hit = touchRaycaster.ray.intersectPlane(movementPlane, intersection)
    if (!hit) return null
    return intersection
  }

  function buildTouchTranslateMatrices(translation: Vector3): Map<string, Matrix4> {
    const newWorldMatrices = new Map<string, Matrix4>()
    const deltaMatrix = new Matrix4().makeTranslation(translation.x, translation.y, translation.z)

    for (const [id, startWorldMatrix] of itemStartWorldMatrices.value.entries()) {
      const nextWorldMatrix = deltaMatrix.clone().multiply(startWorldMatrix)
      newWorldMatrices.set(id, nextWorldMatrix)
    }

    return newWorldMatrices
  }

  function syncPivotToNewMatrices(
    newWorldMatrices: Map<string, Matrix4>,
    gizmoStartPosition: Vector3
  ) {
    if (!touchTranslateState.value?.active) return
    const firstEntry = itemStartWorldMatrices.value.entries().next()
    if (firstEntry.done) return

    const [firstId, firstStartMatrix] = firstEntry.value
    const firstNewMatrix = newWorldMatrices.get(firstId)
    const pivot = pivotRef.value
    if (!firstNewMatrix || !pivot) return

    const startPos = new Vector3().setFromMatrixPosition(firstStartMatrix)
    const newPos = new Vector3().setFromMatrixPosition(firstNewMatrix)
    const offset = newPos.sub(startPos)
    const pivotPos = gizmoStartPosition.clone().add(offset)

    pivot.position.copy(pivotPos)
    pivot.updateMatrixWorld(true)
  }

  function applyCustomTouchTranslate(event: any, gizmoStartPosition: Vector3): boolean {
    const state = touchTranslateState.value
    if (!state?.active) return false
    if (editorStore.gizmoMode !== 'translate') return false
    if (!isTransformDragging.value) return false

    const currentPoint = getTouchClientPoint(event)
    if (!currentPoint) return false

    const disableSnap = isSnapTemporarilyDisabled()
    const snap = settingsStore.settings.translationSnap

    let translation: Vector3 | null = null
    if (state.kind === 'line') {
      const currentParam = projectTouchPointToAxisParam(
        currentPoint,
        state.axisWorld,
        gizmoStartPosition
      )
      if (currentParam === null) return false

      if (state.startParam === null) {
        state.startParam = currentParam
        return true
      }

      let delta = currentParam - state.startParam
      if (snap && snap > 0 && !disableSnap) {
        delta = Math.round(delta / snap) * snap
      }
      translation = state.axisWorld.clone().multiplyScalar(delta)
    } else {
      const currentPlanePoint = projectTouchPointToPlanePoint(currentPoint, state.movementPlane)
      if (!currentPlanePoint) return false

      if (!state.startPlanePoint) {
        state.startPlanePoint = currentPlanePoint.clone()
        return true
      }

      const worldDelta = currentPlanePoint.clone().sub(state.startPlanePoint)
      const localDelta = worldDelta.clone().applyQuaternion(state.pivotQuaternionInverse)

      if (state.axis === 'XY') {
        localDelta.z = 0
      } else if (state.axis === 'XZ') {
        localDelta.y = 0
      } else {
        localDelta.x = 0
      }

      if (snap && snap > 0 && !disableSnap) {
        if (state.axis.includes('X')) localDelta.x = Math.round(localDelta.x / snap) * snap
        if (state.axis.includes('Y')) localDelta.y = Math.round(localDelta.y / snap) * snap
        if (state.axis.includes('Z')) localDelta.z = Math.round(localDelta.z / snap) * snap
      }

      translation = localDelta.applyQuaternion(state.pivotQuaternion)
    }

    let newWorldMatrices = buildTouchTranslateMatrices(translation)
    newWorldMatrices = applyCollisionSnap(newWorldMatrices)

    onFirstTransform()
    onPreviewMatrices(newWorldMatrices)
    syncPivotToNewMatrices(newWorldMatrices, gizmoStartPosition)
    return true
  }

  function beginSession(startEvent: any, gizmoStartPosition: Vector3) {
    resetSession()
    if (!shouldUseCustomTouchTranslate()) return

    const axis = getTouchTranslateAxis()
    const pivot = pivotRef.value
    if (!axis || !pivot) return

    const pointerId =
      typeof startEvent?.pointerId === 'number' && startEvent?.pointerType === 'touch'
        ? startEvent.pointerId
        : null

    if (axis === 'X' || axis === 'Y' || axis === 'Z') {
      const axisWorld = new Vector3(
        axis === 'X' ? 1 : 0,
        axis === 'Y' ? 1 : 0,
        axis === 'Z' ? 1 : 0
      )
      axisWorld.applyQuaternion(pivot.quaternion).normalize()

      touchTranslateState.value = {
        active: true,
        kind: 'line',
        axis,
        axisWorld,
        startParam: null,
        pointerId,
      }
    } else {
      const planeNormal = new Vector3(
        axis === 'YZ' ? 1 : 0,
        axis === 'XZ' ? 1 : 0,
        axis === 'XY' ? 1 : 0
      )
      planeNormal.applyQuaternion(pivot.quaternion).normalize()
      const movementPlane = new Plane().setFromNormalAndCoplanarPoint(
        planeNormal,
        gizmoStartPosition
      )
      const pivotQuaternion = pivot.quaternion.clone()
      const pivotQuaternionInverse = pivotQuaternion.clone().invert()

      touchTranslateState.value = {
        active: true,
        kind: 'plane',
        axis,
        movementPlane,
        startPlanePoint: null,
        pivotQuaternion,
        pivotQuaternionInverse,
        pointerId,
      }
    }

    setupTouchPointerTracking(pointerId, (event) =>
      applyCustomTouchTranslate(event, gizmoStartPosition)
    )

    const initialPoint = getTouchClientPoint(startEvent)
    if (!initialPoint || !touchTranslateState.value) return

    if (touchTranslateState.value.kind === 'line') {
      touchTranslateState.value.startParam = projectTouchPointToAxisParam(
        initialPoint,
        touchTranslateState.value.axisWorld,
        gizmoStartPosition
      )
      return
    }

    touchTranslateState.value.startPlanePoint = projectTouchPointToPlanePoint(
      initialPoint,
      touchTranslateState.value.movementPlane
    )
  }

  function tryApply(event?: any, gizmoStartPosition?: Vector3): boolean {
    if (!touchTranslateState.value?.active || editorStore.gizmoMode !== 'translate') return false
    if (!gizmoStartPosition) return false
    return applyCustomTouchTranslate(event, gizmoStartPosition)
  }

  function resetSession() {
    clearTouchPointerTracking()
    touchTranslateState.value = null
  }

  function cleanup() {
    resetSession()
    unpatchTransformControlsPointerMove()
  }

  return {
    beginSession,
    tryApply,
    resetSession,
    cleanup,
    patchTransformControlsPointerMove,
    unpatchTransformControlsPointerMove,
  }
}

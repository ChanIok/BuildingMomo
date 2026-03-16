import { ref, markRaw, type Ref } from 'vue'
import { Raycaster, Vector2, type Camera } from 'three'
import {
  computeBounds,
  isPointInPolygon,
  type ScreenPoint,
  type ScreenRect,
} from '@/lib/interaction/screenGeometry'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorSelection } from './editor/useEditorSelection'
import { useEditorGroups } from './editor/useEditorGroups'
import { useEditorSelectionAction } from './useEditorSelectionAction'
import type { InteractionAdapter } from './renderer/types'

type SelectionRect = ScreenRect

export function useThreeSelection(
  cameraRef: Ref<Camera | null>,
  interactionAdapter: Ref<InteractionAdapter>,
  transformDraggingRef?: Ref<boolean>
) {
  const raycaster = markRaw(new Raycaster())
  const pointerNdc = markRaw(new Vector2())
  const editorStore = useEditorStore()
  const uiStore = useUIStore()

  const selectionRect = ref<SelectionRect | null>(null)
  const isSelecting = ref(false)
  const lassoPoints = ref<ScreenPoint[]>([])
  const mouseDownPos = ref<ScreenPoint | null>(null)

  const { deselectItems, updateSelection, intersectSelection, clearSelection } =
    useEditorSelection()

  const { setGroupOrigin } = useEditorGroups()

  const { activeAction: effectiveAction, forceIndividualSelection } = useEditorSelectionAction()

  function getRelativePosition(evt: any) {
    const rect = uiStore.editorContainerRect
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
      rect,
    }
  }

  function handlePointerDown(evt: any) {
    if (transformDraggingRef?.value) return
    if (evt.button !== 0) return

    const pos = getRelativePosition(evt)

    mouseDownPos.value = { x: pos.x, y: pos.y }
    selectionRect.value = null
    lassoPoints.value = []
    isSelecting.value = false
  }

  function handlePointerMove(evt: any) {
    if (transformDraggingRef?.value) return
    if (!mouseDownPos.value) return
    if (evt.buttons === 0) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const dx = pos.x - mouseDownPos.value.x
    const dy = pos.y - mouseDownPos.value.y
    const distance = Math.hypot(dx, dy)

    if (!isSelecting.value && distance >= 3) {
      isSelecting.value = true
    }

    if (!isSelecting.value) return

    if (editorStore.selectionMode === 'lasso') {
      const lastPoint = lassoPoints.value[lassoPoints.value.length - 1]
      if (!lastPoint) {
        lassoPoints.value.push({ x: pos.x, y: pos.y })
        return
      }

      if (Math.hypot(pos.x - lastPoint.x, pos.y - lastPoint.y) > 1) {
        lassoPoints.value.push({ x: pos.x, y: pos.y })
      }

      return
    }

    selectionRect.value = {
      x: Math.min(mouseDownPos.value.x, pos.x),
      y: Math.min(mouseDownPos.value.y, pos.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    }
  }

  function cancelSelectionSession() {
    mouseDownPos.value = null
    isSelecting.value = false
    selectionRect.value = null
    lassoPoints.value = []
  }

  function handlePointerUp(evt: any) {
    if (transformDraggingRef?.value) {
      cancelSelectionSession()
      return
    }

    const start = mouseDownPos.value
    const rectInfo = selectionRect.value
    const lasso = lassoPoints.value

    mouseDownPos.value = null

    if (!start) {
      cancelSelectionSession()
      return
    }

    const pos = getRelativePosition(evt)
    const dx = pos.x - start.x
    const dy = pos.y - start.y
    const distance = Math.hypot(dx, dy)

    // isSelecting 在 Move 时已经由 distance >= 3 触发，但 PointerUp
    // 可能在没有 Move 事件的情况下触发（例如极快的点击），
    // 此处再次检查 distance 作为兜底，确保微小移动不被当作框选提交。
    if (!isSelecting.value || distance < 3) {
      performClickSelection(evt)
    } else if (editorStore.selectionMode === 'lasso') {
      performLassoSelection(lasso)
    } else if (rectInfo) {
      performBoxSelection(rectInfo)
    }

    cancelSelectionSession()
  }

  function handleGroupOriginClick(evt: any) {
    const camera = cameraRef.value
    if (!camera) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    const hit = interactionAdapter.value.pick(raycaster)

    if (!hit) {
      uiStore.setSelectingGroupOrigin(false)
      return
    }

    const groupId = uiStore.selectingForGroupId
    if (groupId !== null) {
      setGroupOrigin(groupId, hit.internalId)
      uiStore.setSelectingGroupOrigin(false)
    }
  }

  function handlePivotItemClick(evt: any) {
    const camera = cameraRef.value
    if (!camera) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    const hit = interactionAdapter.value.pick(raycaster)
    if (!hit) {
      uiStore.setSelectingPivotItem(false)
      return
    }

    const item = editorStore.itemsMap.get(hit.internalId)
    if (item) {
      uiStore.setSelectedPivotPosition({ x: item.x, y: item.y, z: item.z })
    }

    uiStore.setSelectingPivotItem(false)
  }

  function handleAlignReferenceClick(evt: any) {
    const camera = cameraRef.value
    if (!camera) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    const hit = interactionAdapter.value.pick(raycaster)
    if (hit) {
      uiStore.setAlignReferenceItem(hit.internalId)
    }

    uiStore.setSelectingAlignReference(false)
  }

  function performClickSelection(evt: any) {
    if (uiStore.isSelectingPivotItem) {
      handlePivotItemClick(evt)
      return
    }

    if (uiStore.isSelectingGroupOrigin) {
      handleGroupOriginClick(evt)
      return
    }

    if (uiStore.isSelectingAlignReference) {
      handleAlignReferenceClick(evt)
      return
    }

    const camera = cameraRef.value
    if (!camera) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    const hit = interactionAdapter.value.pick(raycaster)
    applySelectionAction(hit ? [hit.internalId] : [], {
      clearOnEmptyNew: true,
      applyIntersectOnEmpty: false,
    })
  }

  function performBoxSelection(rect: SelectionRect) {
    const camera = cameraRef.value
    if (!camera) return

    const viewport = uiStore.editorContainerRect
    const selectedIds = new Set<string>()
    const right = rect.x + rect.width
    const bottom = rect.y + rect.height

    interactionAdapter.value.forEachRegionCenterCandidate(
      camera,
      viewport,
      ({ internalId, center }) => {
        if (center.x < rect.x || center.x > right || center.y < rect.y || center.y > bottom) return

        selectedIds.add(internalId)
      }
    )

    applySelectionAction([...selectedIds], {
      clearOnEmptyNew: true,
      applyIntersectOnEmpty: true,
    })
  }

  function performLassoSelection(points: ScreenPoint[]) {
    const camera = cameraRef.value
    if (!camera || points.length < 3) return

    const viewport = uiStore.editorContainerRect
    const selectedIds = new Set<string>()
    const lassoBounds = computeBounds(points)

    interactionAdapter.value.forEachRegionCenterCandidate(
      camera,
      viewport,
      ({ internalId, center }) => {
        if (
          center.x < lassoBounds.minX ||
          center.x > lassoBounds.maxX ||
          center.y < lassoBounds.minY ||
          center.y > lassoBounds.maxY
        ) {
          return
        }

        if (!isPointInPolygon(center, points)) return
        selectedIds.add(internalId)
      }
    )

    applySelectionAction([...selectedIds], {
      clearOnEmptyNew: true,
      applyIntersectOnEmpty: true,
    })
  }

  function applySelectionAction(
    selectedIds: string[],
    options: { clearOnEmptyNew: boolean; applyIntersectOnEmpty: boolean }
  ) {
    const action = effectiveAction.value
    const skipGroupExpansion = forceIndividualSelection.value

    if (selectedIds.length === 0) {
      if (action === 'new' && options.clearOnEmptyNew) {
        clearSelection()
      }

      if (!(action === 'intersect' && options.applyIntersectOnEmpty)) {
        return
      }
    }

    switch (action) {
      case 'add':
        updateSelection(selectedIds, true, { skipGroupExpansion })
        break
      case 'subtract':
        // 此处 selectedIds 已由上方的前置检查保证非空
        deselectItems(selectedIds, { skipGroupExpansion })
        break
      case 'intersect':
        intersectSelection(selectedIds, { skipGroupExpansion })
        break
      case 'toggle': {
        const scheme = editorStore.activeScheme
        const currentSelected = scheme?.selectedItemIds.value
        const toSelect: string[] = []
        const toDeselect: string[] = []

        for (const id of selectedIds) {
          if (currentSelected?.has(id)) {
            toDeselect.push(id)
          } else {
            toSelect.push(id)
          }
        }

        if (toDeselect.length > 0) {
          deselectItems(toDeselect, { skipGroupExpansion })
        }
        if (toSelect.length > 0) {
          updateSelection(toSelect, true, { skipGroupExpansion })
        }
        break
      }
      case 'new':
      default:
        updateSelection(selectedIds, false, { skipGroupExpansion })
        break
    }
  }

  return {
    selectionRect,
    lassoPoints,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    performClickSelection,
    cancelSelectionSession,
  }
}

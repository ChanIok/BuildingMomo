import { ref, type Ref } from 'vue'
import { Raycaster, Vector2, Vector3, Box3, type Camera, type Object3D } from 'three'
import type { useEditorStore } from '@/stores/editorStore'

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export function useThreeSelection(
  editorStore: ReturnType<typeof useEditorStore>,
  cameraRef: Ref<Camera | null>,
  meshRefs: Ref<Object3D[]>,
  containerRef: Ref<HTMLElement | null>
) {
  const raycaster = new Raycaster()
  const pointerNdc = new Vector2()

  const selectionRect = ref<SelectionRect | null>(null)
  const isSelecting = ref(false)
  const mouseDownPos = ref<{ x: number; y: number } | null>(null)

  function getRelativePosition(evt: any) {
    const el = containerRef.value
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
      rect,
    }
  }

  function handlePointerDown(evt: any) {
    if (evt.button !== 0) return
    if (typeof evt.stopPropagation === 'function') {
      evt.stopPropagation()
    }
    const pos = getRelativePosition(evt)
    if (!pos) return
    mouseDownPos.value = { x: pos.x, y: pos.y }
    selectionRect.value = null
    isSelecting.value = false
  }

  function handlePointerMove(evt: any) {
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

    if (isSelecting.value) {
      selectionRect.value = {
        x: Math.min(mouseDownPos.value.x, pos.x),
        y: Math.min(mouseDownPos.value.y, pos.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      }
    }
  }

  function handlePointerUp(evt: any) {
    // pointerleave: 只清理状态，不触发点击/框选逻辑
    if (evt.type === 'pointerleave') {
      mouseDownPos.value = null
      isSelecting.value = false
      selectionRect.value = null
      return
    }

    const start = mouseDownPos.value
    const rectInfo = selectionRect.value

    mouseDownPos.value = null

    const pos = getRelativePosition(evt)
    if (!start || !pos) {
      isSelecting.value = false
      selectionRect.value = null
      return
    }

    const dx = pos.x - start.x
    const dy = pos.y - start.y
    const distance = Math.hypot(dx, dy)

    if (!isSelecting.value || distance < 3 || !rectInfo) {
      performClickSelection(evt)
    } else {
      performBoxSelection(evt, rectInfo)
    }

    isSelecting.value = false
    selectionRect.value = null
  }

  function performClickSelection(evt: any) {
    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos

    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1

    raycaster.setFromCamera(pointerNdc, camera)
    const intersects = raycaster.intersectObjects(meshRefs.value, false)
    const hit = intersects[0]

    if (hit && hit.object && hit.object.userData?.internalId) {
      const id = hit.object.userData.internalId as string
      const shift = evt.shiftKey
      const alt = evt.altKey

      if (alt) {
        editorStore.deselectItems([id])
      } else {
        editorStore.toggleSelection(id, shift)
      }
    } else {
      if (!evt.shiftKey) {
        editorStore.clearSelection()
      }
    }
  }

  function performBoxSelection(evt: any, rect: SelectionRect) {
    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const containerRect = container.getBoundingClientRect()

    const selectedIds: string[] = []
    const box = new Box3()
    const corner = new Vector3()

    for (const obj of meshRefs.value) {
      if (!obj) continue

      box.setFromObject(obj)
      if (box.isEmpty()) continue

      const corners: Vector3[] = [
        new Vector3(box.min.x, box.min.y, box.min.z),
        new Vector3(box.min.x, box.min.y, box.max.z),
        new Vector3(box.min.x, box.max.y, box.min.z),
        new Vector3(box.min.x, box.max.y, box.max.z),
        new Vector3(box.max.x, box.min.y, box.min.z),
        new Vector3(box.max.x, box.min.y, box.max.z),
        new Vector3(box.max.x, box.max.y, box.min.z),
        new Vector3(box.max.x, box.max.y, box.max.z),
      ]

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      for (const c of corners) {
        corner.copy(c).project(camera)

        const sx = ((corner.x + 1) * 0.5) * containerRect.width
        const sy = ((-corner.y + 1) * 0.5) * containerRect.height

        if (sx < minX) minX = sx
        if (sx > maxX) maxX = sx
        if (sy < minY) minY = sy
        if (sy > maxY) maxY = sy
      }

      const selLeft = rect.x
      const selTop = rect.y
      const selRight = rect.x + rect.width
      const selBottom = rect.y + rect.height

      const itemLeft = minX
      const itemTop = minY
      const itemRight = maxX
      const itemBottom = maxY

      const intersects =
        itemRight >= selLeft &&
        itemLeft <= selRight &&
        itemBottom >= selTop &&
        itemTop <= selBottom

      if (intersects && obj.userData?.internalId) {
        selectedIds.push(obj.userData.internalId as string)
      }
    }

    const alt = evt.altKey
    const shift = evt.shiftKey

    if (alt) {
      if (selectedIds.length > 0) {
        editorStore.deselectItems(selectedIds)
      }
    } else {
      editorStore.updateSelection(selectedIds, shift)
    }
  }

  return {
    selectionRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}

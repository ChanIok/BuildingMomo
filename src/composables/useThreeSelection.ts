import { ref, markRaw, type Ref } from 'vue'
import { Raycaster, Vector2, Vector3, type Camera, type InstancedMesh } from 'three'
import { coordinates3D } from '@/lib/coordinates'
import type { useEditorStore } from '@/stores/editorStore'

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

interface SelectionSources {
  instancedMesh: Ref<InstancedMesh | null>
  indexToIdMap: Ref<Map<number, string>>
}

export function useThreeSelection(
  editorStore: ReturnType<typeof useEditorStore>,
  cameraRef: Ref<Camera | null>,
  selectionSources: SelectionSources,
  containerRef: Ref<HTMLElement | null>,
  transformDraggingRef?: Ref<boolean>
) {
  const raycaster = markRaw(new Raycaster())
  const pointerNdc = markRaw(new Vector2())

  const selectionRect = ref<SelectionRect | null>(null)
  const isSelecting = ref(false)
  const mouseDownPos = ref<{ x: number; y: number } | null>(null)
  const tempVec3 = markRaw(new Vector3())

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
    if (transformDraggingRef?.value) return
    // 排除右键（button === 2），留给右键菜单处理
    if (evt.button === 2) return
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
    if (transformDraggingRef?.value) {
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

    let internalId: string | null = null

    const instancedMesh = selectionSources.instancedMesh.value
    const idMap = selectionSources.indexToIdMap.value
    if (!instancedMesh || !idMap) return

    const intersects = raycaster.intersectObject(instancedMesh, false)

    const hit = intersects[0]

    if (hit && hit.instanceId !== undefined) {
      internalId = idMap.get(hit.instanceId) ?? null
    }

    if (internalId) {
      const shift = evt.shiftKey
      const alt = evt.altKey

      if (alt) {
        editorStore.deselectItems([internalId])
      } else {
        editorStore.toggleSelection(internalId, shift)
      }
    } else if (!evt.shiftKey) {
      editorStore.clearSelection()
    }
  }

  function performBoxSelection(evt: any, rect: SelectionRect) {
    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const containerRect = container.getBoundingClientRect()

    const selLeft = rect.x
    const selTop = rect.y
    const selRight = rect.x + rect.width
    const selBottom = rect.y + rect.height

    const idMap = selectionSources.indexToIdMap.value
    if (!idMap) return

    const visibleItems = editorStore.items

    // 先构建一个 id -> item 的映射，确保只处理当前实例化的物品
    const itemById = new Map<string, any>()
    for (const item of visibleItems) {
      itemById.set(item.internalId, item)
    }

    const selectedIds: string[] = []

    for (const id of idMap.values()) {
      const item = itemById.get(id)
      if (!item) continue

      // 使用游戏坐标转换为 Three.js 世界坐标，再投影到屏幕空间
      coordinates3D.setThreeFromGame(tempVec3, { x: item.x, y: item.y, z: item.z })
      tempVec3.project(camera)

      const sx = (tempVec3.x + 1) * 0.5 * containerRect.width
      const sy = (-tempVec3.y + 1) * 0.5 * containerRect.height

      const withinRect = sx >= selLeft && sx <= selRight && sy >= selTop && sy <= selBottom

      if (withinRect) {
        selectedIds.push(id)
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
    performClickSelection,
  }
}

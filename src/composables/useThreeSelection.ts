import { ref, markRaw, type Ref } from 'vue'
import { Raycaster, Vector2, Vector3, type Camera } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorSelection } from './editor/useEditorSelection'
import { useEditorGroups } from './editor/useEditorGroups'
import { useEditorSelectionAction } from './useEditorSelectionAction'
import type { PickingConfig } from './renderer/types'

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

interface SelectionSources {
  pickingConfig: Ref<PickingConfig>
}

export function useThreeSelection(
  cameraRef: Ref<Camera | null>,
  selectionSources: SelectionSources,
  containerRef: Ref<HTMLElement | null>,
  transformDraggingRef?: Ref<boolean>
) {
  const raycaster = markRaw(new Raycaster())
  const pointerNdc = markRaw(new Vector2())
  const editorStore = useEditorStore()
  const uiStore = useUIStore()

  const selectionRect = ref<SelectionRect | null>(null)
  const isSelecting = ref(false)
  const lassoPoints = ref<{ x: number; y: number }[]>([])
  const mouseDownPos = ref<{ x: number; y: number } | null>(null)
  const tempVec3 = markRaw(new Vector3())
  const tempCameraPos = markRaw(new Vector3())
  const tempCameraForward = markRaw(new Vector3())

  const { deselectItems, updateSelection, intersectSelection, clearSelection } =
    useEditorSelection()

  const { setGroupOrigin } = useEditorGroups()

  // 计算当前有效的选择行为（结合 Store 设置和键盘修饰键）
  const { activeAction: effectiveAction, forceIndividualSelection } = useEditorSelectionAction()

  function getRelativePosition(evt: any) {
    // 性能优化：使用 Store 中的缓存 Rect，避免 getBoundingClientRect()
    const rect = uiStore.editorContainerRect
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
    const pos = getRelativePosition(evt)
    if (!pos) return
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

    if (isSelecting.value) {
      if (editorStore.selectionMode === 'lasso') {
        // 优化 1：采样优化，减少点数
        const lastPoint = lassoPoints.value[lassoPoints.value.length - 1]
        if (!lastPoint) {
          lassoPoints.value.push({ x: pos.x, y: pos.y })
        } else {
          const dist = Math.hypot(pos.x - lastPoint.x, pos.y - lastPoint.y)
          // 仅当移动距离超过 10px 时才记录新点
          if (dist > 1) {
            lassoPoints.value.push({ x: pos.x, y: pos.y })
          }
        }
      } else {
        selectionRect.value = {
          x: Math.min(mouseDownPos.value.x, pos.x),
          y: Math.min(mouseDownPos.value.y, pos.y),
          width: Math.abs(dx),
          height: Math.abs(dy),
        }
      }
    }
  }

  function handlePointerUp(evt: any) {
    if (transformDraggingRef?.value) {
      mouseDownPos.value = null
      isSelecting.value = false
      selectionRect.value = null
      lassoPoints.value = []
      return
    }

    const start = mouseDownPos.value
    const rectInfo = selectionRect.value
    const lasso = lassoPoints.value

    mouseDownPos.value = null

    const pos = getRelativePosition(evt)
    if (!start || !pos) {
      isSelecting.value = false
      selectionRect.value = null
      lassoPoints.value = []
      return
    }

    const dx = pos.x - start.x
    const dy = pos.y - start.y
    const distance = Math.hypot(dx, dy)

    if (!isSelecting.value || distance < 3) {
      performClickSelection(evt)
    } else if (editorStore.selectionMode === 'lasso') {
      performLassoSelection(lasso)
    } else if (rectInfo) {
      performBoxSelection(rectInfo)
    }

    isSelecting.value = false
    selectionRect.value = null
    lassoPoints.value = []
  }

  /**
   * 处理组合原点选择模式下的点击
   */
  function handleGroupOriginClick(evt: any) {
    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    // 使用统一的拾取接口
    const config = selectionSources.pickingConfig.value
    const hit = config.performRaycast(raycaster)

    if (hit) {
      const clickedItemId = hit.internalId
      const groupId = uiStore.selectingForGroupId

      if (groupId !== null) {
        // 设置组合原点
        setGroupOrigin(groupId, clickedItemId)

        // 退出选择模式
        uiStore.setSelectingGroupOrigin(false)
      }
    } else {
      // 点击空白处,退出选择模式
      uiStore.setSelectingGroupOrigin(false)
    }
  }

  /**
   * 处理定点旋转物品选择模式下的点击
   */
  function handlePivotItemClick(evt: any) {
    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    // 使用统一的拾取接口
    const config = selectionSources.pickingConfig.value
    const hit = config.performRaycast(raycaster)

    if (hit) {
      const clickedItemId = hit.internalId
      // 从 itemsMap 获取物品位置
      const item = editorStore.itemsMap.get(clickedItemId)

      if (item) {
        // 将物品位置传递给 uiStore（数据空间坐标）
        uiStore.setSelectedPivotPosition({ x: item.x, y: item.y, z: item.z })

        // 退出选择模式
        uiStore.setSelectingPivotItem(false)
      }
    } else {
      // 点击空白处,退出选择模式
      uiStore.setSelectingPivotItem(false)
    }
  }

  /**
   * 处理对齐参照物选择模式下的点击
   */
  function handleAlignReferenceClick(evt: any) {
    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos
    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1
    raycaster.setFromCamera(pointerNdc, camera)

    // 使用统一的拾取接口
    const config = selectionSources.pickingConfig.value
    const hit = config.performRaycast(raycaster)

    if (hit) {
      const clickedItemId = hit.internalId
      // 设置参照物
      uiStore.setAlignReferenceItem(clickedItemId)
      // 退出选择模式
      uiStore.setSelectingAlignReference(false)
    } else {
      // 点击空白处,退出选择模式
      uiStore.setSelectingAlignReference(false)
    }
  }

  function performClickSelection(evt: any) {
    // 🎯 定点旋转物品选择模式拦截
    if (uiStore.isSelectingPivotItem) {
      handlePivotItemClick(evt)
      return // 提前返回，不执行正常选择逻辑
    }

    // 🎯 组合原点选择模式拦截
    if (uiStore.isSelectingGroupOrigin) {
      handleGroupOriginClick(evt)
      return // 提前返回，不执行正常选择逻辑
    }

    // 🎯 对齐参照物选择模式拦截
    if (uiStore.isSelectingAlignReference) {
      handleAlignReferenceClick(evt)
      return // 提前返回，不执行正常选择逻辑
    }

    const camera = cameraRef.value
    const container = containerRef.value
    if (!camera || !container) return

    const pos = getRelativePosition(evt)
    if (!pos) return

    const { rect, x, y } = pos

    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1

    raycaster.setFromCamera(pointerNdc, camera)

    // ✨ 使用统一的拾取接口
    const config = selectionSources.pickingConfig.value
    const hit = config.performRaycast(raycaster)

    const internalId = hit?.internalId ?? null

    if (internalId) {
      const action = effectiveAction.value
      // Ctrl 键控制是否强制单选（不扩展到组）
      const skipGroupExpansion = forceIndividualSelection.value

      switch (action) {
        case 'toggle': {
          // Toggle: 如果已选中则取消，未选中则选中
          const scheme = editorStore.activeScheme
          const isSelected = scheme?.selectedItemIds.value.has(internalId)
          if (isSelected) {
            deselectItems([internalId], { skipGroupExpansion })
          } else {
            updateSelection([internalId], true, { skipGroupExpansion })
          }
          break
        }
        case 'add':
          // 加选：如果已选中则不变（符合多选习惯），或者 toggle？
          // 通常多选模式下，点击未选中的是加选，点击已选中的可能是不变或减选
          // 这里使用 updateSelection(..., true) 是加选逻辑（Set.add）
          updateSelection([internalId], true, { skipGroupExpansion })
          break
        case 'subtract':
          deselectItems([internalId], { skipGroupExpansion })
          break
        case 'intersect':
          // 点击单个物品做交叉选区：
          // 如果该物品在当前选区中，则结果只剩该物品
          // 如果不在，则结果为空
          intersectSelection([internalId], { skipGroupExpansion })
          break
        case 'new':
        default:
          // 新选区：清空其他，选中当前
          // 优化：如果点击的是当前已选中的，且没有拖拽，是否保持选中？
          // updateSelection(..., false) 会先 clear 再 add
          updateSelection([internalId], false, { skipGroupExpansion })
          break
      }
    } else {
      // 点击空白处
      // 仅在 'new' 模式下清空选择，其他模式下点击空白通常不产生副作用（或者看具体软件习惯）
      // PS/Blender 中，加选/减选模式点击空白通常不会清空现有选择
      if (effectiveAction.value === 'new') {
        clearSelection()
      }
    }
  }

  function performBoxSelection(rect: SelectionRect) {
    const camera = cameraRef.value
    if (!camera) return

    const containerRect = uiStore.editorContainerRect

    const selLeft = rect.x
    const selTop = rect.y
    const selRight = rect.x + rect.width
    const selBottom = rect.y + rect.height

    // ✨ 使用统一的索引映射
    const idMap = selectionSources.pickingConfig.value.indexToIdMap.value
    if (!idMap) return

    const itemById = editorStore.itemsMap
    if (!itemById) return

    const selectedIds: string[] = []
    // Ctrl 键控制是否强制单选（不扩展到组）
    const skipGroupExpansion = forceIndividualSelection.value
    camera.getWorldPosition(tempCameraPos)
    camera.getWorldDirection(tempCameraForward)

    for (const id of idMap.values()) {
      const item = itemById.get(id)
      if (!item) continue

      // 数据坐标 -> 世界坐标（投影前需要应用场景父级 Y 翻转）
      tempVec3.set(item.x, -item.y, item.z)

      // 仅排除摄像机后方物体，保留前方穿透式框选行为
      const toPointX = tempVec3.x - tempCameraPos.x
      const toPointY = tempVec3.y - tempCameraPos.y
      const toPointZ = tempVec3.z - tempCameraPos.z
      const dot =
        toPointX * tempCameraForward.x +
        toPointY * tempCameraForward.y +
        toPointZ * tempCameraForward.z
      if (dot <= 0) continue

      tempVec3.project(camera)

      const sx = (tempVec3.x + 1) * 0.5 * containerRect.width
      const sy = (-tempVec3.y + 1) * 0.5 * containerRect.height

      const withinRect = sx >= selLeft && sx <= selRight && sy >= selTop && sy <= selBottom

      if (withinRect) {
        selectedIds.push(id)
      }
    }

    const action = effectiveAction.value

    if (selectedIds.length === 0 && action === 'new') {
      clearSelection()
      return
    }

    if (selectedIds.length > 0 || action === 'intersect') {
      switch (action) {
        case 'add':
          updateSelection(selectedIds, true, { skipGroupExpansion })
          break
        case 'subtract':
          if (selectedIds.length > 0) {
            deselectItems(selectedIds, { skipGroupExpansion })
          }
          break
        case 'intersect':
          intersectSelection(selectedIds, { skipGroupExpansion })
          break
        case 'toggle': {
          // Toggle: 对框选中的每个物品逐个判断选中状态
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
  }

  function performLassoSelection(points: { x: number; y: number }[]) {
    const camera = cameraRef.value
    if (!camera || points.length < 3) return

    const containerRect = uiStore.editorContainerRect

    // ✨ 使用统一的索引映射
    const idMap = selectionSources.pickingConfig.value.indexToIdMap.value
    if (!idMap) return

    const itemById = editorStore.itemsMap
    if (!itemById) return

    const selectedIds: string[] = []
    // Ctrl 键控制是否强制单选（不扩展到组）
    const skipGroupExpansion = forceIndividualSelection.value
    camera.getWorldPosition(tempCameraPos)
    camera.getWorldDirection(tempCameraForward)

    // 优化 2：包围盒预筛选
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }

    for (const id of idMap.values()) {
      const item = itemById.get(id)
      if (!item) continue

      tempVec3.set(item.x, -item.y, item.z)

      // 仅排除摄像机后方物体，保留前方穿透式框选行为
      const toPointX = tempVec3.x - tempCameraPos.x
      const toPointY = tempVec3.y - tempCameraPos.y
      const toPointZ = tempVec3.z - tempCameraPos.z
      const dot =
        toPointX * tempCameraForward.x +
        toPointY * tempCameraForward.y +
        toPointZ * tempCameraForward.z
      if (dot <= 0) continue

      tempVec3.project(camera)

      const sx = (tempVec3.x + 1) * 0.5 * containerRect.width
      const sy = (-tempVec3.y + 1) * 0.5 * containerRect.height

      // 如果点不在包围盒内，直接跳过昂贵的多边形检测
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) {
        continue
      }

      if (isPointInPolygon({ x: sx, y: sy }, points)) {
        selectedIds.push(id)
      }
    }

    const action = effectiveAction.value

    if (selectedIds.length === 0 && action === 'new') {
      clearSelection()
      return
    }

    if (selectedIds.length > 0 || action === 'intersect') {
      switch (action) {
        case 'add':
          updateSelection(selectedIds, true, { skipGroupExpansion })
          break
        case 'subtract':
          if (selectedIds.length > 0) {
            deselectItems(selectedIds, { skipGroupExpansion })
          }
          break
        case 'intersect':
          intersectSelection(selectedIds, { skipGroupExpansion })
          break
        case 'toggle': {
          // Toggle: 对套索选中的每个物品逐个判断选中状态
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
  }

  function isPointInPolygon(point: { x: number; y: number }, vs: { x: number; y: number }[]) {
    let x = point.x,
      y = point.y
    let inside = false
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const pi = vs[i]
      const pj = vs[j]

      if (!pi || !pj) continue

      let xi = pi.x,
        yi = pi.y
      let xj = pj.x,
        yj = pj.y

      let intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersect) inside = !inside
    }
    return inside
  }

  return {
    selectionRect,
    lassoPoints,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    performClickSelection,
  }
}

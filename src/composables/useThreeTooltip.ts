import { ref, markRaw, type Ref } from 'vue'
import { Raycaster, Vector2, type Camera, type InstancedMesh } from 'three'
import type { useFurnitureStore } from '@/stores/furnitureStore'
import type { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from './useI18n'

export interface ThreeTooltipData {
  name: string
  icon: string
  position: { x: number; y: number } // 相对于 three 容器的屏幕坐标
}

interface ThreeTooltipSources {
  instancedMesh: Ref<InstancedMesh | null>
  indexToIdMap: Ref<Map<number, string>>
}

export function useThreeTooltip(
  editorStore: ReturnType<typeof useEditorStore>,
  furnitureStore: ReturnType<typeof useFurnitureStore>,
  cameraRef: Ref<Camera | null>,
  containerRef: Ref<HTMLElement | null>,
  sources: ThreeTooltipSources,
  isEnabled: Ref<boolean>,
  isTransformDragging?: Ref<boolean>,
  setHoveredItemId?: (id: string | null) => void
) {
  const raycaster = markRaw(new Raycaster())
  const pointerNdc = markRaw(new Vector2())
  const { t, locale } = useI18n()
  const uiStore = useUIStore()

  const tooltipVisible = ref(false)
  const tooltipData = ref<ThreeTooltipData | null>(null)

  // 射线检测的时间戳，用于手动节流
  let lastRaycastTime = 0
  const RAYCAST_INTERVAL = 50 // ms

  function hideTooltip() {
    if (tooltipVisible.value || tooltipData.value) {
      tooltipVisible.value = false
      tooltipData.value = null
    }
    if (setHoveredItemId) {
      setHoveredItemId(null)
    }
  }

  function handlePointerMove(evt: PointerEvent, isSelecting: boolean) {
    const camera = cameraRef.value
    const container = containerRef.value

    if (!camera || !container) {
      hideTooltip()
      return
    }

    // 功能未启用或当前处于交互中（框选 / Gizmo / 任意按键按下）时隐藏 tooltip
    if (!isEnabled.value || isSelecting || isTransformDragging?.value || evt.buttons !== 0) {
      hideTooltip()
      return
    }

    // 性能优化：直接从 Store 获取缓存的 Rect，避免触发 Layout Thrashing
    const rect = uiStore.editorContainerRect
    const x = evt.clientX - rect.left
    const y = evt.clientY - rect.top

    // 1. 优先更新位置：如果 Tooltip 当前可见，必须实时更新位置以保证视觉流畅（跟随鼠标）
    if (tooltipData.value) {
      tooltipData.value.position = { x, y }
    }

    // 防御：指针不在容器内
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      hideTooltip()
      return
    }

    // 2. 节流检测：限制昂贵的 Raycaster 调用频率
    const now = Date.now()
    if (now - lastRaycastTime < RAYCAST_INTERVAL) {
      return
    }
    lastRaycastTime = now

    pointerNdc.x = (x / rect.width) * 2 - 1
    pointerNdc.y = -(y / rect.height) * 2 + 1

    raycaster.setFromCamera(pointerNdc, camera)

    const instancedMesh = sources.instancedMesh.value
    const idMap = sources.indexToIdMap.value

    if (!instancedMesh || !idMap) {
      hideTooltip()
      return
    }

    const intersects = raycaster.intersectObject(instancedMesh, false)

    const hit = intersects[0]

    let internalId: string | null = null

    if (hit && hit.instanceId !== undefined) {
      internalId = idMap.get(hit.instanceId) ?? null
    }

    if (!internalId) {
      hideTooltip()
      return
    }

    // 性能优化：使用 Map O(1) 查找替代数组 find O(N)
    const item = editorStore.itemsMap.get(internalId)

    if (!item) {
      hideTooltip()
      return
    }

    const furnitureInfo = furnitureStore.getFurniture(item.gameId)

    let name = ''
    if (!furnitureInfo) {
      name = t('sidebar.itemDefaultName', { id: item.gameId })
    } else {
      name =
        locale.value === 'zh'
          ? furnitureInfo.name_cn
          : furnitureInfo.name_en || furnitureInfo.name_cn
    }

    tooltipData.value = {
      name,
      icon: furnitureInfo ? furnitureStore.getIconUrl(item.gameId) : '',
      position: { x, y },
    }

    tooltipVisible.value = true

    if (setHoveredItemId) {
      setHoveredItemId(internalId)
    }
  }

  return {
    tooltipVisible,
    tooltipData,
    handlePointerMove,
    hideTooltip,
  }
}

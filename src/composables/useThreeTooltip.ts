import { ref, markRaw, type Ref } from 'vue'
import { Raycaster, Vector2, type Camera } from 'three'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from './useI18n'
import type { PickingConfig } from './renderer/types'
import { RAYCAST_SKIP_ITEM_THRESHOLD } from '@/types/constants'

export interface ThreeTooltipData {
  name: string
  icon: string
  position: { x: number; y: number } // 相对于 three 容器的屏幕坐标
  gameId: number
  instanceId: number
}

interface ThreeTooltipSources {
  pickingConfig: Ref<PickingConfig>
}

interface PendingRaycast {
  ndcX: number
  ndcY: number
  screenX: number
  screenY: number
}

export function useThreeTooltip(
  cameraRef: Ref<Camera | null>,
  containerRef: Ref<HTMLElement | null>,
  sources: ThreeTooltipSources,
  isEnabled: Ref<boolean>,
  isTransformDragging?: Ref<boolean>,
  setHoveredItemId?: (id: string | null) => void,
  isCameraMoving?: Ref<boolean>
) {
  const raycaster = markRaw(new Raycaster())
  const pointerNdc = markRaw(new Vector2())
  const { t, locale } = useI18n()
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()
  const uiStore = useUIStore()

  const tooltipVisible = ref(false)
  const tooltipData = ref<ThreeTooltipData | null>(null)

  // 异步检测状态
  let isRaycasting = false
  // 待处理的检测请求（记录最新位置）
  let pendingRaycast: PendingRaycast | null = null

  function hideTooltip() {
    // 取消进行中的异步检测
    sources.pickingConfig.value.cancelRaycast()
    // 清空待处理请求
    pendingRaycast = null

    if (tooltipVisible.value || tooltipData.value) {
      tooltipVisible.value = false
      tooltipData.value = null
    }
    if (setHoveredItemId) {
      setHoveredItemId(null)
    }
  }

  /**
   * 执行射线检测（核心逻辑）
   *
   * @param ndcX - NDC 坐标 X (-1 ~ 1)
   * @param ndcY - NDC 坐标 Y (-1 ~ 1)
   * @param screenX - 屏幕坐标 X（相对于容器）
   * @param screenY - 屏幕坐标 Y（相对于容器）
   */
  async function executeRaycast(ndcX: number, ndcY: number, screenX: number, screenY: number) {
    const camera = cameraRef.value

    if (!camera) {
      hideTooltip()
      return
    }

    isRaycasting = true
    // 清空待处理请求（开始执行时）
    // 注意：在 await 期间，pendingRaycast 可能会被重新赋值
    pendingRaycast = null

    pointerNdc.x = ndcX
    pointerNdc.y = ndcY

    raycaster.setFromCamera(pointerNdc, camera)

    // ✨ 使用异步时间切片拾取接口（不阻塞主线程）
    const config = sources.pickingConfig.value
    const hit = await config.performRaycastAsync(raycaster)

    isRaycasting = false

    // ✨ 关键：检测完成后，如果有待处理请求，递归执行它
    // 注：在 await 期间，handlePointerMove 可能会被调用并设置 pendingRaycast
    // TypeScript 静态分析无法感知这一点，所以需要类型断言
    const pending = pendingRaycast as PendingRaycast | null
    if (pending !== null) {
      pendingRaycast = null
      await executeRaycast(pending.ndcX, pending.ndcY, pending.screenX, pending.screenY)
      return
    }

    // 检测被取消或无结果
    if (!hit) {
      hideTooltip()
      return
    }

    // 性能优化：使用 Map O(1) 查找替代数组 find O(N)
    const item = editorStore.itemsMap.get(hit.internalId)

    if (!item) {
      hideTooltip()
      return
    }

    const furnitureInfo = gameDataStore.getFurniture(item.gameId)

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
      icon: furnitureInfo ? gameDataStore.getIconUrl(item.gameId) : '',
      position: { x: screenX, y: screenY },
      gameId: item.gameId,
      instanceId: item.instanceId,
    }

    tooltipVisible.value = true

    if (setHoveredItemId) {
      setHoveredItemId(hit.internalId)
    }
  }

  async function handlePointerMove(evt: PointerEvent, isSelecting: boolean) {
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

    // 性能优化：物品数超过阈值且相机正在移动时，跳过射线检测以避免卡顿
    const itemCount = editorStore.activeScheme?.items.value.length ?? 0
    if (itemCount > RAYCAST_SKIP_ITEM_THRESHOLD && isCameraMoving?.value) {
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

    // 计算 NDC 坐标
    const ndcX = (x / rect.width) * 2 - 1
    const ndcY = -(y / rect.height) * 2 + 1

    // ✨ 关键改动：如果已有检测在进行中，记录为待处理请求（确保最后位置被检测）
    if (isRaycasting) {
      pendingRaycast = { ndcX, ndcY, screenX: x, screenY: y }
      return
    }

    // 执行射线检测
    await executeRaycast(ndcX, ndcY, x, y)
  }

  return {
    tooltipVisible,
    tooltipData,
    handlePointerMove,
    hideTooltip,
  }
}

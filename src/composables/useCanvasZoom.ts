import { ref, type Ref, onMounted, onUnmounted, nextTick } from 'vue'
import type { useEditorStore } from '../stores/editorStore'

export function useCanvasZoom(editorStore: ReturnType<typeof useEditorStore>, stageRef: Ref<any>) {
  // Stage 配置
  const stageWidth = ref(window.innerWidth - 256) // 减去侧边栏宽度
  const stageHeight = ref(window.innerHeight - 56) // 减去工具栏高度

  const stageConfig = ref({
    width: stageWidth.value,
    height: stageHeight.value,
    draggable: false, // 默认不可拖拽，按空格键时启用
    x: stageWidth.value / 2,
    y: stageHeight.value / 2,
  })

  // 缩放比例
  const scale = ref(1)

  // 滚轮事件节流相关
  let wheelRafId: number | null = null
  let pendingWheelEvent: any = null

  // 处理窗口大小变化
  function handleResize() {
    stageWidth.value = window.innerWidth - 256
    stageHeight.value = window.innerHeight - 56
    stageConfig.value.width = stageWidth.value
    stageConfig.value.height = stageHeight.value
  }

  // 处理缩放（使用 RAF 节流）
  function handleWheel(e: any) {
    e.evt.preventDefault()

    // 保存事件数据
    pendingWheelEvent = {
      deltaY: e.evt.deltaY,
      stage: e.target.getStage(),
    }

    // 如果已经有待处理的帧，跳过
    if (wheelRafId !== null) return

    // 使用 requestAnimationFrame 节流
    wheelRafId = requestAnimationFrame(() => {
      if (!pendingWheelEvent) {
        wheelRafId = null
        return
      }

      const { deltaY, stage } = pendingWheelEvent
      const oldScale = stage.scaleX()
      const pointer = stage.getPointerPosition()

      if (!pointer) {
        wheelRafId = null
        pendingWheelEvent = null
        return
      }

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      }

      // 计算新的缩放比例
      const scaleBy = 1.1
      const newScale = deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy

      // 限制缩放范围（百分之一到10倍）
      const clampedScale = Math.max(0.01, Math.min(10, newScale))
      scale.value = clampedScale

      stage.scale({ x: clampedScale, y: clampedScale })

      // 调整位置使鼠标指针为中心
      const newPos = {
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      }
      stage.position(newPos)

      // 重置状态
      wheelRafId = null
      pendingWheelEvent = null
    })
  }

  // 计算最佳视图（自适应缩放和居中）
  function fitToView() {
    const bounds = editorStore.bounds
    if (!bounds) return

    const padding = 100 // 边距
    const scaleX = (stageWidth.value - padding * 2) / bounds.width
    const scaleY = (stageHeight.value - padding * 2) / bounds.height
    const fitScale = Math.max(0.01, Math.min(scaleX, scaleY, 1)) // 最小百分之一，最大不放大

    // 调整最小缩放限制，避免太小导致标点看不清
    const adjustedFitScale = Math.max(fitScale, 0.05) // 最小5%缩放

    // 计算偏移使内容居中
    const offsetX = stageWidth.value / 2 - bounds.centerX * adjustedFitScale
    const offsetY = stageHeight.value / 2 - bounds.centerY * adjustedFitScale

    // 应用到 stage
    scale.value = adjustedFitScale
    stageConfig.value.x = offsetX
    stageConfig.value.y = offsetY

    // 保存为初始配置
    editorStore.updateInitialViewConfig({ scale: adjustedFitScale, x: offsetX, y: offsetY })

    // 同步到 Stage 实例
    nextTick(() => {
      const stage = stageRef.value?.getStage()
      if (stage) {
        stage.scale({ x: adjustedFitScale, y: adjustedFitScale })
        stage.position({ x: offsetX, y: offsetY })
      }
    })
  }

  // 重置视图
  function resetView() {
    const config = editorStore.initialViewConfig
    if (!config) {
      // 如果没有初始配置，重新计算
      fitToView()
      return
    }

    scale.value = config.scale
    stageConfig.value.x = config.x
    stageConfig.value.y = config.y

    const stage = stageRef.value?.getStage()
    if (stage) {
      stage.scale({ x: config.scale, y: config.scale })
      stage.position({ x: config.x, y: config.y })
    }
  }

  // 放大（以画布中心为基准）
  function zoomIn() {
    const stage = stageRef.value?.getStage()
    if (!stage) return

    const oldScale = stage.scaleX()
    const scaleBy = 1.2
    const newScale = Math.min(10, oldScale * scaleBy) // 最大10倍

    // 以画布中心为缩放中心
    const centerPoint = {
      x: stageWidth.value / 2,
      y: stageHeight.value / 2,
    }

    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    }

    scale.value = newScale
    stage.scale({ x: newScale, y: newScale })

    const newPos = {
      x: centerPoint.x - mousePointTo.x * newScale,
      y: centerPoint.y - mousePointTo.y * newScale,
    }
    stage.position(newPos)
    stageConfig.value.x = newPos.x
    stageConfig.value.y = newPos.y
  }

  // 缩小（以画布中心为基准）
  function zoomOut() {
    const stage = stageRef.value?.getStage()
    if (!stage) return

    const oldScale = stage.scaleX()
    const scaleBy = 1.2
    const newScale = Math.max(0.01, oldScale / scaleBy) // 最小0.01倍

    // 以画布中心为缩放中心
    const centerPoint = {
      x: stageWidth.value / 2,
      y: stageHeight.value / 2,
    }

    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    }

    scale.value = newScale
    stage.scale({ x: newScale, y: newScale })

    const newPos = {
      x: centerPoint.x - mousePointTo.x * newScale,
      y: centerPoint.y - mousePointTo.y * newScale,
    }
    stage.position(newPos)
    stageConfig.value.x = newPos.x
    stageConfig.value.y = newPos.y
  }

  // 生命周期钩子
  onMounted(() => {
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
  })

  return {
    scale,
    stageConfig,
    stageWidth,
    stageHeight,
    handleWheel,
    fitToView,
    resetView,
    zoomIn,
    zoomOut,
  }
}

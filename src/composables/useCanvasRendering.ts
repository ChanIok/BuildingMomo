import { ref, watch, type Ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import Konva from 'konva'
import { getItemRenderer } from './useItemRenderer'

export function useCanvasRendering(
  editorStore: ReturnType<typeof useEditorStore>,
  scale: Ref<number>
) {
  // Layer 引用
  const mainLayerRef = ref<any>(null)
  const interactionLayerRef = ref<any>(null)

  // 是否隐藏选中物品（拖拽时使用）
  const hideSelectedItems = ref(false)

  // 物品渲染器
  const renderer = getItemRenderer()

  // 批量绘制所有物品
  function updateMainLayer() {
    const layer = mainLayerRef.value?.getNode()
    if (!layer) return

    // 清空现有内容
    layer.destroyChildren()

    const visibleItems = editorStore.visibleItems
    if (visibleItems.length === 0) {
      layer.batchDraw()
      return
    }

    // 预加载可见物品的图标（异步，不阻塞渲染）
    renderer.preloadIcons(visibleItems, scale.value)

    // 创建批量绘制的 Shape
    const shape = new Konva.Shape({
      sceneFunc: (context) => {
        // 使用统一的渲染器绘制所有物品
        renderer.drawItems(context, visibleItems, {
          scale: scale.value,
          editorStore,
          // 拖拽时跳过选中物品的渲染
          skipItemCheck: (item) =>
            hideSelectedItems.value && editorStore.selectedItemIds.has(item.internalId),
        })
      },
      // 启用碰撞检测
      hitFunc: (context, shape) => {
        // 使用统一的渲染器绘制碰撞区域
        renderer.drawHitRegions(context, shape, visibleItems, {
          scale: scale.value,
          editorStore,
          // 拖拽时跳过选中物品的碰撞检测
          skipItemCheck: (item) =>
            hideSelectedItems.value && editorStore.selectedItemIds.has(item.internalId),
        })
      },
    })

    layer.add(shape)
    layer.batchDraw()
  }

  // 设置是否隐藏选中物品
  function setHideSelectedItems(hide: boolean) {
    hideSelectedItems.value = hide
    updateMainLayer()
  }

  // 监听变化，自动更新
  watch(
    () => [
      editorStore.visibleItems.length,
      editorStore.selectedItemIds.size,
      editorStore.heightFilter.currentMin,
      editorStore.heightFilter.currentMax,
      scale.value,
      // 监听物品数据变化（包括 GroupID 变化）
      editorStore.items.map((item) => item.originalData.GroupID).join(','),
    ],
    () => {
      updateMainLayer()
    },
    { immediate: true }
  )

  return {
    mainLayerRef,
    interactionLayerRef,
    updateMainLayer,
    setHideSelectedItems,
  }
}

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useI18n } from '@/composables/app/useI18n'
import {
  getSlidePathLocalPoints,
  isSlidePathItem,
  withSlidePathLocalPoints,
  withSlidePathLocalPointValue,
  type SlidePathAxis,
  type SlidePathPoint,
} from '@/lib/geometry/slidePath'

const editorStore = useEditorStore()
const uiStore = useUIStore()
const { recordTransaction } = useEditorHistory()
const { t } = useI18n()
const MIN_POINT_COUNT = 2
const DEFAULT_POINT_SPACING = 400

// 当前选中的飞花道物品，仅单选时显示编辑面板
const selectedSlideItem = computed(() => {
  void editorStore.sceneVersion
  void editorStore.selectionVersion

  const scheme = editorStore.activeScheme
  if (!scheme || scheme.selectedItemIds.value.size !== 1) return null

  const selectedId = Array.from(scheme.selectedItemIds.value)[0]
  const item = selectedId ? editorStore.itemsMap.get(selectedId) : null
  return isSlidePathItem(item) ? item : null
})

const points = computed(() =>
  selectedSlideItem.value ? getSlidePathLocalPoints(selectedSlideItem.value) : []
)

function formatValue(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

// 替换飞花道节点：findIndex 定位 → 不可变更新 → transaction 包装 → 触发场景重建
function replacePoints(
  intent: string,
  targetItemId: string,
  nextPoints: SlidePathPoint[]
): boolean {
  const scheme = editorStore.activeScheme
  if (!scheme) return false

  const targetIndex = scheme.items.value.findIndex((item) => item.internalId === targetItemId)
  if (targetIndex === -1) return false

  const targetItem = scheme.items.value[targetIndex]!
  const updatedItem = withSlidePathLocalPoints(targetItem, nextPoints)
  if (updatedItem === targetItem) return false

  recordTransaction(intent, () => {
    const items = [...scheme.items.value]
    items[targetIndex] = updatedItem
    scheme.items.value = items
  })
  editorStore.triggerSceneUpdate()
  return true
}

// 计算新增节点的坐标：沿最后两个节点的方向延伸，无前驱时沿 X 轴默认间距
function buildAddedPoints(currentPoints: SlidePathPoint[]): SlidePathPoint[] {
  if (currentPoints.length === 0) {
    return [
      [0, 0, 0],
      [DEFAULT_POINT_SPACING, 0, 0],
    ]
  }

  const last = currentPoints[currentPoints.length - 1]!
  if (currentPoints.length === 1) {
    return [...currentPoints, [last[0] + DEFAULT_POINT_SPACING, last[1], last[2]]]
  }

  const previous = currentPoints[currentPoints.length - 2]!
  const delta: SlidePathPoint = [
    last[0] - previous[0],
    last[1] - previous[1],
    last[2] - previous[2],
  ]
  return [...currentPoints, [last[0] + delta[0], last[1] + delta[1], last[2] + delta[2]]]
}

function addPoint() {
  const targetItem = selectedSlideItem.value
  if (!targetItem) return

  const nextPoints = buildAddedPoints(points.value)
  if (replacePoints('slide_path.point.add', targetItem.internalId, nextPoints)) {
    uiStore.setActiveSlidePathPoint({
      itemId: targetItem.internalId,
      pointIndex: nextPoints.length - 1,
    })
  }
}

// 删除节点后修正 activeSlidePathPoint 索引：删除的是当前节点则清除，删除在前则索引减一
function deletePoint(pointIndex: number) {
  const targetItem = selectedSlideItem.value
  if (!targetItem || points.value.length <= MIN_POINT_COUNT) return

  const deleted = replacePoints(
    'slide_path.point.delete',
    targetItem.internalId,
    points.value.filter((_, index) => index !== pointIndex)
  )
  if (!deleted || uiStore.activeSlidePathPoint?.itemId !== targetItem.internalId) return

  const activeIndex = uiStore.activeSlidePathPoint.pointIndex
  if (activeIndex === pointIndex) {
    uiStore.setActiveSlidePathPoint(null)
  } else if (activeIndex > pointIndex) {
    uiStore.setActiveSlidePathPoint({
      itemId: targetItem.internalId,
      pointIndex: activeIndex - 1,
    })
  }
}

// 交换相邻节点顺序，同步修正 activeSlidePathPoint 索引
function movePoint(pointIndex: number, direction: -1 | 1) {
  const targetItem = selectedSlideItem.value
  const targetIndex = pointIndex + direction
  if (!targetItem || targetIndex < 0 || targetIndex >= points.value.length) return

  const nextPoints = [...points.value]
  ;[nextPoints[pointIndex], nextPoints[targetIndex]] = [
    nextPoints[targetIndex]!,
    nextPoints[pointIndex]!,
  ]

  if (!replacePoints('slide_path.point.move', targetItem.internalId, nextPoints)) return

  const activePoint = uiStore.activeSlidePathPoint
  if (activePoint?.itemId !== targetItem.internalId) return

  if (activePoint.pointIndex === pointIndex) {
    uiStore.setActiveSlidePathPoint({ itemId: targetItem.internalId, pointIndex: targetIndex })
  } else if (activePoint.pointIndex === targetIndex) {
    uiStore.setActiveSlidePathPoint({ itemId: targetItem.internalId, pointIndex })
  }
}

// 侧边栏输入框变更：校验数值 → 定位目标 item → 不可变更新单个轴 → transaction 写入
function updatePointValue(pointIndex: number, axis: SlidePathAxis, event: Event) {
  const scheme = editorStore.activeScheme
  const targetItem = selectedSlideItem.value
  if (!scheme || !targetItem) return

  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (!Number.isFinite(value)) {
    input.value = formatValue(points.value[pointIndex]?.[axis] ?? 0)
    return
  }

  if (points.value[pointIndex]?.[axis] === value) {
    input.value = formatValue(value)
    return
  }

  const targetIndex = scheme.items.value.findIndex(
    (item) => item.internalId === targetItem.internalId
  )
  if (targetIndex === -1) return

  const target = scheme.items.value[targetIndex]!
  const nextItem = withSlidePathLocalPointValue(target, pointIndex, axis, value)
  if (!nextItem) return

  recordTransaction('slide_path.point.update', () => {
    const items = [...scheme.items.value]
    items[targetIndex] = nextItem
    scheme.items.value = items
  })
  editorStore.triggerSceneUpdate()
  uiStore.setActiveSlidePathPoint({
    itemId: targetItem.internalId,
    pointIndex,
  })
}
</script>

<template>
  <div v-if="selectedSlideItem" class="flex flex-col gap-3 border-t border-sidebar-border pt-3">
    <div class="flex items-center justify-between gap-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-semibold text-sidebar-foreground">
          {{ t('transform.slidePath.title') }}
        </span>
        <span class="text-[10px] text-muted-foreground">
          {{ t('transform.slidePath.localHint') }}
        </span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {{ t('transform.slidePath.pointCount', { n: points.length }) }}
        </span>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-md bg-sidebar-accent text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          :title="t('transform.slidePath.addPoint')"
          @click="addPoint"
        >
          <Plus class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div
        v-if="points.length === 0"
        class="rounded-md bg-sidebar-accent/60 px-2 py-3 text-xs text-muted-foreground"
      >
        {{ t('transform.slidePath.empty') }}
      </div>

      <div
        v-for="(point, pointIndex) in points"
        :key="pointIndex"
        class="rounded-md bg-sidebar-accent/60 px-2 py-2"
      >
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-semibold text-sidebar-foreground">
              {{ t('transform.slidePath.pointLabel', { n: pointIndex + 1 }) }}
            </span>
            <span v-if="pointIndex === 0" class="text-[10px] text-amber-500">
              {{ t('transform.slidePath.originPoint') }}
            </span>
          </div>
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              :disabled="pointIndex === 0"
              :title="t('transform.slidePath.moveUp')"
              @click="movePoint(pointIndex, -1)"
            >
              <ArrowUp class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              :disabled="pointIndex === points.length - 1"
              :title="t('transform.slidePath.moveDown')"
              @click="movePoint(pointIndex, 1)"
            >
              <ArrowDown class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              :disabled="points.length <= MIN_POINT_COUNT"
              :title="
                points.length <= MIN_POINT_COUNT
                  ? t('transform.slidePath.deleteDisabled')
                  : t('transform.slidePath.deletePoint')
              "
              @click="deletePoint(pointIndex)"
            >
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-1.5">
          <label class="group flex min-w-0 items-center rounded-md bg-background px-1.5 py-1">
            <span class="mr-1 text-[10px] font-bold text-red-500 dark:text-red-500/90">X</span>
            <input
              type="number"
              step="any"
              :value="formatValue(point[0])"
              @change="(event) => updatePointValue(pointIndex, 0, event)"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </label>
          <label class="group flex min-w-0 items-center rounded-md bg-background px-1.5 py-1">
            <span class="mr-1 text-[10px] font-bold text-green-500 dark:text-green-500/90">Y</span>
            <input
              type="number"
              step="any"
              :value="formatValue(point[1])"
              @change="(event) => updatePointValue(pointIndex, 1, event)"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </label>
          <label class="group flex min-w-0 items-center rounded-md bg-background px-1.5 py-1">
            <span class="mr-1 text-[10px] font-bold text-blue-500 dark:text-blue-500/90">Z</span>
            <input
              type="number"
              step="any"
              :value="formatValue(point[2])"
              @change="(event) => updatePointValue(pointIndex, 2, event)"
              class="w-full min-w-0 [appearance:textfield] bg-transparent text-xs text-sidebar-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { Download, Maximize2, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { aiChatKey } from '@/composables/ai/chatContext'
import { downloadBlob } from '@/composables/fileOps/download'
import { useI18n } from '@/composables/useI18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ImageReference } from '@/lib/ai/types'

const props = defineProps<{
  open: boolean
  image: ImageReference | null
  loadImage?: (id: string) => Promise<Blob | undefined>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const chat = inject(aiChatKey)!
const { t } = useI18n()

const viewportRef = ref<HTMLElement | null>(null)
// Keep the outgoing image and its geometry alive until Dialog finishes leaving.
const displayedImage = shallowRef<ImageReference | null>(null)
const url = ref('')
const currentBlob = ref<Blob | null>(null)
const isLoading = ref(false)

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)

const naturalWidth = computed(() => displayedImage.value?.width || 0)
const naturalHeight = computed(() => displayedImage.value?.height || 0)

let startMouseX = 0
let startMouseY = 0
let initialTranslateX = 0
let initialTranslateY = 0

function cleanupUrl() {
  if (url.value) {
    URL.revokeObjectURL(url.value)
    url.value = ''
  }
  currentBlob.value = null
}

function clearPreview() {
  cleanupUrl()
  displayedImage.value = null
  isLoading.value = false
}

function onAfterLeave() {
  if (!props.open) clearPreview()
}

function getFitScale(): number {
  if (!viewportRef.value || !naturalWidth.value || !naturalHeight.value) return 1
  const vw = viewportRef.value.clientWidth
  const vh = viewportRef.value.clientHeight
  if (!vw || !vh) return 1
  return Math.min(vw / naturalWidth.value, vh / naturalHeight.value)
}

function resetToFit() {
  scale.value = getFitScale()
  translateX.value = 0
  translateY.value = 0
}

function resetToActualSize() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

const isFit = computed(() => {
  const fit = getFitScale()
  return (
    Math.abs(scale.value - fit) < 0.02 &&
    Math.abs(translateX.value) < 2 &&
    Math.abs(translateY.value) < 2
  )
})

useResizeObserver(viewportRef, () => {
  if (props.open && isFit.value) {
    resetToFit()
  }
})

watch(
  [() => props.open, () => props.image?.id],
  async ([isOpen], _previous, onCleanup) => {
    onMouseUp()
    if (!isOpen) return

    const image = props.image
    if (!image) {
      clearPreview()
      return
    }

    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    const isCurrentLoad = () => !cancelled && props.open && props.image?.id === image.id

    cleanupUrl()
    displayedImage.value = { ...image }
    isLoading.value = true

    try {
      const blob = await (props.loadImage ?? chat.loadImage)(image.id)
      if (blob && isCurrentLoad()) {
        currentBlob.value = blob
        url.value = URL.createObjectURL(blob)
        await nextTick()
        if (isCurrentLoad()) resetToFit()
      }
    } finally {
      if (isCurrentLoad()) isLoading.value = false
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  onMouseUp()
  clearPreview()
})

const containerStyle = computed(() => {
  if (!naturalWidth.value || !naturalHeight.value) {
    return {
      width: '92vw',
      maxWidth: '92vw',
      height: '85vh',
      maxHeight: '85vh',
    }
  }

  const ratio = naturalWidth.value / naturalHeight.value

  return {
    aspectRatio: `${naturalWidth.value} / ${naturalHeight.value}`,
    width: `min(92vw, calc(85vh * ${ratio}))`,
    maxWidth: '92vw',
    maxHeight: '85vh',
  }
})

function zoomAt(targetScale: number, clientX?: number, clientY?: number) {
  const fit = getFitScale()
  const minScale = Math.min(0.2, fit * 0.5)
  const maxScale = Math.max(5, fit * 10)
  const nextScale = Math.min(maxScale, Math.max(minScale, Number(targetScale.toFixed(3))))
  if (nextScale === scale.value) return

  if (viewportRef.value) {
    const rect = viewportRef.value.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const targetX = clientX ?? cx
    const targetY = clientY ?? cy
    const k = nextScale / scale.value

    translateX.value = targetX - cx - k * (targetX - cx - translateX.value)
    translateY.value = targetY - cy - k * (targetY - cy - translateY.value)
  }

  scale.value = nextScale
}

function onWheel(e: WheelEvent) {
  const factor = e.deltaY < 0 ? 1.2 : 0.83
  zoomAt(scale.value * factor, e.clientX, e.clientY)
}

function zoomIn() {
  zoomAt(scale.value * 1.25)
}

function zoomOut() {
  zoomAt(scale.value * 0.8)
}

function handleDoubleClick(e: MouseEvent) {
  const fit = getFitScale()
  if (Math.abs(scale.value - fit) < 0.03) {
    zoomAt(1, e.clientX, e.clientY)
  } else {
    resetToFit()
  }
}

function toggleFitOrActual() {
  if (isFit.value) {
    resetToActualSize()
  } else {
    resetToFit()
  }
}

function onMouseDown(e: MouseEvent) {
  if (!props.open || e.button !== 0 || !url.value) return
  isDragging.value = true
  startMouseX = e.clientX
  startMouseY = e.clientY
  initialTranslateX = translateX.value
  initialTranslateY = translateY.value

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = initialTranslateX + (e.clientX - startMouseX)
  translateY.value = initialTranslateY + (e.clientY - startMouseY)
}

function onMouseUp() {
  if (!isDragging.value) return
  isDragging.value = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function saveImage() {
  if (!currentBlob.value || !displayedImage.value) return
  downloadBlob(
    currentBlob.value,
    `momo-ai-preview-${displayedImage.value.id.replace(/[:.]/g, '-')}.png`
  )
}

const displayRatioText = computed(() => {
  const fit = getFitScale()
  if (Math.abs(scale.value - fit) < 0.02) {
    return t('ai.fit')
  }
  return `${Math.round(scale.value * 100)}%`
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl sm:max-w-none"
      :style="containerStyle"
      @after-leave="onAfterLeave"
    >
      <DialogTitle class="sr-only">{{ t('ai.previewTitle') }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t('ai.previewTitle') }}</DialogDescription>

      <div
        ref="viewportRef"
        class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/15 select-none"
        :class="{
          'cursor-grab': !isFit && !isDragging,
          'cursor-grabbing': isDragging,
          'cursor-default': isFit,
        }"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @dblclick="handleDoubleClick"
      >
        <p v-if="isLoading" class="text-xs text-muted-foreground">{{ t('ai.imageLoading') }}</p>
        <img
          v-else-if="url && naturalWidth && naturalHeight"
          :src="url"
          :alt="displayedImage?.id"
          draggable="false"
          class="pointer-events-auto origin-center transition-transform duration-75 ease-out select-none"
          :style="{
            width: `${naturalWidth}px`,
            height: `${naturalHeight}px`,
            maxWidth: 'none',
            maxHeight: 'none',
            transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          }"
        />

        <!-- 悬浮操作小工具栏 -->
        <div
          v-if="url"
          class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/80 bg-background/90 px-3 py-1.5 shadow-lg backdrop-blur"
          @mousedown.stop
          @dblclick.stop
        >
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('ai.zoomOut')"
            :aria-label="t('ai.zoomOut')"
            @click="zoomOut"
          >
            <ZoomOut class="size-4" />
          </Button>

          <button
            type="button"
            class="min-w-12 px-1 text-center font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            :title="isFit ? t('ai.actualSize') : t('ai.resetZoom')"
            @click="toggleFitOrActual"
          >
            {{ displayRatioText }}
          </button>

          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('ai.zoomIn')"
            :aria-label="t('ai.zoomIn')"
            @click="zoomIn"
          >
            <ZoomIn class="size-4" />
          </Button>

          <div class="mx-1 h-3.5 w-px bg-border" />

          <!-- 适应窗口 Fit -->
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('ai.resetZoom')"
            :aria-label="t('ai.resetZoom')"
            :class="{ 'text-primary': isFit }"
            @click="resetToFit"
          >
            <Maximize2 class="size-4" />
          </Button>

          <!-- 原始比例 1:1 (真正的 100%) -->
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-[11px] font-bold"
            :title="t('ai.actualSize')"
            :aria-label="t('ai.actualSize')"
            :class="{ 'text-primary': Math.abs(scale - 1) < 0.02 && !isFit }"
            @click="resetToActualSize"
          >
            1:1
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('ai.downloadImage')"
            :aria-label="t('ai.downloadImage')"
            @click="saveImage"
          >
            <Download class="size-4" />
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { aiChatKey } from '@/composables/ai/useAiChat'
import { useI18n } from '@/composables/useI18n'
import type { ImageReference } from '@/lib/ai/types'

const props = defineProps<{ image: ImageReference; label: string; eager?: boolean }>()
const emit = defineEmits<{ open: [id: string] }>()
const chat = inject(aiChatKey)!
const { t } = useI18n()
const element = ref<HTMLElement | null>(null),
  url = ref(''),
  unavailable = ref(false)
let observer: IntersectionObserver | undefined,
  generation = 0,
  activated = false
function release() {
  generation++
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}
async function show() {
  release()
  unavailable.value = false
  if (!activated) return
  const mine = generation
  try {
    const blob = await chat.loadImage(props.image.id)
    if (mine !== generation) return
    if (blob) url.value = URL.createObjectURL(blob)
    else unavailable.value = true
  } catch {
    if (mine === generation) unavailable.value = true
  }
}
watch(() => props.image.id, show)
onMounted(() => {
  if (props.eager || !('IntersectionObserver' in window)) {
    activated = true
    void show()
    return
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting || activated) return
      activated = true
      observer?.disconnect()
      void show()
    },
    { rootMargin: '200px' }
  )
  if (element.value) observer.observe(element.value)
})
onUnmounted(() => {
  observer?.disconnect()
  release()
})
</script>

<template>
  <button
    ref="element"
    type="button"
    class="relative block max-h-[75vh] w-full overflow-hidden rounded border border-border"
    :style="{ aspectRatio: `${image.width} / ${image.height}` }"
    :aria-label="label"
    @click="emit('open', image.id)"
  >
    <img
      v-if="url"
      :src="url"
      :alt="label"
      :width="image.width"
      :height="image.height"
      class="absolute inset-0 size-full object-contain"
    />
    <span
      v-else
      class="absolute inset-0 flex items-center justify-center bg-muted p-4 text-xs text-muted-foreground"
      >{{ t(unavailable ? 'ai.imageUnavailable' : 'ai.imageLoading') }}</span
    >
  </button>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, nextTick, toValue, watch } from 'vue'
import type { MaybeElement } from '@vueuse/core'
import { unrefElement, useElementBounding } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    visible: boolean
    anchor: MaybeElement
    side?: 'top' | 'bottom'
    sideOffset?: number
    class?: HTMLAttributes['class']
  }>(),
  {
    side: 'bottom',
    sideOffset: 4,
  }
)

const target = computed(() => unrefElement(toValue(props.anchor)))
const bounding = useElementBounding(target, { windowScroll: true, windowResize: true })

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    void nextTick(() => {
      bounding.update()
    })
  }
)

const hasAnchor = computed(() => Boolean(target.value))

const positionStyle = computed(() => {
  const { top, left, width, height } = bounding

  if (props.side === 'top') {
    return {
      top: `${top.value - props.sideOffset}px`,
      left: `${left.value + width.value / 2}px`,
      transform: 'translate(-50%, -100%)',
    }
  }

  return {
    top: `${top.value + height.value + props.sideOffset}px`,
    left: `${left.value + width.value / 2}px`,
    transform: 'translateX(-50%)',
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="anchored-hint">
      <div
        v-if="visible && hasAnchor"
        :style="positionStyle"
        :class="cn('pointer-events-none fixed z-50 w-fit whitespace-nowrap', props.class)"
      >
        <div class="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.anchored-hint-enter-active,
.anchored-hint-leave-active {
  transition: opacity 150ms ease-out;
}

.anchored-hint-enter-active > div,
.anchored-hint-leave-active > div {
  transition:
    opacity 150ms ease-out,
    transform 150ms ease-out;
  transform-origin: top center;
}

.anchored-hint-enter-from,
.anchored-hint-leave-to {
  opacity: 0;
}

.anchored-hint-enter-from > div,
.anchored-hint-leave-to > div {
  opacity: 0;
  transform: translateY(-4px) scale(0.95);
}

.anchored-hint-enter-to > div,
.anchored-hint-leave-from > div {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>

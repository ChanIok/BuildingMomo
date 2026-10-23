<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { AnchoredHint } from '@/components/ui/anchored-hint'
import type { CollectionRow } from '@/composables/editor/useCollectionPanel'

const props = defineProps<{
  container: HTMLElement | null
  active: boolean
  rows: CollectionRow[]
}>()
// 通过事件委托为所有虚拟行共用一个提示，包含禁用按钮的外层元素。
const target = shallowRef<HTMLElement | null>(null)
const visible = ref(false)
const text = computed(
  () =>
    target.value?.getAttribute('data-group-hint') ||
    target.value?.querySelector('button')?.getAttribute('aria-label') ||
    ''
)
let timer: ReturnType<typeof setTimeout> | undefined
let blocked: HTMLElement | null = null

function hintAt(node: EventTarget | null) {
  const hint = (node as Element | null)?.closest?.<HTMLElement>('[data-group-hint]') ?? null
  return hint && props.container?.contains(hint) ? hint : null
}
function reset() {
  clearTimeout(timer)
  timer = undefined
  visible.value = false
  target.value = null
}
function enter(event: PointerEvent | FocusEvent) {
  if (!props.active || ('pointerType' in event && (event.pointerType === 'touch' || event.buttons)))
    return
  const hint = hintAt(event.target)
  if (!hint || hint === blocked || hint === hintAt(event.relatedTarget)) return
  // 点击原生按钮后，不应因 focusin 事件重新打开提示。
  if (event.type === 'focusin' && !(event.target as HTMLElement).matches(':focus-visible')) return
  reset()
  blocked = null
  target.value = hint
  if (event.type === 'focusin') visible.value = true
  else
    timer = setTimeout(() => {
      visible.value = true
    }, 500)
}
function leave(event: PointerEvent | FocusEvent) {
  const hint = hintAt(event.target)
  if (!hint || hint === hintAt(event.relatedTarget)) return
  if (blocked === hint) blocked = null
  if (target.value === hint) reset()
}
function dismiss(event: Event) {
  // 点击后暂不显示该控件的提示，直到指针移出后再次进入。
  blocked = hintAt(event.target)
  reset()
}
const container = computed(() => props.container)
useEventListener(container, 'pointerover', enter)
useEventListener(container, 'pointerout', leave)
useEventListener(container, 'focusin', enter)
useEventListener(container, 'focusout', leave)
useEventListener(container, 'pointerdown', dismiss, { capture: true })
useEventListener(container, 'click', dismiss, { capture: true })
useEventListener(container, 'keydown', reset, { capture: true })
useEventListener(container, 'scroll', reset, { capture: true })
useEventListener(container, 'dragstart', reset, { capture: true })
watch(() => [props.active, props.rows, props.container], reset)
onBeforeUnmount(reset)
</script>

<template>
  <!-- 关闭时直接卸载，避免离场动画遮挡下一个控件。 -->
  <AnchoredHint
    v-if="visible && target && text"
    :visible="true"
    :anchor="target"
    class="whitespace-pre-line"
    aria-hidden="true"
    >{{ text }}</AnchoredHint
  >
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** 云同步历史行文案：仅当单行 ellipsis 截断时启用 Tooltip（scrollWidth > clientWidth） */
const props = defineProps<{
  text: string
}>()

const labelRef = ref<HTMLElement | null>(null)
const isTruncated = ref(false)

function measure() {
  const el = labelRef.value
  if (!el) {
    isTruncated.value = false
    return
  }
  isTruncated.value = el.scrollWidth > el.clientWidth + 1
}

onMounted(() => nextTick(measure))

watch(
  () => props.text,
  () => nextTick(measure)
)
</script>

<template>
  <div class="min-w-0 flex-1 overflow-hidden">
    <Tooltip :disabled="!isTruncated">
      <TooltipTrigger as-child>
        <span
          ref="labelRef"
          class="block w-full cursor-default truncate text-xs"
          @mouseenter="measure"
        >
          {{ text }}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" class="max-w-sm text-balance break-words" :side-offset="4">
        {{ text }}
      </TooltipContent>
    </Tooltip>
  </div>
</template>

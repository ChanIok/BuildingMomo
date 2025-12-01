<script setup lang="ts">
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

defineOptions({
  inheritAttrs: false,
})

defineProps<{
  modelValue: boolean
  tooltip: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
</script>

<template>
  <TooltipProvider>
    <Tooltip :delay-duration="300">
      <TooltipTrigger as-child>
        <div class="inline-flex">
          <Toggle
            size="sm"
            :model-value="modelValue"
            @update:model-value="(v) => $emit('update:modelValue', v)"
            :aria-label="tooltip"
            v-bind="$attrs"
          >
            <slot />
          </Toggle>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" class="text-xs" :side-offset="-8">
        {{ tooltip }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

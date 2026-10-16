<script setup lang="ts">
import type { RadioGroupItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { RadioGroupItem, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<RadioGroupItemProps & { class?: HTMLAttributes['class'] }>()
const forwarded = useForwardProps(reactiveOmit(props, 'class'))
</script>

<template>
  <RadioGroupItem
    v-bind="forwarded"
    :class="
      cn(
        'inline-flex h-6 min-w-7 items-center justify-center rounded-sm px-1.5 text-[11px] whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm',
        props.class
      )
    "
  >
    <slot />
  </RadioGroupItem>
</template>

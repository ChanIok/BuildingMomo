<script setup lang="ts">
import type { MenubarContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MenubarContent, MenubarPortal, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<MenubarContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    align: 'start',
    alignOffset: -4,
    sideOffset: 8,
  }
)

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MenubarPortal>
    <MenubarContent
      data-slot="menubar-content"
      v-bind="forwardedProps"
      :class="
        cn(
          'z-50 max-h-(--reka-menubar-content-available-height) min-w-[12rem] origin-(--reka-menubar-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          props.class
        )
      "
    >
      <slot />
    </MenubarContent>
  </MenubarPortal>
</template>

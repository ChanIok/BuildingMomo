<script setup lang="ts">
import { useI18n } from '@/composables/useI18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'toggleFullscreen'): void
  (e: 'dismiss'): void
}>()

const { t } = useI18n()

function handleDismiss() {
  emit('dismiss')
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-96">
      <DialogHeader>
        <DialogTitle class="sr-only">{{ t('welcome.rotateMask.title') }}</DialogTitle>
        <DialogDescription class="text-sm leading-6 text-muted-foreground">
          {{ t('welcome.rotateMask.message') }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="flex-row gap-2 sm:justify-center">
        <Button type="button" class="flex-1" @click="emit('toggleFullscreen')">
          {{ t('command.view.toggleFullscreen') }}
        </Button>
        <Button type="button" variant="secondary" class="flex-1" @click="handleDismiss">
          {{ t('welcome.rotateMask.dismiss') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

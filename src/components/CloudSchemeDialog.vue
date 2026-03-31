<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCloudSchemeSync } from '@/composables/useCloudSchemeSync'
import { useEditorStore } from '@/stores/editorStore'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const editorStore = useEditorStore()
const { createRoom, joinRoom, getStoredDisplayName } = useCloudSchemeSync()

const mode = ref<'create' | 'join'>('join')
const createRoomCode = ref('')
const createDisplayName = ref('')
const joinRoomCode = ref('')
const joinDisplayName = ref('')
const isSubmitting = ref(false)

const canCreate = computed(
  () => !!editorStore.activeScheme && !!createDisplayName.value.trim() && !isSubmitting.value
)
const canJoin = computed(
  () => !!joinRoomCode.value.trim() && !!joinDisplayName.value.trim() && !isSubmitting.value
)

function resetForm() {
  mode.value = 'join'
  createRoomCode.value = ''
  joinRoomCode.value = ''
  const storedName = getStoredDisplayName()
  createDisplayName.value = storedName
  joinDisplayName.value = storedName
  isSubmitting.value = false
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm()
    }
  }
)

function closeDialog() {
  emit('update:open', false)
}

async function handleConfirm() {
  if (isSubmitting.value) return

  isSubmitting.value = true
  try {
    if (mode.value === 'create') {
      const result = await createRoom({
        roomCode: createRoomCode.value,
        displayName: createDisplayName.value,
      })
      if (result) {
        closeDialog()
      }
      return
    }

    const result = await joinRoom({
      roomCode: joinRoomCode.value,
      displayName: joinDisplayName.value,
    })
    if (result) {
      closeDialog()
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ t('cloudScheme.dialogTitle') }}</DialogTitle>
        <DialogDescription>
          {{ t('cloudScheme.description') }}
        </DialogDescription>
      </DialogHeader>

      <Tabs v-model="mode" class="w-full">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="create">{{ t('cloudScheme.create') }}</TabsTrigger>
          <TabsTrigger value="join">{{ t('cloudScheme.join') }}</TabsTrigger>
        </TabsList>

        <TabsContent value="create" class="space-y-4 pt-4">
          <div class="space-y-2">
            <div class="text-sm font-medium">{{ t('cloudScheme.roomCodeOptional') }}</div>
            <Input
              v-model="createRoomCode"
              :placeholder="t('cloudScheme.roomCodeOptionalPlaceholder')"
              :disabled="isSubmitting"
            />
          </div>

          <div class="space-y-2">
            <div class="text-sm font-medium">{{ t('cloudScheme.displayNameRequired') }}</div>
            <Input
              v-model="createDisplayName"
              :placeholder="t('cloudScheme.displayNamePlaceholder')"
              :disabled="isSubmitting"
              @keydown.enter="handleConfirm"
            />
          </div>

          <div v-if="!editorStore.activeScheme" class="text-xs text-destructive">
            {{ t('cloudScheme.error.noActiveScheme') }}
          </div>
        </TabsContent>

        <TabsContent value="join" class="space-y-4 pt-4">
          <div class="space-y-2">
            <div class="text-sm font-medium">{{ t('cloudScheme.roomCode') }}</div>
            <Input
              v-model="joinRoomCode"
              :placeholder="t('cloudScheme.roomCodePlaceholder')"
              :disabled="isSubmitting"
            />
          </div>

          <div class="space-y-2">
            <div class="text-sm font-medium">{{ t('cloudScheme.displayNameRequired') }}</div>
            <Input
              v-model="joinDisplayName"
              :placeholder="t('cloudScheme.displayNamePlaceholder')"
              :disabled="isSubmitting"
              @keydown.enter="handleConfirm"
            />
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button variant="outline" :disabled="isSubmitting" @click="closeDialog">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="mode === 'create' ? !canCreate : !canJoin" @click="handleConfirm">
          {{ t(`cloudScheme.${mode}`) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

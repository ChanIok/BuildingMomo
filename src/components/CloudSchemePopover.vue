<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useCloudSchemeSync } from '@/composables/useCloudSchemeSync'
import { useI18n } from '@/composables/useI18n'

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const { currentCloudScheme, shareCode, copyShareCode, disconnect } = useCloudSchemeSync()

const currentStatusLabel = computed(() => {
  if (!currentCloudScheme.value) {
    return t('cloudScheme.status.disconnected')
  }

  return t(`cloudScheme.status.${currentCloudScheme.value.status}`)
})

const statusButtonClass = computed(() => {
  const status = currentCloudScheme.value?.status
  if (!status) return ''

  if (status === 'connected') {
    return 'bg-green-500/15 text-green-600 hover:bg-destructive hover:text-destructive-foreground dark:bg-green-500/20 dark:text-green-400'
  }

  if (status === 'error' || status === 'disconnected') {
    return 'bg-destructive/15 text-destructive hover:bg-destructive hover:text-destructive-foreground'
  }

  // connecting / syncing / conflict / idle
  return 'bg-muted text-foreground hover:bg-destructive hover:text-destructive-foreground'
})

async function handleDisconnect() {
  disconnect()
  emit('update:open', false)
}
</script>

<template>
  <div v-if="currentCloudScheme" class="flex flex-col overflow-hidden py-2">
    <div class="px-4 pb-2">
      <div class="text-sm font-medium">{{ t('cloudScheme.title') }}</div>
      <div class="mt-0.5 text-xs text-muted-foreground">{{ t('cloudScheme.statusHint') }}</div>
    </div>

    <div class="flex items-center justify-between gap-2 px-4 pb-2">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-8 max-w-64 min-w-0 flex-1 justify-start overflow-hidden font-mono text-sm tracking-[0.1em]"
            @click="copyShareCode"
          >
            <span class="min-w-0 flex-1 truncate text-left">{{ shareCode }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent :side-offset="4">
          {{ t('cloudScheme.copyCode') }}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="secondary"
            size="sm"
            class="h-8 px-2 text-xs font-medium"
            :class="statusButtonClass"
            @click="handleDisconnect"
          >
            {{ currentStatusLabel }}
          </Button>
        </TooltipTrigger>
        <TooltipContent :side-offset="4">
          {{ t('cloudScheme.disconnect') }}
        </TooltipContent>
      </Tooltip>
    </div>

    <div class="px-4 pt-2 text-xs text-muted-foreground">
      {{ t('cloudScheme.onlineUsers', { n: currentCloudScheme.users.length }) }}
    </div>

    <!-- 在线用户列表 -->
    <ScrollArea class="max-h-56">
      <div class="px-2 pb-1">
        <div
          v-if="currentCloudScheme.users.length === 0"
          class="px-2 py-4 text-center text-xs text-muted-foreground"
        >
          {{ t('cloudScheme.noOnlineUsers') }}
        </div>
        <div
          v-for="user in currentCloudScheme.users"
          :key="user.clientId"
          class="flex items-center rounded-sm bg-transparent px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
        >
          {{ user.displayName }}
        </div>
      </div>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  </div>
</template>

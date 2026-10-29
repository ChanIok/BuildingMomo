<script setup lang="ts">
import { inject, onBeforeUnmount, ref } from 'vue'
import { Check, Copy, Square } from 'lucide-vue-next'
import { externalAiKey } from '@/composables/ai/useExternalAi'
import { useI18n } from '@/composables/useI18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const service = inject(externalAiKey)
const { t } = useI18n()

const copied = ref('')
const copyFailed = ref(false)
const configFormat = ref<'chatgpt' | 'deepseek' | 'json'>('chatgpt')
let timer: ReturnType<typeof setTimeout> | undefined

onBeforeUnmount(() => clearTimeout(timer))

async function copy(value: string, key: string) {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = key
    copyFailed.value = false
    clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = ''
    }, 2000)
  } catch {
    copyFailed.value = true
  }
}
</script>

<template>
  <Dialog v-if="service" :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] max-w-md overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ t('ai.external.settingsTitle') }}</DialogTitle>
        <DialogDescription class="text-xs leading-relaxed text-muted-foreground">
          {{ t('ai.external.intro') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-1">
        <div class="flex items-center justify-between gap-3">
          <Label for="dialog-external-ai-enabled" class="text-sm font-medium">
            {{ t('ai.external.enable') }}
          </Label>
          <Switch
            id="dialog-external-ai-enabled"
            :model-value="service.enabled.value"
            :disabled="!service.supported.value || service.configuring.value"
            @update:model-value="service.configure"
          />
        </div>

        <p v-if="!service.supported.value" class="text-xs text-muted-foreground">
          {{ t('ai.external.upgrade') }}
        </p>

        <template v-else>
          <!-- 仅在实际执行任务时展示停止操作 -->
          <div
            v-if="service.running.value"
            class="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-xs text-primary"
          >
            <span>{{ t('ai.toolExecuting') }}</span>
            <Button variant="outline" size="sm" class="h-6 px-2 text-[11px]" @click="service.stop">
              <Square class="mr-1 size-3" />
              {{ t('ai.external.stop') }}
            </Button>
          </div>

          <div class="flex items-center justify-between gap-3">
            <Label for="dialog-external-ai-port" class="shrink-0 text-sm">
              {{ t('ai.external.port') }}
            </Label>
            <Input
              id="dialog-external-ai-port"
              :model-value="service.port.value"
              type="number"
              :min="1024"
              :max="65535"
              :disabled="service.enabled.value || service.configuring.value"
              class="h-8 w-28 font-mono text-xs"
              @update:model-value="service.port.value = Number($event)"
            />
          </div>

          <div class="space-y-3 pt-1">
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('ai.external.copyUrl') }}</Label>
              <div class="flex items-center gap-2 rounded-md bg-muted/50 py-1 pr-1 pl-2.5">
                <code class="min-w-0 flex-1 font-mono text-xs break-all">{{
                  service.url.value
                }}</code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :title="t('ai.external.copyUrl')"
                  :aria-label="t('ai.external.copyUrl')"
                  @click="copy(service.url.value, 'url')"
                >
                  <Check v-if="copied === 'url'" class="size-3.5 text-primary" />
                  <Copy v-else class="size-3.5" />
                </Button>
              </div>
            </div>

            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">
                {{ t('ai.external.client') }}
              </Label>
              <Select v-model="configFormat">
                <SelectTrigger class="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chatgpt" class="text-xs"> ChatGPT Desktop / Codex </SelectItem>
                  <SelectItem value="deepseek" class="text-xs"> DeepSeek Harness </SelectItem>
                  <SelectItem value="json" class="text-xs">
                    {{ t('ai.external.otherClient') }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              class="w-full text-xs"
              @click="copy(service.connectionConfigs.value[configFormat], 'config')"
            >
              <Check v-if="copied === 'config'" class="mr-1.5 size-3.5 text-primary" />
              <Copy v-else class="mr-1.5 size-3.5" />
              {{ t(copied === 'config' ? 'ai.codeCopied' : 'ai.external.copyConfig') }}
            </Button>

            <p class="text-xs leading-relaxed text-muted-foreground">
              {{ t(`ai.external.configHints.${configFormat}`) }}
            </p>
          </div>

          <p v-if="service.nativeError.value" role="alert" class="text-xs text-destructive">
            {{ t(`ai.external.errors.${service.nativeError.value}`) }}
          </p>
          <p v-if="copyFailed" role="alert" class="text-xs text-destructive">
            {{ t('ai.codeCopyFailed') }}
          </p>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>

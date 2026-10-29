<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { AcceptableValue } from 'reka-ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/composables/useI18n'
import { AiError } from '@/lib/ai/types'
import {
  AI_PROVIDERS,
  REASONING_LEVELS,
  endpointIdentity,
  getModelSettings,
  isAiProvider,
  parseObject,
  resolveConnection,
  setModelSettings,
  validateConnection,
  type AiProvider,
  type AiReasoning,
  type AiProviderOptions,
  type ModelSettings,
} from '@/lib/ai/connection'
import { hasReasoningOverride, clearReasoningOverride } from '@/lib/ai/reasoning'
import { useAiModels } from '@/composables/ai/useAiModels'
import AiModelInput from './AiModelInput.vue'
import { ChevronRight, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { createAiPolicy } from '@/lib/ai/context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

const props = defineProps<{ open: boolean; running: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const settings = useSettingsStore(),
  { t } = useI18n()
const apiUrl = ref(''),
  apiKey = ref(''),
  model = ref(''),
  contextWindow = ref(''),
  maxTokens = ref(''),
  imageBudgetMiB = ref(''),
  error = ref('')
const provider = ref<AiProvider>('compatible')
const headers = ref('{}'),
  providerOptions = ref('{}'),
  requestBody = ref('{}')
const replayReasoning = ref(false),
  streamUsage = ref(true),
  outputParameter = ref<'max_tokens' | 'max_completion_tokens'>('max_tokens')
const reasoning = ref<AiReasoning>('provider-default')
const modelPicker = ref<InstanceType<typeof AiModelInput>>()
const customAddress = ref(false)
const advancedOpen = ref(false)
const providerAvailable = computed(() => isAiProvider(provider.value))
const compatible = computed(() => provider.value === 'compatible')
const target = () => ({
  provider: provider.value,
  apiUrl: apiUrl.value.trim(),
  model: model.value.trim(),
})
const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
function loadOptions() {
  const config = getModelSettings(settings.ai, target())
  reasoning.value = config.reasoning ?? 'provider-default'
  providerOptions.value = pretty(config.providerOptions)
  requestBody.value = pretty(config.requestBody)
  replayReasoning.value = config.replayReasoning === true
  streamUsage.value = config.streamUsage !== false
  outputParameter.value = config.outputParameter ?? 'max_tokens'
}
watch([provider, apiUrl, model], loadOptions, { flush: 'sync' })
function changeProvider() {
  apiUrl.value = AI_PROVIDERS[provider.value]?.baseURL || ''
  // Never carry one vendor's credentials or model ID into another connection type.
  apiKey.value = ''
  headers.value = '{}'
  model.value = ''
  customAddress.value = false
  error.value = ''
}
function handleProviderChange(value: AcceptableValue) {
  if (!isAiProvider(value)) return
  provider.value = value
  changeProvider()
}
function useDefaultAddress() {
  customAddress.value = false
  apiUrl.value = AI_PROVIDERS[provider.value]?.baseURL || ''
}
const requestUrl = computed(() => {
  try {
    return compatible.value ? endpointIdentity(target()) : ''
  } catch {
    return ''
  }
})
const policy = computed(() => {
  try {
    return createAiPolicy({
      contextWindow: Number(contextWindow.value),
      maxTokens: Number(maxTokens.value),
      imageBudgetMiB: Number(imageBudgetMiB.value),
    })
  } catch {
    return null
  }
})
const format = (value: number) => value.toLocaleString()
watch(
  () => props.open,
  (open) => {
    if (!open) {
      apiKey.value = ''
      headers.value = '{}'
      return
    }
    const connection = resolveConnection(settings.ai)
    provider.value = connection.provider
    customAddress.value = connection.apiUrl !== AI_PROVIDERS[provider.value]?.baseURL
    headers.value = pretty(connection.headers)
    apiUrl.value = connection.apiUrl
    apiKey.value = settings.ai.apiKey
    model.value = connection.model
    contextWindow.value = String(settings.ai.contextWindow)
    maxTokens.value = String(settings.ai.maxTokens)
    imageBudgetMiB.value = String(settings.ai.imageBudgetMiB)
    loadOptions()
    error.value = ''
  },
  { immediate: true }
)
const discoveryConnection = computed(() => {
  if (!providerAvailable.value) return undefined
  try {
    return {
      provider: provider.value,
      apiUrl: apiUrl.value.trim(),
      apiKey: apiKey.value.trim(),
      headers: parseObject(headers.value) as Record<string, string>,
    }
  } catch {
    return undefined
  }
})
const discovery = useAiModels(
  () => discoveryConnection.value,
  () => props.open && !props.running
)
const modelChoices = discovery.models,
  modelsState = discovery.state
const modelError = computed(() =>
  discovery.error.value
    ? discovery.error.value.code === 'settings'
      ? t('ai.modelsConnectionHint')
      : t(`ai.errors.${discovery.error.value.code}`, { status: discovery.error.value.message })
    : ''
)
const selectedModel = computed(() => modelChoices.value.find((entry) => entry.id === model.value))
async function fetchModels() {
  if (await discovery.refresh()) {
    await nextTick()
    if (props.open && modelsState.value === 'ready') modelPicker.value?.focus()
  }
}
function draftOptions(): ModelSettings {
  return {
    providerOptions: parseObject(providerOptions.value) as AiProviderOptions,
    ...(compatible.value ? { requestBody: parseObject(requestBody.value) } : {}),
  }
}
const reasoningOverridden = computed(() => {
  try {
    return hasReasoningOverride(provider.value, draftOptions())
  } catch {
    return false
  }
})
function restoreReasoning() {
  try {
    const config = clearReasoningOverride(provider.value, draftOptions())
    providerOptions.value = pretty(config.providerOptions)
    requestBody.value = pretty(config.requestBody)
    reasoning.value = 'provider-default'
  } catch {
    error.value = t('ai.errors.settings')
  }
}
function handleReasoningChange(value: AcceptableValue) {
  const level = REASONING_LEVELS.find((level) => level === value)
  if (level !== undefined) reasoning.value = level
}
function readJson(value: string, field: string) {
  try {
    return parseObject(value)
  } catch {
    throw new AiError('settings_json', t('ai.invalidJson', { field }))
  }
}
function save() {
  if (props.running || !providerAvailable.value) return
  try {
    if (!policy.value) throw new AiError('settings')
    const config: ModelSettings = {
      ...(!reasoningOverridden.value ? { reasoning: reasoning.value } : {}),
      providerOptions: readJson(providerOptions.value, 'providerOptions') as AiProviderOptions,
      ...(compatible.value
        ? {
            requestBody: readJson(requestBody.value, t('ai.requestBody')),
            replayReasoning: replayReasoning.value,
            streamUsage: streamUsage.value,
            outputParameter: outputParameter.value,
          }
        : {}),
    }
    const next = {
      ...target(),
      headers: readJson(headers.value, t('ai.customHeaders')) as Record<string, string>,
    }
    validateConnection({ ...next, ...config, apiKey: apiKey.value.trim() })
    settings.ai.apiKey = apiKey.value.trim()
    setModelSettings(settings.ai, next, config)
    settings.ai.connection = next
    settings.ai.contextWindow = policy.value.contextWindow
    settings.ai.maxTokens = policy.value.maxTokens
    settings.ai.imageBudgetMiB = Number(imageBudgetMiB.value)
    emit('update:open', false)
  } catch (cause) {
    error.value =
      cause instanceof AiError && cause.code === 'settings_json'
        ? cause.message
        : t('ai.errors.settings')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('ai.settings') }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('ai.connectionHint') }}</DialogDescription>
      </DialogHeader>
      <form class="space-y-4 pt-1" @submit.prevent="save">
        <div class="space-y-1.5">
          <Label for="ai-provider">{{ t('ai.provider') }}</Label>
          <Select
            :model-value="provider"
            :disabled="running"
            @update:model-value="handleProviderChange"
          >
            <SelectTrigger id="ai-provider" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="!providerAvailable" :value="provider" disabled>
                {{ t('ai.removedProvider', { provider }) }}
              </SelectItem>
              <SelectItem v-for="(entry, id) in AI_PROVIDERS" :key="id" :value="id">
                {{ id === 'compatible' ? t('ai.customCompatible') : entry.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="!providerAvailable" role="alert" class="text-xs text-destructive">
            {{ t('ai.removedProviderHint') }}
          </p>
        </div>

        <div
          v-if="!compatible && !customAddress"
          class="flex items-center justify-between text-xs text-muted-foreground"
        >
          <span class="max-w-[280px] truncate">Endpoint: {{ apiUrl }}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="running"
            @click="customAddress = true"
          >
            {{ t('ai.customAddress') }}
          </Button>
        </div>

        <div v-if="compatible || customAddress" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label for="ai-api-url">{{ t('ai.apiUrl') }}</Label>
            <Button
              v-if="!compatible"
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              :disabled="running"
              @click="useDefaultAddress"
            >
              {{ t('ai.defaultAddress') }}
            </Button>
          </div>
          <Input
            id="ai-api-url"
            v-model="apiUrl"
            type="url"
            autocomplete="off"
            :disabled="running"
            placeholder="https://…/v1"
          />
          <p v-if="requestUrl" class="text-xs break-all text-muted-foreground">
            {{ t('ai.requestUrl', { url: requestUrl }) }}
          </p>
        </div>

        <div class="space-y-1.5">
          <Label for="ai-api-key">API Key</Label>
          <Input
            id="ai-api-key"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            :disabled="running"
            placeholder="sk-..."
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <Label for="ai-model">{{ t('ai.model') }}</Label>
            <Button
              v-if="providerAvailable"
              type="button"
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs"
              :disabled="running || modelsState === 'loading'"
              @click="fetchModels"
            >
              <LoaderCircle v-if="modelsState === 'loading'" class="mr-1.5 size-3.5 animate-spin" />
              <RefreshCw v-else-if="modelsState === 'ready'" class="mr-1.5 size-3.5" />
              {{
                t(
                  modelsState === 'loading'
                    ? 'ai.modelsLoading'
                    : modelsState === 'ready'
                      ? 'ai.refreshModels'
                      : 'ai.fetchModels'
                )
              }}
            </Button>
          </div>
          <AiModelInput
            id="ai-model"
            ref="modelPicker"
            v-model="model"
            :models="modelChoices"
            :disabled="running"
            :placeholder="t('ai.modelPlaceholder')"
          />
          <p v-if="modelsState === 'ready'" role="status" class="text-xs text-muted-foreground">
            {{
              modelChoices.length
                ? t('ai.modelsLoaded', { count: modelChoices.length })
                : t('ai.modelsEmpty')
            }}
          </p>
          <p v-if="modelError" role="alert" class="text-xs text-destructive">{{ modelError }}</p>
          <div
            v-if="selectedModel"
            class="flex flex-wrap gap-x-2 gap-y-1 pt-0.5 text-xs text-muted-foreground"
          >
            <span v-if="selectedModel.contextWindow" class="rounded bg-muted px-1.5 py-0.5">
              {{ t('ai.modelContext', { count: format(selectedModel.contextWindow) }) }}
            </span>
            <span v-if="selectedModel.maxOutputTokens" class="rounded bg-muted px-1.5 py-0.5">
              {{ t('ai.modelOutput', { count: format(selectedModel.maxOutputTokens) }) }}
            </span>
            <span v-if="selectedModel.vision !== undefined" class="rounded bg-muted px-1.5 py-0.5">
              {{ t(selectedModel.vision ? 'ai.modelVision' : 'ai.modelTextOnly') }}
            </span>
            <span v-if="selectedModel.tools === true" class="rounded bg-muted px-1.5 py-0.5">
              {{ t('ai.modelTools') }}
            </span>
          </div>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label for="ai-reasoning">{{ t('ai.reasoningLabel') }}</Label>
            <Button
              v-if="reasoningOverridden"
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              :disabled="running"
              @click="restoreReasoning"
            >
              {{ t('ai.restoreReasoning') }}
            </Button>
          </div>
          <Select
            :model-value="reasoningOverridden ? 'custom' : reasoning"
            :disabled="running || reasoningOverridden"
            @update:model-value="handleReasoningChange"
          >
            <SelectTrigger id="ai-reasoning" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="reasoningOverridden" value="custom" disabled>
                {{ t('ai.reasoningCustom') }}
              </SelectItem>
              <SelectItem v-for="level in REASONING_LEVELS" :key="level" :value="level">
                {{ t(`ai.reasoningChoices.${level}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="reasoningOverridden" class="text-xs text-muted-foreground">
            {{ t('ai.reasoningOverrideHint') }}
          </p>
        </div>

        <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>

        <div class="rounded-lg border border-border/80 bg-muted/20">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            @click="advancedOpen = !advancedOpen"
          >
            <span>{{ t('ai.advancedSettings') }}</span>
            <ChevronRight
              class="size-4 transition-transform duration-200"
              :class="{ 'rotate-90': advancedOpen }"
            />
          </button>
          <div v-show="advancedOpen" class="space-y-4 border-t border-border/60 p-3.5 text-sm">
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <Label for="ai-context-window">{{ t('ai.contextWindow') }}</Label>
                <span v-if="policy" class="text-xs text-muted-foreground">
                  {{ t('ai.contextCompactAt', { tokens: format(policy.autoCompactTokenLimit) }) }}
                </span>
              </div>
              <Input
                id="ai-context-window"
                v-model="contextWindow"
                type="text"
                inputmode="numeric"
                pattern="[0-9]+"
                :disabled="running"
              />
              <p v-if="policy" class="text-xs text-muted-foreground">
                {{ t('ai.contextUsable', { tokens: format(policy.usableContextWindow) }) }}
              </p>
              <div class="flex flex-wrap gap-1">
                <Button
                  v-for="preset in [32000, 128000, 256000, 1000000]"
                  :key="preset"
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-6 px-2 text-xs"
                  :disabled="running"
                  @click="contextWindow = String(preset)"
                >
                  {{ format(preset) }}
                </Button>
              </div>
            </div>

            <div class="space-y-1.5">
              <Label for="ai-max-tokens">{{ t('ai.maxTokens') }}</Label>
              <Input
                id="ai-max-tokens"
                v-model="maxTokens"
                type="text"
                inputmode="numeric"
                pattern="[0-9]+"
                :disabled="running"
              />
              <p class="text-xs text-muted-foreground">{{ t('ai.maxTokensHint') }}</p>
            </div>

            <div class="space-y-1.5">
              <Label for="ai-provider-options">SDK providerOptions (JSON)</Label>
              <textarea
                id="ai-provider-options"
                v-model="providerOptions"
                :disabled="running"
                rows="3"
                spellcheck="false"
                class="w-full rounded-md border border-input bg-background p-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              />
            </div>

            <div class="space-y-1.5">
              <Label for="ai-headers">{{ t('ai.customHeaders') }} (JSON)</Label>
              <textarea
                id="ai-headers"
                v-model="headers"
                :disabled="running"
                rows="3"
                spellcheck="false"
                autocomplete="off"
                class="w-full rounded-md border border-input bg-background p-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              />
            </div>

            <template v-if="compatible">
              <div class="space-y-1.5">
                <Label for="ai-request-body">{{ t('ai.requestBody') }} (JSON)</Label>
                <textarea
                  id="ai-request-body"
                  v-model="requestBody"
                  :disabled="running"
                  rows="3"
                  spellcheck="false"
                  class="w-full rounded-md border border-input bg-background p-2 font-mono text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                />
              </div>

              <div class="flex flex-wrap gap-4 pt-1">
                <label class="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox v-model="replayReasoning" :disabled="running" />
                  <span>{{ t('ai.replayReasoning') }}</span>
                </label>
                <label class="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox v-model="streamUsage" :disabled="running" />
                  <span>{{ t('ai.streamUsage') }}</span>
                </label>
              </div>

              <div class="space-y-1.5">
                <Label>{{ t('ai.outputParameter') }}</Label>
                <Select v-model="outputParameter" :disabled="running">
                  <SelectTrigger class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="max_tokens">max_tokens</SelectItem>
                    <SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </template>

            <div class="space-y-1.5">
              <Label for="ai-image-budget">{{ t('ai.imageBudget') }}</Label>
              <Input
                id="ai-image-budget"
                v-model="imageBudgetMiB"
                type="text"
                inputmode="numeric"
                pattern="[0-9]+"
                :disabled="running"
              />
            </div>
          </div>
        </div>

        <DialogFooter class="mt-5">
          <Button
            type="button"
            variant="outline"
            :disabled="running"
            @click="emit('update:open', false)"
          >
            {{ t('ai.cancel') }}
          </Button>
          <Button type="submit" :disabled="running || !providerAvailable">
            {{ t('ai.save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

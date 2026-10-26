<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
import { MODEL_DIRECTORIES } from '@/lib/ai/models'
import { useAiModels } from '@/composables/ai/useAiModels'
import AiModelInput from './AiModelInput.vue'
import { LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { createAiPolicy } from '@/lib/ai/context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
  apiUrl.value = AI_PROVIDERS[provider.value].baseURL
  // Never carry one vendor's credentials or model ID into another connection type.
  apiKey.value = ''
  headers.value = '{}'
  model.value = ''
  customAddress.value = false
  error.value = ''
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
const directory = computed(() =>
  providerAvailable.value ? MODEL_DIRECTORIES[provider.value] : undefined
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
function changeReasoning(event: Event) {
  reasoning.value = (event.target as HTMLSelectElement).value as AiReasoning
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
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('ai.settings') }}</DialogTitle>
        <DialogDescription>{{ t('ai.connectionHint') }}</DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="save">
        <div class="space-y-2">
          <Label for="ai-provider">{{ t('ai.provider') }}</Label>
          <select
            id="ai-provider"
            v-model="provider"
            :disabled="running"
            class="w-full rounded border border-input bg-background p-2 text-sm"
            @change="changeProvider"
          >
            <option v-if="!providerAvailable" :value="provider" disabled>
              {{ t('ai.removedProvider', { provider }) }}
            </option>
            <option v-for="(entry, id) in AI_PROVIDERS" :key="id" :value="id">
              {{ id === 'compatible' ? t('ai.customCompatible') : entry.label }}
            </option>
          </select>
          <p v-if="!providerAvailable" role="alert" class="text-sm text-destructive">
            {{ t('ai.removedProviderHint') }}
          </p>
        </div>
        <div v-if="!compatible" class="space-y-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :disabled="running"
            :aria-expanded="customAddress"
            @click="customAddress = !customAddress"
            >{{ t('ai.customAddress') }}</Button
          >
          <p v-if="!customAddress" class="text-xs break-all text-muted-foreground">{{ apiUrl }}</p>
        </div>
        <div v-if="compatible || customAddress" class="space-y-2">
          <Label for="ai-api-url">{{ t('ai.apiUrl') }}</Label>
          <Input
            id="ai-api-url"
            v-model="apiUrl"
            type="url"
            autocomplete="off"
            :disabled="running"
            placeholder="https://…/v1"
          />
          <p class="text-xs text-muted-foreground">
            {{ t(compatible ? 'ai.apiUrlHint' : 'ai.nativeUrlHint') }}
          </p>
          <p v-if="requestUrl" class="text-xs break-all text-muted-foreground">
            {{ t('ai.requestUrl', { url: requestUrl }) }}
          </p>
        </div>
        <div class="space-y-2">
          <Label for="ai-api-key">API Key</Label>
          <Input
            id="ai-api-key"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            :disabled="running"
          />
          <p class="text-xs text-muted-foreground">{{ t('ai.keyHint') }}</p>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <Label for="ai-model">{{ t('ai.model') }}</Label>
            <Button
              v-if="providerAvailable"
              type="button"
              variant="outline"
              size="sm"
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
          <p v-if="modelError" role="alert" class="text-sm text-destructive">{{ modelError }}</p>
          <a
            v-if="directory"
            :href="directory.docs"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs underline"
            >{{ t('ai.modelDocs') }}</a
          >
          <p class="text-xs text-muted-foreground">{{ t('ai.modelHint') }}</p>
          <div
            v-if="selectedModel"
            class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
          >
            <span v-if="selectedModel.contextWindow">{{
              t('ai.modelContext', { count: format(selectedModel.contextWindow) })
            }}</span>
            <span v-if="selectedModel.maxOutputTokens">{{
              t('ai.modelOutput', { count: format(selectedModel.maxOutputTokens) })
            }}</span>
            <span v-if="selectedModel.vision !== undefined">{{
              t(selectedModel.vision ? 'ai.modelVision' : 'ai.modelTextOnly')
            }}</span>
            <span v-if="selectedModel.tools === true">{{ t('ai.modelTools') }}</span>
          </div>
        </div>
        <div class="space-y-2">
          <Label for="ai-reasoning">{{ t('ai.reasoningLabel') }}</Label>
          <select
            id="ai-reasoning"
            :value="reasoningOverridden ? 'custom' : reasoning"
            :disabled="running || reasoningOverridden"
            class="w-full rounded border border-input bg-background p-2 text-sm"
            @change="changeReasoning"
          >
            <option v-if="reasoningOverridden" value="custom">{{ t('ai.reasoningCustom') }}</option>
            <option v-for="level in REASONING_LEVELS" :key="level" :value="level">
              {{ t(`ai.reasoningChoices.${level}`) }}
            </option>
          </select>
          <div v-if="reasoningOverridden" class="space-y-1">
            <p class="text-sm text-muted-foreground">{{ t('ai.reasoningOverrideHint') }}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              :disabled="running"
              @click="restoreReasoning"
              >{{ t('ai.restoreReasoning') }}</Button
            >
          </div>
          <p v-else class="text-xs text-muted-foreground">{{ t('ai.reasoningHint') }}</p>
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <details class="space-y-3 rounded border border-border p-3 text-sm">
          <summary class="cursor-pointer">{{ t('ai.advancedSettings') }}</summary>
          <div class="space-y-2">
            <Label for="ai-context-window">{{ t('ai.contextWindow') }}</Label>
            <Input
              id="ai-context-window"
              v-model="contextWindow"
              type="number"
              inputmode="numeric"
              :min="5000"
              step="1000"
              :disabled="running"
            />
            <div class="flex flex-wrap gap-1">
              <Button
                v-for="preset in [32000, 128000, 256000, 1000000]"
                :key="preset"
                type="button"
                variant="outline"
                size="sm"
                :disabled="running"
                @click="contextWindow = String(preset)"
              >
                {{ format(preset) }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('ai.contextWindowHint') }}</p>
            <p v-if="policy" class="text-xs text-muted-foreground">
              {{ t('ai.contextBudget', { budget: format(policy.inputBudget) }) }}
            </p>
          </div>
          <div class="space-y-2">
            <Label for="ai-max-tokens">{{ t('ai.maxTokens') }}</Label>
            <Input
              id="ai-max-tokens"
              v-model="maxTokens"
              type="number"
              inputmode="numeric"
              :min="1"
              step="1"
              :disabled="running"
            />
            <p class="text-xs text-muted-foreground">{{ t('ai.maxTokensHint') }}</p>
          </div>
          <div class="mt-3 space-y-2">
            <Label for="ai-provider-options">SDK providerOptions · JSON</Label>
            <textarea
              id="ai-provider-options"
              v-model="providerOptions"
              :disabled="running"
              rows="4"
              spellcheck="false"
              class="w-full rounded border border-input bg-background p-2 font-mono text-sm"
            />
            <p class="text-xs text-muted-foreground">{{ t('ai.providerOptionsHint') }}</p>
            <a
              href="https://ai-sdk.dev/providers/ai-sdk-providers"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs underline"
              >{{ t('ai.providerDocs') }}</a
            >
          </div>
          <div class="space-y-2">
            <Label for="ai-headers">{{ t('ai.customHeaders') }} · JSON</Label>
            <textarea
              id="ai-headers"
              v-model="headers"
              :disabled="running"
              rows="3"
              spellcheck="false"
              autocomplete="off"
              class="w-full rounded border border-input bg-background p-2 font-mono text-sm"
            />
            <p class="text-xs text-muted-foreground">{{ t('ai.headersHint') }}</p>
          </div>
          <template v-if="compatible">
            <div class="space-y-2">
              <Label for="ai-request-body">{{ t('ai.requestBody') }} · JSON</Label>
              <textarea
                id="ai-request-body"
                v-model="requestBody"
                :disabled="running"
                rows="3"
                spellcheck="false"
                class="w-full rounded border border-input bg-background p-2 font-mono text-sm"
              />
              <p class="text-xs text-muted-foreground">{{ t('ai.requestBodyHint') }}</p>
            </div>
            <label class="flex items-start gap-2"
              ><Checkbox v-model="replayReasoning" :disabled="running" /><span>{{
                t('ai.replayReasoning')
              }}</span></label
            >
            <label class="flex items-start gap-2"
              ><Checkbox v-model="streamUsage" :disabled="running" /><span>{{
                t('ai.streamUsage')
              }}</span></label
            >
            <label class="block space-y-1"
              ><span>{{ t('ai.outputParameter') }}</span
              ><select
                v-model="outputParameter"
                :disabled="running"
                class="w-full rounded border border-input bg-background p-2"
              >
                <option value="max_tokens">max_tokens</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
              </select></label
            >
          </template>
          <div class="space-y-1">
            <Label for="ai-image-budget">{{ t('ai.imageBudget') }}</Label>
            <Input
              id="ai-image-budget"
              v-model="imageBudgetMiB"
              type="number"
              :min="1"
              step="1"
              :disabled="running"
            />
            <p class="text-xs text-muted-foreground">{{ t('ai.imageBudgetHint') }}</p>
          </div>
        </details>
        <div class="flex justify-end">
          <Button type="submit" :disabled="running || !providerAvailable">{{
            t('ai.save')
          }}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>

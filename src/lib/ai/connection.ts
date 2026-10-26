import type { ModelMessage, JSONValue, streamText } from 'ai'
import { AiError } from './types'

/** Connection types, not a model whitelist. All model IDs remain user supplied. */
export const AI_PROVIDERS = {
  compatible: { label: 'OpenAI-compatible', baseURL: 'https://api.openai.com/v1' },
  openai: { label: 'OpenAI · Responses', baseURL: 'https://api.openai.com/v1' },
  'openai-chat': { label: 'OpenAI · Chat Completions', baseURL: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', baseURL: 'https://api.anthropic.com/v1' },
  google: { label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
  deepseek: { label: 'DeepSeek', baseURL: 'https://api.deepseek.com' },
} as const
export type AiProvider = keyof typeof AI_PROVIDERS
export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && Object.hasOwn(AI_PROVIDERS, value)
}
export type AiProviderOptions = NonNullable<ModelMessage['providerOptions']>
export type AiReasoning = NonNullable<Parameters<typeof streamText>[0]['reasoning']>
export const REASONING_LEVELS = [
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly AiReasoning[]
export interface ModelSettings {
  reasoning?: AiReasoning
  providerOptions?: AiProviderOptions
  /** Extensions only for the generic Chat Completions adapter. */
  requestBody?: Record<string, JSONValue>
  replayReasoning?: boolean
  streamUsage?: boolean
  outputParameter?: 'max_tokens' | 'max_completion_tokens'
}
export interface AiConnection extends ModelSettings {
  provider: AiProvider
  apiUrl: string
  apiKey: string
  model: string
  headers?: Record<string, string>
}

export interface AiPreferences {
  contextWindow: number
  maxTokens: number
  imageBudgetMiB: number
}
export interface AiSettings extends AiPreferences {
  connection: Pick<AiConnection, 'provider' | 'apiUrl' | 'model' | 'headers'>
  apiKey: string
  modelSettings: Record<string, ModelSettings>
}
export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  contextWindow: 256_000,
  maxTokens: 128_000,
  imageBudgetMiB: 25,
}

export function getModelSettings(
  settings: AiSettings,
  target: AiSettings['connection']
): ModelSettings {
  try {
    return JSON.parse(JSON.stringify(settings.modelSettings[modelSettingsKey(target)] ?? {}))
  } catch {
    return {}
  }
}
export function setModelSettings(
  settings: AiSettings,
  target: AiSettings['connection'],
  config: ModelSettings
) {
  validateConnection({ ...target, ...config, apiKey: settings.apiKey })
  settings.modelSettings = {
    ...settings.modelSettings,
    [modelSettingsKey(target)]: JSON.parse(JSON.stringify(config)),
  }
}
export function resolveConnection(settings: AiSettings): AiConnection {
  return {
    ...settings.connection,
    ...getModelSettings(settings, settings.connection),
    apiUrl: settings.connection.apiUrl.trim(),
    model: settings.connection.model.trim(),
    apiKey: settings.apiKey.trim(),
  }
}

export function parseObject(text: string): Record<string, JSONValue> {
  const value: unknown = JSON.parse(text.trim() || '{}')
  if (!isObject(value)) throw new AiError('settings')
  return value as Record<string, JSONValue>
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function connectionUrl(apiUrl: string) {
  let url: URL
  try {
    url = new URL(apiUrl.trim())
  } catch {
    throw new AiError('settings')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new AiError('settings')
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url
}
export function resolveChatCompletionsUrl(apiUrl: string) {
  const url = connectionUrl(apiUrl)
  const path = url.pathname === '/' ? '/v1' : url.pathname
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url.toString()
}
/** Safe for logs: excludes query credentials. Provider/protocol is a separate identity field. */
export function endpointIdentity(connection: Pick<AiConnection, 'provider' | 'apiUrl'>) {
  const url =
    connection.provider === 'compatible'
      ? new URL(resolveChatCompletionsUrl(connection.apiUrl))
      : connectionUrl(connection.apiUrl)
  return `${url.origin}${url.pathname}`
}
export function modelSettingsKey(connection: Pick<AiConnection, 'provider' | 'apiUrl' | 'model'>) {
  return JSON.stringify([
    connection.provider,
    endpointIdentity(connection),
    connection.model.trim(),
  ])
}
export function shouldReplayReasoning(connection: AiConnection) {
  // Native adapters own reasoning/signature continuation semantics.
  return connection.provider !== 'compatible' || connection.replayReasoning === true
}
export function validateConnectionAccess(
  connection: Pick<AiConnection, 'provider' | 'apiUrl' | 'apiKey' | 'headers'>
) {
  if (!isAiProvider(connection.provider)) throw new AiError('settings')
  endpointIdentity(connection)
  // Keyless local servers and header-based authentication are valid compatible connections.
  if (connection.provider !== 'compatible' && !connection.apiKey.trim())
    throw new AiError('settings')
  if (
    connection.headers &&
    (!isObject(connection.headers) ||
      Object.entries(connection.headers).some(([key, value]) => {
        try {
          new Headers({ [key]: value })
          return typeof value !== 'string'
        } catch {
          return true
        }
      }))
  )
    throw new AiError('settings')
}
export function validateConnection(connection: AiConnection) {
  validateConnectionAccess(connection)
  if (
    !connection.model.trim() ||
    (connection.reasoning !== undefined && !REASONING_LEVELS.includes(connection.reasoning))
  )
    throw new AiError('settings')
  if (
    connection.providerOptions &&
    (!isObject(connection.providerOptions) ||
      Object.values(connection.providerOptions).some((value) => !isObject(value)))
  )
    throw new AiError('settings')
  if (connection.provider === 'compatible' && connection.requestBody) {
    const protectedFields = [
      'model',
      'messages',
      'tools',
      'tool_choice',
      'stream',
      'stream_options',
      'max_tokens',
      'max_completion_tokens',
      'n',
    ]
    if (
      !isObject(connection.requestBody) ||
      protectedFields.some((key) => Object.hasOwn(connection.requestBody!, key))
    )
      throw new AiError('settings')
  }
}

import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  connectionUrl,
  resolveChatCompletionsUrl,
  type AiConnection,
  type AiProvider,
} from './connection'

type ProviderSettings = {
  baseURL: string
  apiKey: string
  headers?: Record<string, string>
  fetch: typeof fetch
}
const nativeProviders = {
  openai: (settings: ProviderSettings, model: string) => createOpenAI(settings).responses(model),
  'openai-chat': (settings: ProviderSettings, model: string) => createOpenAI(settings).chat(model),
  anthropic: (settings: ProviderSettings, model: string) =>
    createAnthropic({
      ...settings,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true', ...settings.headers },
    })(model),
  google: (settings: ProviderSettings, model: string) => createGoogleGenerativeAI(settings)(model),
  deepseek: (settings: ProviderSettings, model: string) => createDeepSeek(settings)(model),
} satisfies Record<
  Exclude<AiProvider, 'compatible'>,
  (settings: ProviderSettings, model: string) => LanguageModel
>

/** Only adapter construction varies. Generation and editor tools have one execution path. */
export function connectionModel(connection: AiConnection, fetcher: typeof fetch): LanguageModel {
  const url = connectionUrl(connection.apiUrl)
  url.search = ''
  const settings = {
    baseURL: url.toString().replace(/\/$/, ''),
    apiKey: connection.apiKey,
    headers: connection.headers,
    fetch: fetcher,
  }
  if (connection.provider !== 'compatible')
    return nativeProviders[connection.provider](settings, connection.model)
  settings.baseURL = new URL(resolveChatCompletionsUrl(url.toString()))
    .toString()
    .replace(/\/chat\/completions$/, '')
  return createOpenAICompatible({
    ...settings,
    name: 'momo',
    includeUsage: connection.streamUsage !== false,
    transformRequestBody(body) {
      const { max_tokens, ...rest } = body
      for (const message of rest.messages) {
        if (message.role === 'assistant' && connection.replayReasoning)
          message.reasoning_content ??= ''
        if (message.role === 'user' && Array.isArray(message.content)) {
          for (const part of message.content)
            if (part.type === 'image_url') part.image_url.detail = 'high'
        }
      }
      return {
        ...rest,
        [connection.outputParameter ?? 'max_tokens']: max_tokens,
        ...connection.requestBody,
      }
    },
  }).chatModel(connection.model)
}

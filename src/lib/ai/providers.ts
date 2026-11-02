import type { LanguageModel } from 'ai'
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
  openai: async (settings: ProviderSettings, model: string) => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    return createOpenAI(settings).responses(model)
  },
  'openai-chat': async (settings: ProviderSettings, model: string) => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    return createOpenAI(settings).chat(model)
  },
  anthropic: async (settings: ProviderSettings, model: string) => {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    return createAnthropic({
      ...settings,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true', ...settings.headers },
    })(model)
  },
  google: async (settings: ProviderSettings, model: string) => {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    return createGoogleGenerativeAI(settings)(model)
  },
  deepseek: async (settings: ProviderSettings, model: string) => {
    const { createDeepSeek } = await import('@ai-sdk/deepseek')
    return createDeepSeek(settings)(model)
  },
} satisfies Record<
  Exclude<AiProvider, 'compatible'>,
  (settings: ProviderSettings, model: string) => Promise<LanguageModel>
>

/** Only adapter construction varies. Generation and editor tools have one execution path. */
export async function connectionModel(
  connection: AiConnection,
  fetcher: typeof fetch
): Promise<LanguageModel> {
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
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
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

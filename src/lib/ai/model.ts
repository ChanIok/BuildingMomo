import { APICallError, streamText, type ModelMessage, type ToolSet } from 'ai'
import { connectionModel } from './providers'
import { effectiveReasoning } from './reasoning'
import {
  connectionUrl,
  resolveChatCompletionsUrl,
  validateConnection,
  type AiConnection,
} from './connection'
import { AiError, assertNotAborted } from './types'

/** One SDK generation. The runner, not the SDK, owns tool execution and continuation. */
export function streamModel(options: {
  connection: AiConnection
  messages: ModelMessage[]
  tools: ToolSet
  maxOutputTokens: number
  toolChoice: 'auto' | 'none'
  abortSignal: AbortSignal
  resolveAsset: (id: string) => Promise<Blob | undefined>
  onRequest: (body: unknown) => Promise<void>
  onResponse: (status: number) => void
}) {
  const { connection, abortSignal } = options
  validateConnection(connection)
  assertNotAborted(abortSignal)
  const configuredUrl = connectionUrl(connection.apiUrl)
  const imageSources = options.messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === 'file' &&
          typeof part.data === 'string' &&
          part.data.startsWith('momo-asset:')
            ? [part.data]
            : []
        )
      : []
  )
  const model = connectionModel(connection, async (requestUrl, init) => {
    assertNotAborted(abortSignal)
    const endpoint =
      connection.provider === 'compatible'
        ? resolveChatCompletionsUrl(connection.apiUrl)
        : new URL(String(requestUrl))
    if (endpoint instanceof URL)
      configuredUrl.searchParams.forEach((value, key) => endpoint.searchParams.set(key, value))
    let imageIndex = 0
    // Provider-native image shapes: data URL, Anthropic source.data, Gemini inlineData.data.
    const body = JSON.parse(String(init?.body), function (key, value) {
      if (
        typeof value === 'string' &&
        (value.startsWith('data:image/') ||
          (key === 'data' &&
            ((this.type === 'base64' &&
              typeof this.media_type === 'string' &&
              this.media_type.startsWith('image/')) ||
              (typeof this.mimeType === 'string' && this.mimeType.startsWith('image/')))))
      )
        return imageSources[imageIndex++]
      return value
    })
    await options.onRequest(body)
    assertNotAborted(abortSignal)
    const headers = new AbortController()
    const timer = setTimeout(
      () => headers.abort(new DOMException('Response headers timed out', 'TimeoutError')),
      120_000
    )
    try {
      const response = await fetch(endpoint.toString(), {
        ...init,
        signal: AbortSignal.any([headers.signal, ...(init?.signal ? [init.signal] : [])]),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      options.onResponse(response.status)
      return response
    } finally {
      clearTimeout(timer)
    }
  })
  return streamText({
    model,
    reasoning: effectiveReasoning(connection),
    // Keep durable history local; Responses replay must not rely on provider-side item retention.
    providerOptions:
      connection.provider === 'openai'
        ? {
            ...connection.providerOptions,
            openai: { store: false, ...connection.providerOptions?.openai },
          }
        : connection.providerOptions,
    messages: options.messages,
    allowSystemInMessages: true,
    tools: options.tools,
    toolChoice: options.toolChoice,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: 0,
    onError() {}, // Errors are consumed and persisted by the runner, not dumped with SDK request details.
    abortSignal,
    timeout: { totalMs: 600_000, firstChunkMs: 120_000, chunkMs: 120_000 },
    // Only local assets can be resolved. The SDK does the image encoding; no external downloads.
    experimental_download: async (requests) =>
      Promise.all(
        requests.map(async ({ url }) => {
          assertNotAborted(abortSignal)
          if (url.protocol !== 'momo-asset:') throw new AiError('image')
          const blob = await options.resolveAsset(url.pathname)
          if (!blob || blob.type !== 'image/png') throw new AiError('image')
          return { data: new Uint8Array(await blob.arrayBuffer()), mediaType: blob.type }
        })
      ),
  })
}

export type ModelRequest = Parameters<typeof streamModel>[0]

/** Translate SDK failures only where they affect recovery or user action. */
export function modelFailure(error: unknown): unknown {
  if (error instanceof AiError || (error instanceof Error && error.name === 'AbortError'))
    return error
  if (error instanceof Error && error.name === 'TimeoutError') return new AiError('timeout')
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return new AiError('auth')
    if (error.statusCode === 404) return new AiError('not_found')
    let detail: Record<string, unknown> = {}
    try {
      detail = JSON.parse(error.responseBody ?? '').error ?? {}
    } catch {
      /* Some gateways return plain text. */
    }
    const text = error.responseBody ?? error.message
    if (detail.code === 'context_length_exceeded') return new AiError('context_overflow')
    if (/^max_(?:completion_)?tokens$/.test(String(detail.param ?? '')))
      return new AiError('output_limit')
    if (
      /^(?:reasoning_effort|thinking(?:\.|$))/.test(String(detail.param ?? '')) ||
      /reasoning_effort|thinking\.type|(?:unsupported|invalid|not supported).{0,60}thinking|thinking.{0,60}(?:not supported|not allowed)/i.test(
        text
      )
    )
      return new AiError('reasoning_settings')
    if (
      /max_(?:completion_)?tokens|maxOutputTokens|max_output_tokens|output.*(?:limit|tokens)/i.test(
        text
      )
    )
      return new AiError('output_limit')
    if (
      /context_length_exceeded|context[_ ](?:length|window)|maximum context|prompt is too long|too many (?:input )?tokens|上下文|输入.*过长/i.test(
        text
      )
    )
      return new AiError('context_overflow')
    return new AiError(error.statusCode ? 'http' : 'network')
  }
  return new AiError('provider')
}

import {
  connectionUrl,
  resolveChatCompletionsUrl,
  validateConnectionAccess,
  type AiConnection,
  type AiProvider,
} from './connection'
import { AiError, assertNotAborted } from './types'

export type ModelConnection = Pick<AiConnection, 'provider' | 'apiUrl' | 'apiKey' | 'headers'>
export interface AiModel {
  id: string
  name: string
  contextWindow?: number
  maxOutputTokens?: number
  vision?: boolean
  tools?: boolean
}
type Directory = { format?: 'anthropic' | 'google'; docs: string }
/** Directory endpoints only; no inference request, model-name database or third-party catalog. */
export const MODEL_DIRECTORIES = {
  compatible: { docs: 'https://ai-sdk.dev/providers/openai-compatible-providers' },
  openai: { docs: 'https://developers.openai.com/api/docs/models' },
  'openai-chat': { docs: 'https://developers.openai.com/api/docs/models' },
  anthropic: {
    format: 'anthropic',
    docs: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  },
  google: { format: 'google', docs: 'https://ai.google.dev/gemini-api/docs/models' },
  deepseek: { docs: 'https://api-docs.deepseek.com/quick_start/pricing' },
} satisfies Record<AiProvider, Directory>

export function modelDirectoryUrl(connection: ModelConnection) {
  const directory: Directory = MODEL_DIRECTORIES[connection.provider]
  const url =
    connection.provider === 'compatible'
      ? new URL(resolveChatCompletionsUrl(connection.apiUrl))
      : connectionUrl(connection.apiUrl)
  let base = url.pathname.replace(/\/+$/, '')
  if (connection.provider === 'compatible') base = base.replace(/\/chat\/completions$/, '')
  url.pathname = `${base}/models`
  if (directory.format === 'anthropic') url.searchParams.set('limit', '1000')
  if (directory.format === 'google') url.searchParams.set('pageSize', '1000')
  return url
}
function directoryHeaders(connection: ModelConnection) {
  const headers = new Headers({ Accept: 'application/json' })
  if (connection.provider === 'anthropic') {
    headers.set('x-api-key', connection.apiKey)
    headers.set('anthropic-version', '2023-06-01')
    headers.set('anthropic-dangerous-direct-browser-access', 'true')
  } else if (connection.provider === 'google') headers.set('x-goog-api-key', connection.apiKey)
  else if (connection.apiKey) headers.set('Authorization', `Bearer ${connection.apiKey}`)
  for (const [key, value] of Object.entries(connection.headers ?? {})) headers.set(key, value)
  return headers
}
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
function modelEntry(value: unknown, format: Directory['format']): AiModel | null {
  if (!value || typeof value !== 'object') throw new AiError('models_format')
  const row = value as Record<string, any>
  if (
    format === 'google' &&
    Array.isArray(row.supportedGenerationMethods) &&
    !row.supportedGenerationMethods.includes('generateContent')
  )
    return null
  if (row.capabilities?.completion_chat === false || row.active === false) return null
  const id =
    format === 'google'
      ? typeof row.name === 'string'
        ? row.name.replace(/^models\//, '')
        : undefined
      : row.id
  if (typeof id !== 'string' || !id.trim()) throw new AiError('models_format')
  return {
    id,
    name:
      [row.display_name, row.displayName, row.name].find(
        (name) => typeof name === 'string' && name.trim()
      ) ?? id,
    contextWindow: positive(row.context_window ?? row.context_length),
    maxOutputTokens: positive(
      row.max_output_tokens ??
        (format === 'google'
          ? row.outputTokenLimit
          : format === 'anthropic'
            ? row.max_tokens
            : undefined)
    ),
    vision: Array.isArray(row.input_modalities)
      ? row.input_modalities.includes('image')
      : typeof row.capabilities?.image_input?.supported === 'boolean'
        ? row.capabilities.image_input.supported
        : typeof row.capabilities?.vision === 'boolean'
          ? row.capabilities.vision
          : undefined,
    tools:
      typeof row.capabilities?.function_calling === 'boolean'
        ? row.capabilities.function_calling
        : undefined,
  }
}

export async function listConnectionModels(
  connection: ModelConnection,
  signal: AbortSignal
): Promise<AiModel[]> {
  validateConnectionAccess(connection)
  const directory: Directory = MODEL_DIRECTORIES[connection.provider]
  const url = modelDirectoryUrl(connection)
  const headers = directoryHeaders(connection)
  const combined = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  const seen = new Set<string>(),
    models = new Map<string, AiModel>()
  try {
    while (true) {
      assertNotAborted(combined)
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: combined,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      if ([401, 403].includes(response.status)) throw new AiError('models_auth')
      if ([404, 405, 501].includes(response.status)) throw new AiError('models_unavailable')
      if (response.status === 429) throw new AiError('models_rate_limit')
      if (!response.ok) throw new AiError('models_http', String(response.status))
      let data: any
      try {
        data = await response.json()
      } catch {
        throw new AiError('models_format')
      }
      assertNotAborted(combined)
      const rows = Array.isArray(data) ? data : (data?.data ?? data?.models)
      if (!Array.isArray(rows)) throw new AiError('models_format')
      for (const row of rows) {
        const model = modelEntry(row, directory.format)
        if (model) models.set(model.id, model)
      }
      const cursor =
        directory.format === 'anthropic' && data.has_more
          ? data.last_id
          : directory.format === 'google'
            ? data.nextPageToken
            : undefined
      if (!cursor) {
        if (
          (directory.format === 'anthropic' && data.has_more) ||
          data.has_more === true ||
          data.next_page_token ||
          data.nextPageToken
        )
          throw new AiError('models_format')
        break
      }
      if (typeof cursor !== 'string' || seen.has(cursor)) throw new AiError('models_format')
      seen.add(cursor)
      url.searchParams.set(directory.format === 'anthropic' ? 'after_id' : 'pageToken', cursor)
    }
    return [...models.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    )
  } catch (cause) {
    if (signal.aborted) throw signal.reason
    if (combined.aborted) throw new AiError('models_timeout')
    if (cause instanceof AiError) throw cause
    throw new AiError('models_network')
  }
}

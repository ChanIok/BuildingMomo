import { afterEach, expect, it, vi } from 'vitest'
import {
  listConnectionModels,
  modelDirectoryUrl,
  MODEL_DIRECTORIES,
  type ModelConnection,
} from '@/lib/ai/models'
import type { AiProvider } from '@/lib/ai/connection'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const connection = (provider: AiProvider = 'compatible'): ModelConnection => ({
  provider,
  apiUrl: 'https://proxy.test/root/v1?route=a',
  apiKey: 'private-key',
  headers: { 'X-Project': 'momo' },
})
const signal = () => new AbortController().signal
it.each(Object.keys(MODEL_DIRECTORIES) as AiProvider[])(
  'uses the configured %s directory without guessing another host or protocol',
  async (provider) => {
    const fetcher = vi.fn(async () =>
      Response.json(
        provider === 'google'
          ? { models: [{ name: 'models/gemini-alias', displayName: 'Gemini' }] }
          : { data: [{ id: 'alias', name: 'Friendly' }] }
      )
    )
    vi.stubGlobal('fetch', fetcher)
    const draft = connection(provider)
    const result = await listConnectionModels(draft, signal())
    expect(result).toHaveLength(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/root/v1/models')
    expect(new URL(url).searchParams.get('route')).toBe('a')
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
    expect(init.body).toBeUndefined()
    const headers = new Headers(init.headers)
    expect(headers.get('X-Project')).toBe('momo')
    expect(
      headers.get(
        provider === 'google'
          ? 'x-goog-api-key'
          : provider === 'anthropic'
            ? 'x-api-key'
            : 'authorization'
      )
    ).toContain('private-key')
  }
)
it('derives models from a full compatible endpoint and preserves query without requiring a model or key', async () => {
  let headers: Headers
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      headers = new Headers(init.headers)
      return Response.json({ data: [{ id: 'local-model' }] })
    })
  )
  const draft = {
    ...connection(),
    apiUrl: 'http://localhost:1234/v1/chat/completions?route=x',
    apiKey: '',
  }
  expect(modelDirectoryUrl(draft).toString()).toBe('http://localhost:1234/v1/models?route=x')
  expect(await listConnectionModels(draft, signal())).toMatchObject([{ id: 'local-model' }])
  expect(headers!.get('authorization')).toBeNull()
})
it.each(['anthropic', 'google'] as const)(
  'follows all %s pages with a local cursor, normalizing names and removing duplicates',
  async (provider) => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        urls.push(String(url))
        const first = urls.length === 1
        return Response.json(
          provider === 'anthropic'
            ? {
                data: [{ id: first ? 'a' : 'b', display_name: first ? 'A' : 'B' }],
                has_more: first,
                last_id: first ? 'a' : 'b',
              }
            : {
                models: [
                  {
                    name: `models/${first ? 'a' : 'b'}`,
                    supportedGenerationMethods: ['generateContent'],
                  },
                  { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
                ],
                nextPageToken: first ? 'next' : undefined,
              }
        )
      })
    )
    const models = await listConnectionModels(connection(provider), signal())
    expect(models.map((model) => model.id)).toEqual(['a', 'b'])
    expect(urls).toHaveLength(2)
    expect(
      new URL(urls[1]!).searchParams.get(provider === 'anthropic' ? 'after_id' : 'pageToken')
    ).toBe(provider === 'anthropic' ? 'a' : 'next')
  }
)
it('reads declared metadata, without inferring capabilities from a model ID', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        data: [
          {
            id: 'a',
            context_window: 100000,
            max_output_tokens: 8000,
            input_modalities: ['text'],
            capabilities: { function_calling: true },
          },
          { id: 'vision-tools-alias', max_tokens: 9999 },
        ],
      })
    )
  )
  const models = await listConnectionModels(connection('deepseek'), signal())
  expect(models[0]).toMatchObject({
    contextWindow: 100000,
    maxOutputTokens: 8000,
    vision: false,
    tools: true,
  })
  expect(models[1]?.vision).toBeUndefined()
  expect(models[1]?.tools).toBeUndefined()
  expect(models[1]?.maxOutputTokens).toBeUndefined()
})
it.each([
  [401, 'models_auth'],
  [403, 'models_auth'],
  [404, 'models_unavailable'],
  [405, 'models_unavailable'],
  [429, 'models_rate_limit'],
  [500, 'models_http'],
] as const)(
  'reports HTTP %s without retries or server-body credential leakage',
  async (status, code) => {
    const fetcher = vi.fn(async () => new Response('private-key', { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(listConnectionModels(connection(), signal())).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledOnce()
  }
)
it.each([{ unexpected: [] }, { data: [{ nope: 'not-a-model' }] }, { data: [], has_more: true }])(
  'rejects malformed or incomplete directories: %j',
  async (data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(data))
    )
    await expect(listConnectionModels(connection(), signal())).rejects.toMatchObject({
      code: 'models_format',
    })
  }
)
it('rejects repeated pagination cursors instead of looping or publishing a partial list', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' })
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(listConnectionModels(connection('anthropic'), signal())).rejects.toMatchObject({
    code: 'models_format',
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('bounds discovery time without treating cancellation as a network failure', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(init.signal.reason))
        )
    )
  )
  const controller = new AbortController(),
    pending = listConnectionModels(connection(), controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})

it('reports a directory timeout separately from user cancellation', async () => {
  const timeout = new AbortController()
  const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(init.signal.reason))
        )
    )
  )
  const pending = listConnectionModels(connection(), signal())
  const outcome = expect(pending).rejects.toMatchObject({ code: 'models_timeout' })
  timeout.abort(new DOMException('timeout', 'TimeoutError'))
  await outcome
  expect(timer).toHaveBeenCalledWith(30000)
})

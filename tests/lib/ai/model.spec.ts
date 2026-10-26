import { afterEach, expect, it, vi } from 'vitest'
import { streamModel, modelFailure, type ModelRequest } from '@/lib/ai/model'
import { workbenchTools } from '@/lib/ai/tools'
import { createAgentRunner } from '@/lib/ai/runner'
import { createPolicy } from '@/lib/ai/context'
import { AiError } from '@/lib/ai/types'
import { workbenchFixture } from '../../fixtures/ai'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function event(delta: unknown, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
}
function response(text = event({ content: 'Done' }, 'stop')) {
  return new Response(text + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}
function request(patch: Partial<ModelRequest> = {}): ModelRequest {
  return {
    connection: {
      provider: 'compatible' as const,
      apiUrl: 'https://example.test/v1',
      apiKey: 'secret',
      model: 'chosen',
    },
    messages: [{ role: 'user', content: 'Inspect' }],
    tools: workbenchTools,
    maxOutputTokens: 8000,
    toolChoice: 'auto',
    abortSignal: new AbortController().signal,
    resolveAsset: vi.fn(),
    onRequest: vi.fn(async () => {}),
    onResponse: vi.fn(),
    ...patch,
  }
}
async function generate(input: ModelRequest) {
  try {
    const generation = streamModel(input)
    for await (const part of generation.stream) if (part.type === 'error') throw part.error
    return await generation.finalStep
  } catch (error) {
    throw modelFailure(error)
  }
}

it.each(['https://gateway.test/v1?route=a', 'https://gateway.test/v1/chat/completions?route=a'])(
  'preserves the endpoint and query: %s',
  async (apiUrl) => {
    const fetcher = vi.fn(async (_url: unknown, _init: unknown) => response())
    vi.stubGlobal('fetch', fetcher)
    await generate(
      request({ connection: { provider: 'compatible', apiUrl, apiKey: 'key', model: 'model' } })
    )
    expect(fetcher.mock.calls[0]![0]).toBe('https://gateway.test/v1/chat/completions?route=a')
  }
)

it('maps OpenAI limits and explicit compatibility overrides without DeepSeek fields', async () => {
  const sent: any[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init.body))
      return response()
    })
  )
  const input = request({
    connection: {
      provider: 'compatible' as const,
      apiUrl: 'https://gateway.test/v1',
      apiKey: 'key',
      model: 'gpt-5.2',
      requestBody: { reasoning_effort: 'xhigh' },
      outputParameter: 'max_completion_tokens',
    },
  })
  await generate(input)
  expect(sent[0]).toMatchObject({ max_completion_tokens: 8000, reasoning_effort: 'xhigh' })
  expect(sent[0]).not.toHaveProperty('max_tokens')
  expect(sent[0]).not.toHaveProperty('thinking')
  input.connection.outputParameter = 'max_tokens'
  input.connection.streamUsage = false
  await generate(input)
  expect(sent[1]).toHaveProperty('max_tokens', 8000)
  expect(sent[1]).not.toHaveProperty('max_completion_tokens')
  expect(sent[1]).not.toHaveProperty('stream_options')
})

it('replays SDK reasoning for DeepSeek, including the empty continuation field', async () => {
  let body: any
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      body = JSON.parse(init.body)
      return response(event({ reasoning_content: 'Checked', content: 'Done' }, 'stop'))
    })
  )
  const result = await generate(
    request({
      connection: {
        provider: 'compatible' as const,
        apiUrl: 'https://gateway.test/v1',
        apiKey: 'key',
        model: 'deepseek-v4-pro',
        requestBody: { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
        replayReasoning: true,
      },
      messages: [
        { role: 'assistant', content: 'Earlier answer' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Evidence' },
            { type: 'text', text: 'Observed' },
          ],
        },
      ],
    })
  )
  expect(body).toMatchObject({
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
    max_tokens: 8000,
  })
  expect(body.messages.map((message: any) => message.reasoning_content)).toEqual(['', 'Evidence'])
  expect(result.reasoningText).toBe('Checked')
})

it('resolves local images and records references instead of base64 copies', async () => {
  const blob = new Blob(['first-image'], { type: 'image/png' })
  const sources = Array.from({ length: 2 }, (_, i) => `momo-asset:asset:conversation:${i}`)
  let body: any
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      body = JSON.parse(init.body)
      return response()
    })
  )
  const input = request({
    messages: [
      {
        role: 'user',
        content: sources.map((data) => ({ type: 'file', mediaType: 'image/png', data })),
      },
    ],
    resolveAsset: vi.fn(async (id) =>
      id.endsWith(':0') ? blob : new Blob(['png'], { type: 'image/png' })
    ),
  })
  await generate(input)
  expect(body.messages[0].content).toHaveLength(2)
  expect(body.messages[0].content[0].image_url.url).toMatch(/^data:image\/png;base64,/)
  const trace = vi.mocked(input.onRequest).mock.calls[0]![0] as any
  expect(trace.messages[0].content.map((part: any) => part.image_url.url)).toEqual(sources)
  expect(JSON.stringify(trace)).not.toContain('base64')
})

it('never downloads an external file URL or sends a request when an image is missing', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  for (const data of ['https://untrusted.test/image.png', 'momo-asset:missing']) {
    await expect(
      generate(
        request({
          messages: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data }] }],
        })
      )
    ).rejects.toMatchObject({ code: 'image' })
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([
  [401, { message: 'Denied' }, 'auth'],
  [404, { message: 'Missing model' }, 'not_found'],
  [
    400,
    { code: 'context_length_exceeded', message: 'Input plus max_tokens exceeds context' },
    'context_overflow',
  ],
  [
    400,
    { param: 'max_tokens', message: 'Invalid output limit with thinking enabled' },
    'output_limit',
  ],
  [400, { param: 'reasoning_effort', message: 'Unsupported value' }, 'reasoning_settings'],
  [400, { message: 'thinking is not supported' }, 'reasoning_settings'],
  [400, { message: 'Input and thinking tokens exceed maximum context length' }, 'context_overflow'],
])(
  'classifies HTTP %s without SDK retries or parameter-stripping fallbacks',
  async (status, error, code) => {
    const fetcher = vi.fn(async () => Response.json({ error }, { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(generate(request())).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledOnce()
  }
)

it('does not send after preparation fails or is cancelled', async () => {
  const fetcher = vi.fn(),
    controller = new AbortController()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    generate(
      request({
        onRequest: async () => {
          throw new AiError('storage')
        },
      })
    )
  ).rejects.toMatchObject({ code: 'storage' })
  await generate(
    request({
      abortSignal: controller.signal,
      onRequest: async () => {
        controller.abort()
      },
    })
  ).catch(() => {})
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['headers', 'first output', 'output gap'])(
  'reports %s timeout separately from a user stop',
  async (mode) => {
    const { repository, records, scene } = await workbenchFixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetcher = vi.fn((_url, init) =>
      mode === 'headers'
        ? new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
          })
        : Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  init.signal.addEventListener(
                    'abort',
                    () => controller.error(init.signal.reason),
                    { once: true }
                  )
                  if (mode === 'output gap')
                    controller.enqueue(new TextEncoder().encode(event({ content: 'Started' })))
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } }
            )
          )
    )
    vi.stubGlobal('fetch', fetcher)
    const outcome = createAgentRunner(repository)
      .run({
        records,
        scene,
        connection: request().connection,
        policy: createPolicy(),
        system: 'rules',
        text: 'Inspect',
        onChange() {},
        onProgress() {},
      })
      .then(
        () => null,
        (error) => error
      )
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      if (mode === 'output gap')
        expect(JSON.stringify(records.messages.at(-1)?.content)).toContain('Started')
    })
    await vi.advanceTimersByTimeAsync(120_001)
    expect(await outcome).toMatchObject({ code: 'timeout' })
    expect(records.conversation.lastRun).toMatchObject({
      state: 'failed',
      error: { code: 'timeout' },
    })
  }
)

it.each(['length', 'content_filter', null])(
  'never executes streamed calls when generation ends with %s',
  async (finish) => {
    const { repository, records, scene } = await workbenchFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          event(
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'read',
                  type: 'function',
                  function: { name: 'inspect', arguments: '{"ref":"selection"}' },
                },
              ],
            },
            finish
          )
        )
      )
    )
    await expect(
      createAgentRunner(repository).run({
        records,
        scene,
        connection: request().connection,
        policy: createPolicy(),
        system: 'rules',
        text: 'Inspect',
        onChange() {},
        onProgress() {},
      })
    ).rejects.toBeDefined()
    expect(records.tools).toEqual([])
    expect(records.messages.at(-1)?.state).toBe('interrupted')
    expect(scene.snapshot).not.toHaveBeenCalled()
    expect(scene.apply).not.toHaveBeenCalled()
    expect(
      JSON.stringify((await repository.requests(records.conversation.id))[0]?.toolInput)
    ).toContain('selection')
  }
)

it.each([
  ['unknown-tool', '{}'],
  ['inspect', '{"ref":'],
  ['compute', JSON.stringify({ inputs: { ['__proto__']: 'R1' }, code: 'return 1' })],
  ['render', JSON.stringify({ panels: [{ ref: 'R1', label: 'View', camera: { view: 'top' } }] })],
])('returns invalid %s calls to the model without executing them', async (name, argumentsText) => {
  const { repository, records, scene } = await workbenchFixture()
  const sent: any[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init.body))
      return sent.length === 1
        ? response(
            event(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'invalid',
                    type: 'function',
                    function: {
                      name,
                      arguments: argumentsText,
                    },
                  },
                ],
              },
              'tool_calls'
            )
          )
        : response()
    })
  )
  await createAgentRunner(repository).run({
    records,
    scene,
    connection: request().connection,
    policy: createPolicy(),
    system: 'rules',
    text: 'Inspect',
    onChange() {},
    onProgress() {},
  })
  expect(sent).toHaveLength(2)
  expect(records.tools[0]).toMatchObject({
    state: 'failed',
    result: { error: { code: 'invalid_input' } },
  })
  expect(sent[1].messages.find((m: any) => m.role === 'tool').content).toContain('invalid_input')
  expect(scene.snapshot).not.toHaveBeenCalled()
  expect(scene.render).not.toHaveBeenCalled()
  expect(scene.apply).not.toHaveBeenCalled()
})

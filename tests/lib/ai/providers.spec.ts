import { afterEach, expect, it, vi } from 'vitest'
import { asSchema } from 'ai'
import { AI_PROVIDERS, type AiConnection, type AiProvider } from '@/lib/ai/connection'
import { streamModel, modelFailure } from '@/lib/ai/model'
import { createAgentRunner } from '@/lib/ai/runner'
import { createPolicy, projectSource } from '@/lib/ai/context'
import { workbenchTools } from '@/lib/ai/tools'
import { workbenchFixture } from '../../fixtures/ai'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const sse = (...events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
function request(provider: AiProvider) {
  return {
    connection: {
      provider,
      apiUrl: 'https://proxy.test/api?route=custom',
      apiKey: 'key',
      model: 'future-alias',
      headers: { 'X-Project': 'momo' },
    } as AiConnection,
    messages: [{ role: 'user' as const, content: 'Hello' }],
    tools: workbenchTools,
    maxOutputTokens: 8000,
    toolChoice: 'auto' as const,
    abortSignal: new AbortController().signal,
    resolveAsset: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    onRequest: vi.fn(async (_body: unknown) => {}),
    onResponse: vi.fn(),
  }
}
async function generate(input: Parameters<typeof streamModel>[0]) {
  const result = streamModel(input)
  for await (const part of result.stream) if (part.type === 'error') throw modelFailure(part.error)
  return result.finalStep
}

const paths: Record<AiProvider, string> = {
  compatible: '/api/chat/completions',
  openai: '/api/responses',
  'openai-chat': '/api/chat/completions',
  anthropic: '/api/messages',
  google: '/api/models/future-alias:streamGenerateContent',
  deepseek: '/api/chat/completions',
}
it.each(Object.keys(AI_PROVIDERS) as AiProvider[])(
  'constructs the real %s adapter and preserves its path, headers and query',
  async (provider) => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: { message: 'Denied', type: 'authentication_error', code: 401 } },
        { status: 401 }
      )
    )
    vi.stubGlobal('fetch', fetcher)
    const input = request(provider)
    await expect(generate(input)).rejects.toMatchObject({ code: 'auth' })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).pathname).toBe(paths[provider])
    expect(new URL(url).searchParams.get('route')).toBe('custom')
    expect(new Headers(init.headers).get('X-Project')).toBe('momo')
    expect(init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
    if (provider === 'google') expect(new URL(url).searchParams.get('alt')).toBe('sse')
    expect(input.onRequest).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(input.onRequest).mock.calls)).not.toContain('X-Project')
  }
)

function anthropicReply(call = false) {
  const block = call
    ? { type: 'tool_use', id: 'inspect-1', name: 'inspect', input: {} }
    : { type: 'text', text: '' }
  return sse(
    {
      type: 'message_start',
      message: { id: 'message-1', model: 'future-alias', usage: { input_tokens: 30 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Evidence' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'signed-thought' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: block },
    {
      type: 'content_block_delta',
      index: 1,
      delta: call
        ? { type: 'input_json_delta', partial_json: '{"ref":"selection"}' }
        : { type: 'text_delta', text: 'Done' },
    },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: { stop_reason: call ? 'tool_use' : 'end_turn' },
      usage: { output_tokens: 10 },
    },
    { type: 'message_stop' }
  )
}
it('runs native Anthropic tools and replays signed thinking after a reload, never into another protocol', async () => {
  const { repository, records, scene } = await workbenchFixture()
  const sent: any[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init.body))
      return anthropicReply(sent.length === 1)
    })
  )
  const connection = {
    ...request('anthropic').connection,
    providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } } },
  }
  const options = {
    records,
    scene,
    connection,
    policy: createPolicy(),
    system: 'Rules',
    text: 'Inspect',
    onChange() {},
    onProgress() {},
  }
  await createAgentRunner(repository).run(options)
  expect(records.tools[0]).toMatchObject({ state: 'succeeded', name: 'inspect' })
  expect(sent[0]).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 2048 } })
  expect(sent[1].messages.find((m: any) => m.role === 'assistant').content).toContainEqual({
    type: 'thinking',
    thinking: 'Evidence',
    signature: 'signed-thought',
  })
  expect(
    sent[1].messages.find(
      (m: any) => m.role === 'user' && m.content.some?.((part: any) => part.type === 'tool_result')
    )
  ).toBeDefined()
  const restored = (await repository.load(records.conversation.schemeId, records.conversation.id))!
  await createAgentRunner(repository).run({ ...options, records: restored, text: 'Continue' })
  expect(JSON.stringify(sent[2])).toContain('signed-thought')
  const assistant = restored.messages.find((m) => m.role === 'assistant')!
  const switched = projectSource(
    assistant.id,
    restored,
    { ...connection, provider: 'openai-chat' },
    50000
  )
  expect(JSON.stringify(switched)).not.toContain('signed-thought')
  expect(JSON.stringify(switched)).not.toContain('Evidence')
})

it.each(['anthropic', 'google', 'openai'] as const)(
  'serializes native %s images and options while storing only image references in traces',
  async (provider) => {
    const input = request(provider)
    const source = 'momo-asset:asset:c:1'
    let wire: any
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        wire = JSON.parse(init.body)
        if (provider === 'anthropic') return anthropicReply()
        if (provider === 'google')
          return sse({
            candidates: [
              { content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 },
          })
        return sse(
          {
            type: 'response.created',
            response: { id: 'resp-1', model: 'future-alias', created_at: 1 },
          },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'msg-1' },
          },
          { type: 'response.output_text.delta', item_id: 'msg-1', delta: 'Done' },
          {
            type: 'response.completed',
            response: { usage: { input_tokens: 30, output_tokens: 10 } },
          }
        )
      })
    )
    const options = {
      anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } },
      google: { thinkingConfig: { includeThoughts: true } },
      openai: { store: false, forceReasoning: true, reasoningEffort: 'high' },
    }
    const result = await generate({
      ...input,
      connection: { ...input.connection, providerOptions: { [provider]: options[provider] } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'View' },
            { type: 'file', mediaType: 'image/png', data: source },
          ],
        },
      ],
    })
    expect(result.text).toBe('Done')
    expect(JSON.stringify(wire)).toContain('cG5n')
    const trace = vi.mocked(input.onRequest).mock.calls[0]![0]
    expect(JSON.stringify(trace)).toContain(source)
    expect(JSON.stringify(trace)).not.toContain('cG5n')
    if (provider === 'google')
      expect(wire.generationConfig.thinkingConfig.includeThoughts).toBe(true)
    if (provider === 'openai')
      expect(wire).toMatchObject({ store: false, reasoning: { effort: 'high' } })
  }
)

it('supports keyless compatible servers and arbitrary extension parameters', async () => {
  let authorization: string | null | undefined, body: any
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      authorization = new Headers(init.headers).get('authorization')
      body = JSON.parse(init.body)
      return sse({ choices: [{ index: 0, delta: { content: 'Local' }, finish_reason: 'stop' }] })
    })
  )
  const input = request('compatible')
  await generate({
    ...input,
    connection: {
      ...input.connection,
      apiKey: '',
      requestBody: { vendor_extension: { enabled: true } },
    },
  })
  expect(authorization).toBeNull()
  expect(body.vendor_extension).toEqual({ enabled: true })
})
it.each(['google', 'openai'] as const)(
  'continues native %s tool calls through the shared runner and durable history',
  async (provider) => {
    const { repository, records, scene } = await workbenchFixture()
    const sent: any[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        sent.push(JSON.parse(init.body))
        const call = sent.length === 1
        if (provider === 'google')
          return sse({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: call
                    ? [
                        {
                          functionCall: {
                            name: 'inspect',
                            args: { ref: 'selection' },
                            id: 'inspect-1',
                          },
                          thoughtSignature: 'gemini-signature',
                        },
                      ]
                    : [{ text: 'Done' }],
                },
                finishReason: 'STOP',
              },
            ],
          })
        if (call)
          return sse(
            {
              type: 'response.created',
              response: { id: 'resp-1', model: 'future-alias', created_at: 1 },
            },
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: {
                type: 'function_call',
                id: 'fc-1',
                call_id: 'inspect-1',
                name: 'inspect',
                arguments: '',
              },
            },
            {
              type: 'response.function_call_arguments.delta',
              item_id: 'fc-1',
              output_index: 0,
              delta: '{"ref":"selection"}',
            },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: 'function_call',
                id: 'fc-1',
                call_id: 'inspect-1',
                name: 'inspect',
                arguments: '{"ref":"selection"}',
                status: 'completed',
              },
            },
            { type: 'response.completed', response: {} }
          )
        return sse(
          {
            type: 'response.created',
            response: { id: 'resp-2', model: 'future-alias', created_at: 1 },
          },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'msg-2' },
          },
          { type: 'response.output_text.delta', item_id: 'msg-2', delta: 'Done' },
          { type: 'response.completed', response: {} }
        )
      })
    )
    const options = {
      records,
      scene,
      connection: request(provider).connection,
      policy: createPolicy(),
      system: 'Rules',
      text: 'Inspect',
      onChange() {},
      onProgress() {},
    }
    await createAgentRunner(repository).run(options)
    expect(records.tools[0]).toMatchObject({ name: 'inspect', state: 'succeeded' })
    if (provider === 'google') {
      expect(records.tools[0]?.providerOptions).toMatchObject({
        google: { thoughtSignature: 'gemini-signature' },
      })
      expect(JSON.stringify(sent[1])).toContain('gemini-signature')
      expect(JSON.stringify(sent[1])).toContain('functionResponse')
    } else {
      expect(sent[0].store).toBe(false)
      expect(sent[1].input).toContainEqual(
        expect.objectContaining({
          type: 'function_call',
          call_id: 'inspect-1',
          name: 'inspect',
          arguments: '{"ref":"selection"}',
        })
      )
      expect(sent[1].input).toContainEqual(
        expect.objectContaining({ type: 'function_call_output', call_id: 'inspect-1' })
      )
      expect(sent[1].input.some((part: any) => part.type === 'item_reference')).toBe(false)
    }
    const restored = (await repository.load(
      records.conversation.schemeId,
      records.conversation.id
    ))!
    await createAgentRunner(repository).run({ ...options, records: restored, text: 'Continue' })
    if (provider === 'google') expect(JSON.stringify(sent[2])).toContain('gemini-signature')
    else
      expect(sent[2].input).toContainEqual(
        expect.objectContaining({ type: 'function_call_output', call_id: 'inspect-1' })
      )
  }
)

it('sends complete, simple function schemas through the real Gemini adapter', async () => {
  let wire: any
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      wire = JSON.parse(init.body)
      return sse({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' },
        ],
      })
    })
  )
  await generate(request('google'))
  const declarations = wire.tools[0].functionDeclarations
  expect(declarations.map((declaration: any) => declaration.name)).toEqual(
    Object.keys(workbenchTools)
  )
  for (const [name, definition] of Object.entries(workbenchTools)) {
    const declaration = declarations.find((entry: any) => entry.name === name)
    expect(declaration.parametersJsonSchema).toEqual(
      await asSchema(definition.inputSchema).jsonSchema
    )
    expect(declaration).not.toHaveProperty('metadata')
    expect(definition).not.toHaveProperty('execute')
  }
  expect(declarations[3].parametersJsonSchema).not.toHaveProperty('anyOf')
})

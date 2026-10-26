import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { workbenchFixture } from '../../fixtures/ai'
import { createAgentRunner, type RunOptions } from '@/lib/ai/runner'
import { exportConversation } from '@/lib/ai/diagnostics'
import { createPolicy } from '@/lib/ai/context'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function stream(delta: unknown, finish = 'stop', usage?: unknown) {
  const event = {
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}
function call(id: string, name: string, input: unknown) {
  return stream(
    {
      tool_calls: [
        { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(input) } },
      ],
    },
    'tool_calls'
  )
}

it('exports captured provider requests, not reconstructed messages, with redacted keys and lazy images', async () => {
  const { repository, records, scene } = await workbenchFixture()
  const expected: any[] = []
  let count = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      expected.push(JSON.parse(init.body))
      const step = count++
      if (step === 0) return call('selection', 'inspect', { ref: 'selection' })
      if (step === 1) return call('render', 'render', { panels: [{ ref: 'R1', label: 'Roof' }] })
      if (step === 2) return call('reread', 'inspect', { ref: 'R2' })
      return stream({ content: 'Seen' }, 'stop', {
        prompt_tokens: 200,
        prompt_tokens_details: { cached_tokens: 100 },
        completion_tokens: 2,
      })
    })
  )
  const options: RunOptions = {
    records,
    scene,
    connection: {
      provider: 'compatible' as const,
      apiUrl: 'https://example.test/v1?key=query-key',
      apiKey: 'secret-key',
      model: 'model',
      outputParameter: 'max_completion_tokens',
      streamUsage: false,
    },
    policy: createPolicy(),
    system: 'rules',
    text: 'My secret-key',
    onChange() {},
    onProgress() {},
  }
  const runner = createAgentRunner(repository)
  await runner.run(options)
  const read = vi.spyOn(repository, 'read')
  const json = await exportConversation(repository, records, false, ['secret-key'])
  expect(json).not.toContain('secret-key')
  expect(json).not.toContain('query-key')
  expect(json).not.toContain('base64')
  expect(read.mock.calls.every(([id]) => !id.startsWith('asset:'))).toBe(true)
  const log = JSON.parse(json)
  for (let i = 1; i < expected.length; i++)
    expect(expected[i].messages.slice(0, expected[i - 1].messages.length)).toEqual(
      expected[i - 1].messages
    )
  const asset = records.artifacts.find((a) => a.kind === 'image')!.asset!
  const captured = () =>
    JSON.parse(
      JSON.stringify(expected)
        .replaceAll('secret-key', '[REDACTED]')
        .replaceAll('data:image/png;base64,cG5n', `momo-asset:${asset.id}`)
    )
  expect(log.requests.map((r: any) => r.body)).toEqual(captured())
  expect(log.requests.at(-1).diagnostics.usage.inputTokenDetails.cacheReadTokens).toBe(100)
  expect(log.requests[0].body).toHaveProperty('max_completion_tokens', options.policy.maxTokens)
  expect(log.requests[0].body).not.toHaveProperty('stream_options')
  const withImages = JSON.parse(await exportConversation(repository, records, true))
  expect(withImages.images).toHaveLength(1)
  expect(withImages.images[0].dataUrl).toBe('data:image/png;base64,cG5n')
  for (const label of ['earlier-checkpoint', 'new-checkpoint']) {
    records.checkpoint = {
      id: `checkpoint:${records.conversation.id}:${label}`,
      conversationId: records.conversation.id,
      text: label,
      throughSequence: 1,
      requestId: 'summary',
    }
    records.conversation.checkpointId = records.checkpoint.id
    await repository.save(records.conversation, [records.checkpoint])
    await runner.run({ ...options, text: 'Continue' })
  }
  const history = JSON.parse(await exportConversation(repository, records, false, ['secret-key']))
  expect(history.requests.map((r: any) => r.body)).toEqual(captured())
  expect(JSON.stringify(history.requests)).toContain('earlier-checkpoint')
})

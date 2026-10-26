import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { unresolvedEdits, type RunOptions } from '@/lib/ai/runner'
import { createPolicy } from '@/lib/ai/context'
import { AiError, type AssetRecord, type MessageRecord } from '@/lib/ai/types'
import { createArtifacts } from '@/lib/ai/artifacts'
import {
  createScriptedRunner as createAgentRunner,
  type ScriptedReply,
  workbenchFixture,
  applyCommand,
} from '../../fixtures/ai'
import type { ModelRequest } from '@/lib/ai/model'
import type { ToolCallPart } from 'ai'
const projection = (request: ModelRequest) => ({ messages: request.messages, tools: request.tools })

const call = (
  id: string,
  name = 'inspect',
  parameters: unknown = name === 'apply' ? applyCommand : { ref: 'R1' }
) => ({ type: 'tool-call' as const, toolCallId: id, toolName: name, input: parameters })
const reply = (text: string, toolCalls: ToolCallPart[] = []): ScriptedReply => ({ text, toolCalls })
async function setup(replies: ScriptedReply[] = [reply('Done')]) {
  const { repository, records, scene, invalidate } = await workbenchFixture()
  // Existing references belong to prior analysis, not to the next user message.
  const store = createArtifacts(records, repository)
  const artifact = await store.add(
    { kind: 'set', label: 'Roof', schemeId: 'scheme-1', revision: 'v1', count: 2 },
    ['a', 'b']
  )
  await repository.save(records.conversation, store.staged)
  records.artifacts.push(artifact)
  const complete = vi.fn(async (_request: ModelRequest) => replies.shift()!)
  const runner = createAgentRunner(repository, complete)
  const options: RunOptions = {
    records,
    scene,
    connection: {
      provider: 'compatible' as const,
      apiUrl: 'https://example.test/v1',
      apiKey: 'secret',
      model: 'model',
    },
    policy: createPolicy(16000, 4000),
    system: 'rules',
    text: 'Organize only the roof.',
    onChange: vi.fn(),
    onProgress: vi.fn(),
  }
  return { repository, records, scene, complete, runner, options, invalidate }
}

it('persists one canonical conversation, executes reads then one edit, and continues on its new version', async () => {
  const s = await setup([reply('Inspect', [call('q'), call('e', 'apply')]), reply('Done')])
  await s.runner.run(s.options)
  expect(s.scene.snapshot).toHaveBeenCalledWith(['a', 'b'])
  expect(s.scene.apply).toHaveBeenCalledWith(
    {
      collections: [],
      groups: [{ id: 'roof', name: 'Roof', collectionId: null, itemIds: ['a', 'b'] }],
    },
    'v1'
  )
  expect(s.records.tools[1]).toMatchObject({ state: 'succeeded', edit: { transactionId: 'tx' } })
  expect(s.records.tools[1]?.edit?.transactionId).toBe('tx')
  const restored = (await s.repository.load('scheme-1', s.records.conversation.id))!
  expect(restored.conversation.lastRun?.state).toBe('completed')
  expect(restored.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
  expect(restored.tools.every((tool) => tool.state === 'succeeded')).toBe(true)
})

it('preserves the complete wire prefix through tools, edits, reload and external undo verification', async () => {
  const s = await setup([
    reply('', [call('read')]),
    reply('', [call('edit', 'apply')]),
    reply('', [call('read-again')]),
    reply('Done'),
  ])
  await s.runner.run(s.options)
  const sent = s.complete.mock.calls.map(([request]) => projection(request))
  for (let i = 1; i < sent.length; i++) {
    expect(sent[i]!.messages.slice(0, sent[i - 1]!.messages.length)).toEqual(sent[i - 1]!.messages)
    expect(sent[i]!.tools).toEqual(sent[0]!.tools)
  }
  const states = (messages: (typeof sent)[number]['messages']) =>
    messages.filter(
      (message) =>
        typeof message.content === 'string' && message.content.startsWith('[current-state]')
    )
  expect(sent.map((request) => states(request.messages).length)).toEqual([1, 1, 2, 2])
  const restored = (await s.repository.load('scheme-1', s.records.conversation.id))!
  expect(restored.messages.filter((message) => message.hostContext)).toHaveLength(2)
  const saved = structuredClone(restored.messages)
  s.invalidate()
  vi.spyOn(s.scene, 'verify').mockReturnValue(false)
  let resumed: ReturnType<typeof projection> | undefined
  await createAgentRunner(s.repository, async (request) => {
    resumed = projection(request)
    return reply('Checked')
  }).run({ ...s.options, records: restored, text: 'Discuss the undone edit.' })
  expect(resumed!.messages.slice(0, sent[3]!.messages.length)).toEqual(sent[3]!.messages)
  expect(states(resumed!.messages).at(-1)?.content).toContain('changed_or_undone')
  expect(states(resumed!.messages).at(-1)?.content).toContain('external')
  expect(restored.messages.slice(0, saved.length)).toEqual(saved)
  expect(s.scene.apply).toHaveBeenCalledOnce()
})

it('saves host facts before sending and replays them after an interrupted request', async () => {
  const s = await setup()
  let original: ReturnType<typeof projection> | undefined
  s.complete.mockImplementationOnce(async (request) => {
    original = projection(request)
    const saved = await s.repository.read<MessageRecord>(s.records.messages.at(-1)!.id)
    expect(saved?.hostContext?.text).toBe(request.messages.at(-1)?.content)
    throw new DOMException('Stopped', 'AbortError')
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ name: 'AbortError' })
  const restored = (await s.repository.load('scheme-1', s.records.conversation.id))!
  await createAgentRunner(s.repository, async (request) => {
    expect(projection(request).messages).toEqual(original!.messages)
    return reply('Resumed')
  }).run({ ...s.options, records: restored, text: undefined })
})

it('rejects an invalid write batch before any side effect and lets the model correct it', async () => {
  const s = await setup([reply('', [call('e', 'apply'), call('q')]), reply('Corrected')])
  await s.runner.run(s.options)
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(s.records.tools.every((t) => t.result?.error?.code === 'not_executed')).toBe(true)
})

it('keeps a successful edit durable when Stop arrives after the edit', async () => {
  const s = await setup([reply('', [call('e', 'apply')])])
  vi.mocked(s.scene.apply).mockImplementationOnce(() => {
    void s.runner.stop()
    return { ok: true, edit: { transactionId: 'tx', postcondition: 'groups' } }
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ name: 'AbortError' })
  expect((await s.repository.load('scheme-1', s.records.conversation.id))?.tools[0]?.state).toBe(
    'succeeded'
  )
  expect(s.complete).toHaveBeenCalledTimes(1)
})

it('records uncertain edits, refuses further writes, and permits read-only inspection', async () => {
  const s = await setup([reply('', [call('e', 'apply')])])
  vi.mocked(s.scene.apply).mockImplementationOnce(() => {
    throw new Error('unknown outcome')
  })
  await expect(s.runner.run(s.options)).rejects.toThrow('unknown outcome')
  expect(unresolvedEdits(s.records)).toHaveLength(1)
  s.complete.mockImplementation(async () =>
    s.complete.mock.calls.length === 2
      ? reply('', [call('q'), call('again', 'apply')])
      : reply('Inspect first')
  )
  await s.runner.run({ ...s.options, text: undefined })
  expect(s.records.tools.at(-1)?.result?.error?.code).toBe('uncertain_edit')
  expect(s.scene.apply).toHaveBeenCalledTimes(1) // failed edit is not retried; safe inspection still runs
})

it('binds a completed response to the scene version that generated its request', async () => {
  const s = await setup()
  s.complete.mockImplementationOnce(async () => {
    s.invalidate()
    return reply('', [call('e', 'apply')])
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ code: 'stale' })
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(s.records.messages.at(-1)?.state).toBe('interrupted')
})

it('persists image Blobs and artifact payloads atomically under stable IDs', async () => {
  const s = await setup([
    reply('', [call('image', 'render', { panels: [{ ref: 'R1', label: 'Roof', kind: 'scene' }] })]),
    reply('Seen'),
  ])
  await s.runner.run(s.options)
  const asset = (await s.repository.read<AssetRecord>(s.records.tools[0]!.assets[0]!.id))!
  expect(await asset.blob.text()).toBe('png')
  expect(s.records.tools[0]?.assets[0]?.id).toBe(asset.id)
  const restored = (await s.repository.load('scheme-1', s.records.conversation.id))!
  expect(restored.artifacts.find((a) => a.kind === 'image')?.asset?.id).toBe(asset.id)
  expect(JSON.stringify(s.records)).not.toContain('base64')
  expect(JSON.stringify(s.complete.mock.calls[1]![0].messages)).toContain(asset.id)
})

it('stops before an edit whose prepared record cannot be saved', async () => {
  const s = await setup([reply('', [call('edit', 'apply')])])
  const original = s.repository.save
  vi.spyOn(s.repository, 'save').mockImplementation(async (conversation, changed = []) => {
    if (changed.some((record) => 'state' in record && record.state === 'prepared'))
      throw new AiError('storage')
    return original(conversation, changed)
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ code: 'storage' })
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(s.records.tools[0]?.state).toBe('interrupted')
  expect((await s.repository.load('scheme-1', s.records.conversation.id))!.tools[0]?.state).toBe(
    'interrupted'
  )
})

it('knows an ordinary Stop after preparation did not execute the edit', async () => {
  const s = await setup([reply('', [call('edit', 'apply')])])
  const original = s.repository.save
  vi.spyOn(s.repository, 'save').mockImplementation(async (conversation, changed = []) => {
    const result = await original(conversation, changed)
    if (changed.some((record) => 'state' in record && record.state === 'prepared'))
      void s.runner.stop()
    return result
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ name: 'AbortError' })
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(unresolvedEdits(s.records)).toHaveLength(0)
  expect((await s.repository.load('scheme-1', s.records.conversation.id))!.tools[0]?.state).toBe(
    'interrupted'
  )
})

it('uses one semantic-summary retry for context overflow and keeps original requirements', async () => {
  const s = await setup([reply('Earlier analysis'), reply('New analysis')])
  s.options.connection.provider = 'openai'
  s.options.connection.reasoning = 'high'
  await s.runner.run(s.options)
  s.invalidate()
  let attempts = 0
  s.complete.mockImplementation(async (request) => {
    if (Object.keys(request.tools).length && attempts++ === 0) throw new AiError('context_overflow')
    if (Object.keys(request.tools).length && attempts === 2)
      return reply('', [call('after-summary')])
    return reply(
      Object.keys(request.tools).length ? 'Final answer' : 'Roof pending; leave garden unchanged.'
    )
  })
  await s.runner.run({ ...s.options, text: 'Do not rename anything.' })
  const requests = await s.repository.requests(s.records.conversation.id)
  expect(requests.filter((r) => r.kind === 'summary')).toHaveLength(1)
  expect(s.records.checkpoint?.text).toContain('Roof pending')
  const final = s.complete.mock.calls.at(-1)![0]
  expect(JSON.stringify(final.messages)).toContain('Organize only the roof.')
  expect(JSON.stringify(final.messages)).toContain('Do not rename anything.')
  expect(requests.find((r) => r.kind === 'summary')?.estimatedTokens).toBeGreaterThan(0)
  expect(requests.find((r) => r.kind === 'summary')).toMatchObject({
    compactionReason: 'context_overflow',
    policy: { inputBudget: 12000 },
  })
  expect(requests.every((r) => r.provider === 'openai' && r.reasoning === 'high')).toBe(true)
  expect(s.complete.mock.calls.every(([request]) => request.connection.reasoning === 'high')).toBe(
    true
  )
  const retried = projection(s.complete.mock.calls.at(-2)![0])
  expect(projection(final).messages.slice(0, retried.messages.length)).toEqual(retried.messages)
  expect(s.records.messages.filter((message) => message.state === 'interrupted')).toHaveLength(1)
  expect(s.records.messages.at(-2)?.hostContext?.checkpointId).toBe(s.records.checkpoint?.id)
})

it('does not compact or retry rejected reasoning parameters', async () => {
  const s = await setup()
  s.options.connection.provider = 'openai'
  s.options.connection.providerOptions = { openai: { reasoningEffort: 'high' } }
  s.complete.mockRejectedValueOnce(new AiError('reasoning_settings'))
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ code: 'reasoning_settings' })
  expect(s.complete).toHaveBeenCalledOnce()
  expect((await s.repository.requests(s.records.conversation.id)).map((r) => r.kind)).toEqual([
    'chat',
  ])
  expect(s.scene.apply).not.toHaveBeenCalled()
})

it('does not compact or retry an output-parameter rejection', async () => {
  const s = await setup()
  s.complete.mockRejectedValueOnce(new AiError('output_limit'))
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ code: 'output_limit' })
  expect(s.complete).toHaveBeenCalledTimes(1)
  expect(s.records.checkpoint).toBeUndefined()
})

it('recovers a committed edit as uncertain if saving its confirmed outcome failed', async () => {
  const s = await setup([reply('', [call('edit', 'apply')])])
  const original = s.repository.save
  vi.spyOn(s.repository, 'save').mockImplementation(async (conversation, changed = []) => {
    if (
      changed.some(
        (record) => 'effect' in record && record.effect === 'edit' && record.state === 'succeeded'
      )
    )
      throw new AiError('storage')
    return original(conversation, changed)
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ code: 'storage' })
  expect(s.scene.apply).toHaveBeenCalledTimes(1)
  const recovered = (await s.repository.load('scheme-1', s.records.conversation.id))!
  expect(unresolvedEdits(recovered)).toHaveLength(1)
  expect(recovered.tools[0]?.state).toBe('uncertain')
  expect(s.complete).toHaveBeenCalledTimes(1)
})

it('records an ordinary Stop during asynchronous edit-target reads as not executed, not uncertain', async () => {
  const s = await setup([reply('', [call('edit', 'apply')])]),
    read = s.repository.read
  let stopped = false
  vi.spyOn(s.repository, 'read').mockImplementation(async (key) => {
    const result = await read(key)
    if (key.startsWith('payload:') && !stopped) {
      stopped = true
      void s.runner.stop()
    }
    return result
  })
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ name: 'AbortError' })
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(unresolvedEdits(s.records)).toHaveLength(0)
  expect(s.records.tools[0]?.state).toBe('interrupted')
})

it('compacts on measured capacity pressure without requiring eight exchanges and records the reason', async () => {
  const s = await setup([reply('Prior finding')])
  s.options.policy = createPolicy(32000, 4000)
  await s.runner.run(s.options)
  let chats = 0
  s.complete.mockImplementation(async (r) => {
    if (!Object.keys(r.tools).length)
      return reply('The prior finding is established. Inspect only the unresolved joint.')
    return { ...(chats++ === 0 ? reply('', [call('one')]) : reply('Done')), inputTokens: 27500 }
  })
  await s.runner.run({ ...s.options, text: 'Continue' })
  const summaries = (await s.repository.requests(s.records.conversation.id)).filter(
    (r) => r.kind === 'summary'
  )
  expect(summaries).toHaveLength(1)
  expect(summaries[0]).toMatchObject({ compactionReason: 'capacity' })
})

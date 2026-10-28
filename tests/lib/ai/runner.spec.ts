import { expect, it, vi } from 'vitest'
import { createPolicy, requestOutputLimit } from '@/lib/ai/context'
import { evaluateScript } from '@/lib/ai/scriptRuntime'
import { createScriptedRunner, workbenchFixture } from '../../fixtures/ai'
import type { RunOptions } from '@/lib/ai/runner'
import { AiError } from '@/lib/ai/types'
import type { ModelRequest } from '@/lib/ai/model'
const call = (id: string, code: string) => ({
  type: 'tool-call' as const,
  toolCallId: id,
  toolName: 'execute_js',
  input: { code },
})
const reply = (text: string, toolCalls: any[] = []) => ({ text, toolCalls })
async function setup(replies: any[]) {
  const f = await workbenchFixture()
  const generate = vi.fn(async (_request: ModelRequest) => replies.shift())
  const runner = createScriptedRunner(f.repository, generate)
  const options: RunOptions = {
    records: f.records,
    scene: f.scene,
    connection: {
      provider: 'compatible',
      apiUrl: 'https://example.test/v1',
      apiKey: 'secret',
      model: 'model',
    },
    policy: createPolicy(16000, 4000),
    system: 'rules',
    text: 'Organize the roof',
    onChange: vi.fn(),
    onProgress: vi.fn(),
    script: async (code, values, invoke) => evaluateScript(code, values, invoke),
  }
  return { ...f, runner, options, generate }
}
it('executes native JS, persists vars and per-edit outcomes, and continues with a canonical transcript', async () => {
  const s = await setup([
    reply('', [
      call('read', 'vars.selected=await api.selection();console.log(vars.selected.length)'),
    ]),
    reply('', [call('write', 'await api.organize([{name:"Roof",items:vars.selected}])')]),
    reply('Done'),
  ])
  await s.runner.run(s.options)
  expect(s.scene.apply).toHaveBeenCalledOnce()
  const restored = (await s.repository.load(s.records.conversation.id))!
  expect(restored.variables.values.selected).toHaveLength(2)
  expect(restored.tools[1]?.edits).toMatchObject([
    { state: 'succeeded', outcome: { transactionId: 'tx' } },
  ])
  expect(restored.conversation.lastRun?.state).toBe('completed')
  expect(restored.messages.map((m) => m.role)).toEqual([
    'user',
    'assistant',
    'assistant',
    'assistant',
  ])
  const sent = JSON.stringify(s.generate.mock.calls[1])
  expect(sent).not.toContain('internalId')
  expect(sent).not.toContain('"instanceId"')
})
it('records completed writes on script failure and lets the model inspect instead of replaying', async () => {
  const s = await setup([
    reply('', [
      call(
        'write',
        'const x=await api.selection();await api.organize([{name:"Roof",items:x}]);vars.bad=1;throw Error("later")'
      ),
    ]),
    reply('Partly completed'),
  ])
  await s.runner.run(s.options)
  expect(s.records.tools[0]).toMatchObject({ state: 'failed', edits: [{ state: 'succeeded' }] })
  expect(s.records.variables.values).toEqual({})
  expect(JSON.stringify(s.generate.mock.calls[1])).toContain('succeeded')
  expect(s.scene.apply).toHaveBeenCalledOnce()
})
it('stores only the final batch image and attaches it once on the next request', async () => {
  const s = await setup([
    reply('', [
      call(
        'image',
        `
    vars.selected=await api.selection();
    await api.render([0,90,180].flatMap(azimuth=>vars.selected.map((item,index)=>({items:[item],label:index+" · "+azimuth,camera:{azimuth}}))),{columns:3});
  `
      ),
    ]),
    reply('Seen'),
  ])
  await s.runner.run(s.options)
  const restored = (await s.repository.load(s.records.conversation.id))!
  const image = restored.tools[0]!.assets[0]!
  expect(restored.tools[0]!.assets).toHaveLength(1)
  expect(s.scene.render).toHaveBeenCalledOnce()
  expect(vi.mocked(s.scene.render).mock.calls[0]![1]).toHaveLength(6)
  expect(s.records.tools).toHaveLength(1)
  expect(await s.repository.read(image.id)).toMatchObject({
    conversationId: restored.conversation.id,
  })
  expect(JSON.stringify(s.generate.mock.calls[1])).toContain('momo-asset:')
  expect(JSON.stringify(s.generate.mock.calls[1]).match(/momo-asset:/g)).toHaveLength(1)
})
it('never executes incomplete generation and restores interrupted execution without rerunning', async () => {
  const s = await setup([reply('partial', [call('x', 'vars.x=1')])])
  s.records.conversation.lastRun = { id: 'old', state: 'running' }
  const tool = {
    id: `tool:${s.records.conversation.id}:old`,
    conversationId: s.records.conversation.id,
    messageId: 'm',
    providerCallId: 'old',
    name: 'execute_js',
    input: { code: 'dangerous' },
    state: 'requested' as const,
    assets: [],
    edits: [{ id: 'edit', schemeId: 'scheme-1', state: 'prepared' as const, input: {} }],
  }
  await s.repository.save(s.records.conversation, [tool])
  const restored = (await s.repository.load(s.records.conversation.id))!
  expect(restored.tools[0]).toMatchObject({ state: 'uncertain', edits: [{ state: 'uncertain' }] })
  expect(s.generate).not.toHaveBeenCalled()
  expect(s.scene.apply).not.toHaveBeenCalled()
})

it('keeps the previous vars and no image attachment when the final execution batch cannot be saved', async () => {
  const s = await setup([
    reply('', [call('read', 'vars.keep={count:1}')]),
    reply('', [
      call(
        'image',
        'vars.keep.count=2;await api.render([{items:await api.selection(),label:"选区"}])'
      ),
    ]),
    reply('Must not continue'),
  ])
  const save = s.repository.save.bind(s.repository)
  vi.spyOn(s.repository, 'save').mockImplementation(async (conversation, records = []) => {
    if (records.some((r) => 'blob' in r)) throw new Error('image batch failed')
    return save(conversation, records)
  })
  await expect(s.runner.run(s.options)).rejects.toThrow('image batch failed')
  expect(s.generate).toHaveBeenCalledTimes(2)
  expect(s.records.variables.values).toEqual({ keep: { count: 1 } })
  expect(s.records.tools[1]?.assets).toEqual([])
  const restored = (await s.repository.load(s.records.conversation.id))!
  expect(restored.variables.values).toEqual({ keep: { count: 1 } })
  expect(restored.tools[1]).toMatchObject({ state: 'interrupted', assets: [] })
})

it('persists automatic image receipts even when JS ignores render results, and restores them for showImage/history', async () => {
  const s = await setup([
    reply('', [
      call(
        'image',
        'await api.render([{items:await api.selection(),label:"入口",camera:{azimuth:270}}])'
      ),
    ]),
    reply('Seen'),
  ])
  vi.mocked(s.scene.render).mockResolvedValue({
    blob: new Blob(['webp'], { type: 'image/webp' }),
    width: 1024,
    height: 1024,
    details: {
      panels: [
        {
          panel: 1,
          label: '入口',
          requested: 2,
          rendered: 1,
          missingCount: 1,
          camera: { azimuth: 270 },
        },
      ],
    },
  })
  await s.runner.run(s.options)
  const restored = (await s.repository.load(s.records.conversation.id))!
  const image = restored.tools[0]!.assets[0]!
  expect(image.mediaType).toBe('image/webp')
  expect((await s.repository.read<import('@/lib/ai/types').AssetRecord>(image.id))!.blob.type).toBe(
    'image/webp'
  )
  expect(image.details).toMatchObject({
    schemeId: 'scheme-1',
    panels: [{ label: '入口', rendered: 1, missingCount: 1 }],
  })
  const sent = s.generate.mock.calls[1]![0]!.messages
  const toolText = sent
    .flatMap((m: any) => (m.role === 'tool' ? m.content : []))
    .find((p: any) => p.type === 'tool-result')!.output.value
  expect(JSON.parse(toolText)).toMatchObject({ images: [image] })
  // Use the host tool directly to inspect readback behavior without executing history.
  const { createWorkbenchTools } = await import('@/lib/ai/tools')
  const tools = createWorkbenchTools(
    restored,
    s.repository,
    s.scene,
    'zh',
    async (code, values, invoke) => evaluateScript(code, values, invoke)
  )
  const output = await tools.execute(
    {
      ...restored.tools[0]!,
      input: {
        code: `await api.showImage(${JSON.stringify(image.id)});return await api.history({id:${JSON.stringify(restored.tools[0]!.id)}})`,
      },
    },
    new AbortController().signal
  )
  expect(output.attachments?.[0]?.details).toEqual(image.details)
  expect(JSON.stringify(output.data)).toContain('missingCount')
  expect(s.scene.render).toHaveBeenCalledOnce()
})

it('reuses measured usage across appended images, subsequent turns and a reloaded runner', async () => {
  const s = await setup([
    {
      ...reply('', [
        call('image', 'await api.render([{items:await api.selection(),label:"选区"}])'),
      ]),
      inputTokens: 1500,
    },
    { ...reply('Seen'), inputTokens: 6000 },
    { ...reply('Next'), inputTokens: 6100 },
  ])
  await s.runner.run(s.options)
  const firstRun = (await s.repository.requests(s.records.conversation.id)).sort(
    (a, b) => a.usageBaseline!.sequence - b.usageBaseline!.sequence
  )
  expect(firstRun[1]!.usageBaseline!.key).toBe(firstRun[0]!.usageBaseline!.key)
  expect(firstRun[1]!.estimatedTokens).toBe(
    1500 + firstRun[1]!.usageBaseline!.local - firstRun[0]!.usageBaseline!.local
  )
  const records = (await s.repository.load(s.records.conversation.id))!
  const runner = createScriptedRunner(s.repository, s.generate)
  await runner.run({ ...s.options, records, text: 'Continue' })
  const all = (await s.repository.requests(records.conversation.id)).sort(
    (a, b) => a.usageBaseline!.sequence - b.usageBaseline!.sequence
  )
  expect(all[2]!.estimatedTokens).toBe(
    6000 + all[2]!.usageBaseline!.local - all[1]!.usageBaseline!.local
  )
  expect(all.every((r) => r.maxOutputTokens === 4000)).toBe(true)
})

it('keeps the last valid baseline when a successful response reports no usable input usage', async () => {
  const s = await setup([
    { ...reply('', [call('a', 'console.log(1)')]), inputTokens: 1500 },
    { ...reply('', [call('b', 'console.log(2)')]), inputTokens: 0 },
    reply('Done'),
  ])
  await s.runner.run(s.options)
  const requests = (await s.repository.requests(s.records.conversation.id)).sort(
    (a, b) => a.usageBaseline!.sequence - b.usageBaseline!.sequence
  )
  expect(requests[2]!.estimatedTokens).toBe(
    1500 + requests[2]!.usageBaseline!.local - requests[0]!.usageBaseline!.local
  )
})

it('preserves receipts for completed renders when later JavaScript fails', async () => {
  const s = await setup([
    reply('', [
      call(
        'image',
        'await api.render([{items:await api.selection(),label:"选区"}]);throw Error("later")'
      ),
    ]),
    reply('Render completed; script failed later'),
  ])
  await s.runner.run(s.options)
  const tool = (await s.repository.load(s.records.conversation.id))!.tools[0]!
  expect(tool.state).toBe('failed')
  expect(tool.assets).toHaveLength(1)
  expect(tool.assets[0]?.details).toMatchObject({ schemeId: 'scheme-1' })
  const { toolModelResult } = await import('@/lib/ai/tools')
  expect(JSON.parse(toolModelResult(tool))).toMatchObject({ ok: false, images: tool.assets })
})

it('ignores failed-request usage when restoring the last measured baseline', async () => {
  const s = await setup([
    { ...reply('First'), inputTokens: 1500 },
    { ...reply('Continue'), inputTokens: 1600 },
  ])
  await s.runner.run(s.options)
  const baseline = (await s.repository.requests(s.records.conversation.id))[0]!
  await s.repository.save(s.records.conversation, [
    {
      ...baseline,
      id: `request:${s.records.conversation.id}:failed`,
      usageBaseline: { ...baseline.usageBaseline!, sequence: 999 },
      error: { code: 'length', name: 'AiError' },
      diagnostics: { usage: { ...baseline.diagnostics.usage!, inputTokens: 100000 } },
    },
  ])
  const records = (await s.repository.load(s.records.conversation.id))!
  await createScriptedRunner(s.repository, s.generate).run({ ...s.options, records, text: 'Next' })
  const next = (await s.repository.requests(records.conversation.id)).find(
    (r) => r.id !== baseline.id && !r.error
  )!
  expect(next.estimatedTokens).toBe(
    1500 + next.usageBaseline!.local - baseline.usageBaseline!.local
  )
})

it.each([128000, 180000, 230400])(
  'compacts at 90% of total capacity, not output reservation (measured input %s)',
  async (inputTokens) => {
    const compact = inputTokens >= 230400
    const s = await setup([
      { ...reply('', [call('read', 'vars.selected=await api.selection()')]), inputTokens },
      ...(compact ? [reply('Saved findings and selected variable.')] : []),
      reply('Done'),
    ])
    s.options.policy = createPolicy(256000, 128000)
    await s.runner.run(s.options)
    const requests = await s.repository.requests(s.records.conversation.id)
    expect(requests.filter((r) => r.kind === 'summary')).toHaveLength(compact ? 1 : 0)
    expect(s.generate).toHaveBeenCalledTimes(compact ? 3 : 2)
    for (const r of requests) {
      expect(r.maxOutputTokens).toBe(requestOutputLimit(s.options.policy, r.estimatedTokens))
      expect(r.policy.maxTokens).toBe(128000)
      expect(r.estimatedTokens + r.maxOutputTokens).toBeLessThanOrEqual(243200)
    }
    if (!compact) {
      const next = requests.find((r) => r.usageBaseline!.sequence > 1)!
      expect(next.estimatedTokens).toBeGreaterThan(inputTokens)
      expect(next.maxOutputTokens).toBeLessThan(128000)
    }
    const last = vi
      .mocked(s.options.onProgress)
      .mock.calls.flatMap(([p]) => (p?.context ? [p.context] : []))
      .at(-1)!
    expect(last).toMatchObject({
      contextWindow: 256000,
      usableContextWindow: 243200,
      autoCompactTokenLimit: 230400,
      configuredMaxOutputTokens: 128000,
    })
    expect(last.estimated).toBeGreaterThan(last.actual)
  }
)

it('fits summary requests as well as chat requests, preserving the configured output cap', async () => {
  const s = await setup([
    { ...reply('', [call('read', 'console.log(1)')]), inputTokens: 230400 },
    reply('Summary of the work.'),
    reply('Done'),
  ])
  s.options.policy = createPolicy(256000, 128000)
  s.options.text = '界'.repeat(170000)
  await s.runner.run(s.options)
  const requests = await s.repository.requests(s.records.conversation.id)
  const summary = requests.find((r) => r.kind === 'summary')!
  expect(summary.estimatedTokens).toBeGreaterThan(128000)
  expect(summary.estimatedTokens).toBeLessThan(243200)
  expect(summary.maxOutputTokens).toBe(243200 - Math.ceil(summary.estimatedTokens))
  expect(summary.maxOutputTokens).toBeLessThan(128000)
  for (const r of requests) {
    const sent = s.generate.mock.calls.find(
      ([sent]) => sent.toolChoice === 'auto' && sent.maxOutputTokens === r.maxOutputTokens
    )
    expect(sent).toBeDefined()
    expect(r.policy.maxTokens).toBe(128000)
  }
})

it.each([false, true])(
  'bounds overflow recovery without replaying completed edits (retry fails: %s)',
  async (failRetry) => {
    const s = await setup([])
    s.generate
      .mockResolvedValueOnce(
        reply('', [
          call(
            'write',
            'vars.selected=await api.selection();await api.organize([{name:"Roof",items:vars.selected}])'
          ),
        ])
      )
      .mockRejectedValueOnce(new AiError('context_overflow'))
      .mockResolvedValueOnce(reply('Roof edit succeeded; do not repeat it.'))
    if (failRetry) s.generate.mockRejectedValueOnce(new AiError('context_overflow'))
    else s.generate.mockResolvedValueOnce(reply('Done'))
    const run = s.runner.run(s.options)
    if (failRetry) await expect(run).rejects.toMatchObject({ code: 'context_overflow' })
    else await run
    expect(s.generate).toHaveBeenCalledTimes(4)
    expect(s.scene.apply).toHaveBeenCalledOnce()
    const restored = (await s.repository.load(s.records.conversation.id))!
    expect(restored.tools).toHaveLength(1)
    expect(restored.tools[0]!.edits).toMatchObject([{ state: 'succeeded' }])
    expect(restored.variables.values.selected).toHaveLength(2)
    expect(restored.checkpoint?.text).toContain('edit succeeded')
    expect(JSON.stringify(s.generate.mock.calls[3])).toContain('Roof edit succeeded')
  }
)

it('keeps summary tools and choice identical but never executes a tool returned by the summarizer', async () => {
  const s = await setup([
    { ...reply('', [call('read', 'vars.kept=1')]), inputTokens: 230400 },
    reply('', [call('unsafe', 'await api.organize([{name:"Wrong",items:await api.selection()}])')]),
  ])
  s.options.policy = createPolicy()
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ code: 'protocol' })
  expect(s.generate).toHaveBeenCalledTimes(2)
  const [chat, summary] = s.generate.mock.calls.map(([r]) => r)
  expect(summary!.tools).toBe(chat!.tools)
  expect(summary!.toolChoice).toBe(chat!.toolChoice)
  expect(summary!.messages.slice(0, chat!.messages.length)).toEqual(chat!.messages)
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(s.scene.snapshot).not.toHaveBeenCalled()
  expect(s.records.variables.values).toEqual({ kept: 1 })
  expect(s.records.tools).toHaveLength(1)
  expect(s.records.checkpoint).toBeUndefined()
})

it('uses a no-image summary only after actual overflow, without changing saved images', async () => {
  const s = await setup([])
  s.options.policy = createPolicy()
  s.generate
    .mockResolvedValueOnce({
      ...reply('', [
        call('image', 'await api.render([{items:await api.selection(),label:"Selected"}])'),
      ]),
      inputTokens: 230400,
    })
    .mockRejectedValueOnce(new AiError('context_overflow'))
    .mockResolvedValueOnce(reply('Observed selection; image is saved.'))
    .mockResolvedValueOnce(reply('Done'))
  await s.runner.run(s.options)
  expect(s.generate).toHaveBeenCalledTimes(4)
  const images = (r: ModelRequest) =>
    r.messages.flatMap((m) =>
      m.role === 'user' && Array.isArray(m.content)
        ? m.content.filter((p) => p.type === 'file')
        : []
    )
  expect(images(s.generate.mock.calls[1]![0]!)).toHaveLength(1)
  expect(images(s.generate.mock.calls[2]![0]!)).toHaveLength(0)
  expect(s.records.tools[0]!.assets).toHaveLength(1)
  expect(s.scene.render).toHaveBeenCalledOnce()
})

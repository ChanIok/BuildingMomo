import { expect, it } from 'vitest'
import { asSchema } from 'ai'
import {
  assembleContext,
  createPolicy,
  estimateToolTokens,
  estimateImageTokens,
  createAiPolicy,
  planSummary,
  projectSource,
  requireUserBudget,
  requestOutputLimit,
  tokens,
} from '@/lib/ai/context'
import { estimateText, toolModelResult, workbenchTools } from '@/lib/ai/tools'
import type { AiConnection } from '@/lib/ai/connection'
import {
  messageText,
  type ConversationRecords,
  type MessageRecord,
  type ToolRecord,
} from '@/lib/ai/types'

const connection = {
  provider: 'compatible' as const,
  apiUrl: 'https://example.test/v1',
  apiKey: 'key',
  model: 'model',
}
const policy = createPolicy(16000, 4000)
function records(): ConversationRecords {
  const messages: MessageRecord[] = [
    {
      id: 'user',
      conversationId: 'c',
      sequence: 0,
      runId: 'r',
      role: 'user',
      content: 'Only organize the roof; never change the garden.',
      state: 'complete',
      toolIds: [],
    },
  ]
  const tools: ToolRecord[] = []
  for (let i = 1; i < 8; i++) {
    messages.push({
      id: `a${i}`,
      conversationId: 'c',
      sequence: i,
      runId: 'r',
      role: 'assistant',
      content: `Part ${i}`,
      state: 'complete',
      toolIds: [`t${i}`],
    })
    tools.push({
      id: `t${i}`,
      conversationId: 'c',
      messageId: `a${i}`,
      providerCallId: `call${i}`,
      name: 'execute_js',
      input: {},
      state: 'succeeded',
      assets: [],
      edits: [],
      result: { ok: true, data: '家'.repeat(2048) },
    })
  }
  return {
    conversation: {
      id: 'c',
      title: 'House',
      createdAt: 0,
      updatedAt: 0,
      nextSequence: 8,
    },
    messages,
    tools,
    variables: { id: 'vars:c', conversationId: 'c', values: {}, references: [] },
  }
}
const assemble = (data: ConversationRecords) =>
  assembleContext({
    records: data,
    connection,
    policy,
    system: 'stable',
    toolTokens: 0,
    scene: {},
    outcomes: [],
  })

it('budgets exported tool declarations rather than Zod internals or local metadata', async () => {
  const declarations = await Promise.all(
    Object.entries(workbenchTools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
    }))
  )
  const cost = await estimateToolTokens(workbenchTools)
  expect(cost).toBe(estimateText(JSON.stringify(declarations)))
  expect(await estimateToolTokens({})).toBe(0)
  const data = records()
  const view = assembleContext({
    records: data,
    connection,
    policy: createPolicy(),
    system: 'stable',
    toolTokens: cost,
    scene: {},
    outcomes: [],
  })
  expect(view.localTokens).toBe(tokens(view.messages) + cost)
})

it('replays frozen host updates and appends only changed verification, including after an interrupted reply', () => {
  const data = records()
  const outcomes = [{ recordId: 'edit-1', state: 'succeeded', verification: 'present' }]
  const input = {
    records: data,
    connection,
    policy,
    system: 'stable',
    toolTokens: 0,
    scene: { revision: 'v1' },
    outcomes,
  }
  const first = assembleContext(input)
  const context = first.hostContext!
  data.messages.push({
    ...data.messages[1]!,
    id: 'attempt',
    sequence: 8,
    toolIds: [],
    state: 'interrupted',
    hostContext: context,
  })
  const same = assembleContext(input)
  expect(same.messages).toEqual(first.messages)
  expect(same.hostContext).toBeUndefined()
  const changed = assembleContext({
    ...input,
    outcomes: [{ ...outcomes[0]!, verification: 'changed_or_undone' }],
  })
  expect(changed.messages.slice(0, same.messages.length)).toEqual(same.messages)
  expect(changed.hostContext?.text).toContain('changed_or_undone')
  expect(changed.hostContext?.text).not.toContain('编辑器')
  // Neither later observation nor the caller's mutable inputs may rewrite the stored snapshot.
  outcomes[0]!.verification = 'uncertain_do_not_replay'
  expect(context.outcomes[0]?.verification).toBe('present')
})

it('gives a new checkpoint a full baseline even when retained host messages contain only deltas', () => {
  const data = records()
  data.messages[7]!.hostContext = {
    scene: { revision: 'v2' },
    outcomes: [],
    text: '[current-state]\n操作核验：[]',
  }
  data.checkpoint = {
    id: 'cp',
    conversationId: 'c',
    text: 'Prior analysis',
    throughSequence: 6,
    requestId: 'summary',
  }
  const view = assembleContext({
    records: data,
    connection,
    policy,
    system: 'stable',
    toolTokens: 0,
    scene: { revision: 'v2' },
    outcomes: [],
  })
  expect(view.hostContext).toMatchObject({ checkpointId: 'cp', scene: { revision: 'v2' } })
  expect(view.messages.at(-1)?.content).toContain('"revision":"v2"')
  data.messages.push({
    ...data.messages[7]!,
    id: 'next',
    sequence: 8,
    toolIds: [],
    hostContext: view.hostContext,
  })
  expect(
    assembleContext({
      records: data,
      connection,
      policy,
      system: 'stable',
      toolTokens: 0,
      scene: { revision: 'v2' },
      outcomes: [],
    }).hostContext
  ).toBeUndefined()
})

it('includes DeepSeek reasoning in chat and summary but never replays it to another endpoint, model or protocol', () => {
  const data = records()
  data.messages[1]!.content = [{ type: 'reasoning', text: 'Saved reasoning' }]
  data.messages[1]!.source = {
    provider: 'compatible',
    endpoint: 'https://example.test/v1/chat/completions',
    model: 'model',
  }
  const deepseek: AiConnection = { ...connection, replayReasoning: true }
  expect(
    messageText(projectSource('a1', data, deepseek, policy.toolOutputBytes), 'reasoning')
  ).toBe('Saved reasoning')
  expect(
    planSummary({
      view: assembleContext({
        records: data,
        connection: deepseek,
        policy,
        system: 'stable',
        toolTokens: 0,
        scene: {},
        outcomes: [],
      }),
      records: data,
      policy,
      toolTokens: 0,
    }).messages.some(
      (m) => m.role === 'assistant' && messageText(m, 'reasoning') === 'Saved reasoning'
    )
  ).toBe(true)
  for (const other of [
    { ...deepseek, model: 'other' },
    { ...deepseek, apiUrl: 'https://other.test/v1' },
    { ...deepseek, replayReasoning: false },
    { ...deepseek, provider: 'openai-chat' } as AiConnection,
  ])
    expect(messageText(projectSource('a1', data, other, policy.toolOutputBytes), 'reasoning')).toBe(
      ''
    )
})

it('preserves SDK continuation metadata only for its original endpoint and model', () => {
  const data = records()
  data.messages[1]!.source = {
    provider: 'compatible',
    endpoint: 'https://example.test/v1/chat/completions',
    model: 'model',
  }
  data.messages[1]!.content = [
    {
      type: 'reasoning',
      text: 'Evidence',
      providerOptions: { momo: { signature: 'reasoning-signature' } },
    },
  ]
  data.tools[0]!.providerOptions = { momo: { thoughtSignature: 'tool-signature' } }
  const current = { ...connection, replayReasoning: true }
  const projected = projectSource('a1', data, current, policy.toolOutputBytes)
  expect(JSON.stringify(projected)).toContain('reasoning-signature')
  expect(JSON.stringify(projected)).toContain('tool-signature')
  for (const other of [
    { ...current, model: 'other' },
    { ...current, apiUrl: 'https://other.test/v1' },
  ]) {
    const switched = JSON.stringify(projectSource('a1', data, other, policy.toolOutputBytes))
    expect(switched).not.toContain('reasoning-signature')
    expect(switched).not.toContain('tool-signature')
  }
})

it('retains original user exclusions through a semantic checkpoint, preserving complete exchanges', () => {
  const data = records(),
    plan = planSummary({ view: assemble(data), records: data, policy, toolTokens: 0 })
  expect(JSON.stringify(plan.messages)).toContain('never change the garden')
  expect(plan.throughSequence).toBe(6)
  data.checkpoint = {
    id: 'cp',
    conversationId: 'c',
    text: 'Roof remains to inspect.',
    throughSequence: 6,
    requestId: 'summary',
  }
  data.messages.push({ ...data.messages[0]!, id: 'continue', sequence: 8, content: 'Continue.' })
  const context = assemble(data)
  expect(JSON.stringify(context.messages)).toContain('never change the garden')
  expect(JSON.stringify(context.messages)).toContain('Continue.')
  expect(context.messages.filter((m) => m.role === 'tool')).toHaveLength(1)
  expect(JSON.stringify(context.messages)).toContain('[task-checkpoint]')
})

it('does not fold oversized original instructions into an unsearchable note', () => {
  const data = records()
  data.messages[0]!.content = '用户限制'.repeat(5000)
  expect(() => requireUserBudget(data, 'rules', policy)).toThrowError(/context_budget/)
})

it('bounds oversized tool projections to recoverable references, without changing saved output', () => {
  const tool = records().tools[0]!
  const original = JSON.stringify(tool.result)
  const projected = JSON.parse(toolModelResult(tool, 200))
  expect(projected.recordId).toBe(tool.id)
  expect(projected.instruction).toContain('api.history')
  expect(JSON.stringify(tool.result)).toBe(original)
})

it('keeps earlier images in place when explicitly reading the same image again', () => {
  const data = records()
  const asset = { id: 'same-image', width: 100, height: 100, bytes: 100 }

  data.tools.forEach((tool) => {
    tool.result = { ok: true }
    tool.assets = []
  })
  data.tools[0]!.assets = [asset]
  const first = assemble(data)
  data.tools[6]!.assets = [asset]
  const view = assemble(data)
  // The reread's own tool result now gains its receipt; earlier history is unchanged.
  const beforeReread = first.messages.findIndex(
    (m) =>
      m.role === 'tool' &&
      m.content.some((p) => p.type === 'tool-result' && p.toolCallId === 'call7')
  )
  expect(view.messages.slice(0, beforeReread)).toEqual(first.messages.slice(0, beforeReread))
  const images = view.messages.flatMap((m) =>
    m.role === 'user' && Array.isArray(m.content) ? m.content.filter((p) => p.type === 'file') : []
  )
  expect(images).toHaveLength(2)
  expect(view.images).toBe(2)
})

it('bounds even oversized errors, while leaving the full diagnostic record intact', () => {
  const tool = records().tools[0]!
  tool.result = { ok: false, error: { code: 'image', message: 'Driver failure '.repeat(2000) } }
  expect(JSON.parse(toolModelResult(tool, 1500))).toMatchObject({
    truncated: true,
    preview: expect.any(String),
    recordId: tool.id,
  })
  expect(tool.result.error?.message.length).toBeGreaterThan(20000)
})

it('uses independent Codex-style usable and compaction limits, regardless of output ceiling', () => {
  for (const maxTokens of [1, 8000, 128000, 256000]) {
    expect(createPolicy(256000, maxTokens)).toMatchObject({
      contextWindow: 256000,
      maxTokens,
      usableContextWindow: 243200,
      autoCompactTokenLimit: 230400,
    })
  }
  expect(createPolicy(272000, 128000)).toMatchObject({
    usableContextWindow: 258400,
    autoCompactTokenLimit: 244800,
  })
  expect(createPolicy(512000, 128000).autoCompactTokenLimit).toBe(460800)
})
it.each([
  [80000, 128000],
  [180000, 63200],
  [220000, 23200],
  [243199, 1],
])(
  'fits the output ceiling into the remaining usable window at %s input tokens',
  (input, expected) => {
    expect(requestOutputLimit(createPolicy(), input)).toBe(expected)
  }
)
it('rejects exhausted input space and invalid independent capacity settings', () => {
  for (const input of [243200, 243201, NaN, Infinity])
    expect(() => requestOutputLimit(createPolicy(), input)).toThrowError(/context_budget/)
  for (const [window, output] of [
    [0, 1],
    [4999, 100],
    [256000, 0],
    [256000, NaN],
  ])
    expect(() => createPolicy(window, output)).toThrowError(/settings/)
})

function addImages(data: ConversationRecords, count: number, bytes: number) {
  data.tools.forEach((t) => {
    t.result = { ok: true }
    t.assets = []
  })
  for (let i = 0; i < count; i++) {
    const asset = { id: 'image' + i, width: 1440, height: 1392, bytes }
    data.tools[i]!.assets = [asset]
  }
}
it('offloads oldest pictures only when the encoded-byte trigger is crossed, retaining image IDs', () => {
  const data = records()
  addImages(data, 4, 3 * 1024 * 1024)
  const p = createPolicy(128000, 8000, {
    imageTriggerBytes: 12 * 1024 * 1024,
    imageTargetBytes: 8 * 1024 * 1024,
  })
  const view = assembleContext({
    records: data,
    connection,
    policy: p,
    system: 'stable',
    toolTokens: 0,
    scene: {},
    outcomes: [],
  })
  expect(view.images).toBe(2)
  expect(JSON.stringify(view.messages)).toContain('因体积预算省略')
  expect(data.tools[0]!.assets).toHaveLength(1)
})
it('holds the removed image prefix between budget cuts and counts rereads as real payloads', () => {
  const data = records()
  addImages(data, 4, 300)
  const p = createPolicy(128000, 8000, { imageTriggerBytes: 1200, imageTargetBytes: 800 })
  const input = {
    records: data,
    connection,
    policy: p,
    system: 'stable',
    toolTokens: 0,
    scene: {},
    outcomes: [],
  }
  const first = assembleContext(input)
  expect(first.images).toBe(2)
  // A reread of an evicted image is attached at the new position without restoring its old occurrence.
  data.tools[4]!.assets = [data.tools[0]!.assets[0]!]
  const reread = assembleContext(input)
  expect(reread.images).toBe(3)
  const beforeReread = first.messages.findIndex(
    (message) =>
      message.role === 'tool' &&
      message.content.some((part) => part.type === 'tool-result' && part.toolCallId === 'call5')
  )
  expect(reread.messages.slice(0, beforeReread)).toEqual(first.messages.slice(0, beforeReread))
  data.tools[5]!.assets = [data.tools[1]!.assets[0]!]
  const nextCut = assembleContext(input)
  expect(nextCut.images).toBe(2)
  const attached = nextCut.messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === 'file' ? [String(part.data).replace('momo-asset:', '')] : []
        )
      : []
  )
  expect(attached).toEqual(['image0', 'image1'])
})
it('gives the summarizer visual evidence, producer code and established findings without clipping normal results', () => {
  const data = records()
  addImages(data, 3, 1000)
  data.messages[1]!.content = 'The wall and its skirt form one editing unit.'
  data.tools[0]!.name = 'execute_js'
  data.tools[0]!.input = { code: 'vars.selected=await api.selection()' }
  const plan = planSummary({
    view: assemble(data),
    records: data,
    policy: createPolicy(),
    toolTokens: 0,
    force: true,
  })
  expect(JSON.stringify(plan.messages)).toContain('The wall and its skirt')
  expect(JSON.stringify(plan.messages)).toContain('vars.selected')
  expect(
    plan.messages.some(
      (m) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'file')
    )
  ).toBe(true)
})

it('calibrates from actual input usage while estimating only new text and images', () => {
  const data = records()
  const input = {
    records: data,
    connection,
    policy: createPolicy(),
    system: 'stable',
    toolTokens: 123,
    scene: {},
    outcomes: [],
  }
  const first = assembleContext(input)
  const anchor = { key: first.usageKey, local: first.localTokens, actual: 1000 }
  expect(assembleContext({ ...input, anchor }).estimatedTokens).toBe(1000)
  // Append a new exchange, rather than changing the old request prefix.
  data.messages.push({
    ...data.messages[7]!,
    id: 'new',
    sequence: 8,
    toolIds: ['new-tool'],
    hostContext: first.hostContext,
  })
  data.tools.push({
    ...data.tools[0]!,
    id: 'new-tool',
    messageId: 'new',
    providerCallId: 'new-call',
    result: { ok: true },
    assets: [{ id: 'new-image', width: 2700, height: 1864, bytes: 1000 }],
  })
  const next = assembleContext({ ...input, anchor })
  expect(next.usageKey).toBe(first.usageKey)
  expect(next.images).toBe(1)
  expect(next.estimatedTokens).toBe(1000 + next.localTokens - first.localTokens)
  expect(next.estimatedTokens).toBeLessThan(next.localTokens)
  data.messages.push({
    ...data.messages[0]!,
    id: 'next-user',
    sequence: 9,
    content: 'Look from the other side',
  })
  const turn = assembleContext({ ...input, anchor })
  expect(turn.estimatedTokens).toBe(1000 + turn.localTokens - first.localTokens)
})

it('resets measured usage when images are replaced or the request definition changes', () => {
  const data = records()
  addImages(data, 3, 300)
  const input = {
    records: data,
    connection,
    policy: createPolicy(128000, 8000, {
      imageTriggerBytes: 1200,
      imageTargetBytes: 800,
    }),
    system: 'stable',
    toolTokens: 0,
    scene: {},
    outcomes: [],
  }
  const first = assembleContext(input)
  const anchor = { key: first.usageKey, local: first.localTokens, actual: 100 }
  data.tools[3]!.assets = [{ id: 'cross-trigger', width: 100, height: 100, bytes: 300 }]
  const cut = assembleContext({ ...input, anchor })
  expect(cut.usageKey).not.toBe(first.usageKey)
  expect(cut.estimatedTokens).toBe(cut.localTokens)
  const cutAnchor = { key: cut.usageKey, local: cut.localTokens, actual: 200 }
  data.tools[4]!.assets = [{ id: 'after-cut', width: 100, height: 100, bytes: 300 }]
  expect(assembleContext({ ...input, anchor: cutAnchor }).usageKey).toBe(cut.usageKey)
  for (const change of [
    { system: 'new rules' },
    { toolTokens: 1 },
    { connection: { ...connection, model: 'other' } },
    { connection: { ...connection, replayReasoning: true } },
    { connection: { ...connection, reasoning: 'high' as const } },
  ]) {
    const changed = assembleContext({ ...input, ...change, anchor: cutAnchor })
    expect(changed.estimatedTokens).toBe(changed.localTokens)
  }
  data.checkpoint = {
    id: 'new-checkpoint',
    conversationId: 'c',
    throughSequence: 3,
    requestId: 'summary',
    text: 'Prior findings',
  }
  const compacted = assembleContext({ ...input, anchor: cutAnchor })
  expect(compacted.estimatedTokens).toBe(compacted.localTokens)
})

it('keeps full image receipts in tool output and uses only a short omitted-image reference', () => {
  const data = records()
  const tool = data.tools[0]!
  tool.result = { ok: true, data: 'x'.repeat(5000) }
  tool.assets = [
    {
      id: 'oversized-image',
      width: 2700,
      height: 1864,
      bytes: 3000,
      details: {
        panels: [{ panel: 1, label: '入口', requested: 200, rendered: 199, missingCount: 1 }],
      },
    },
  ]
  expect(JSON.parse(toolModelResult(tool, 100))).toMatchObject({
    truncated: true,
    images: tool.assets,
  })
  const view = assembleContext({
    records: data,
    connection,
    policy: createPolicy(128000, 8000, {
      imageTriggerBytes: 1200,
      imageTargetBytes: 800,
    }),
    system: 'stable',
    toolTokens: 0,
    scene: {},
    outcomes: [],
  })
  expect(view.images).toBe(0)
  const placeholder = view.messages
    .flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? m.content : []))
    .find((p) => p.type === 'text' && p.text.includes('体积预算省略'))
  expect(placeholder).toMatchObject({
    type: 'text',
    text: expect.stringContaining('api.showImage("oversized-image")'),
  })
  expect(JSON.stringify(placeholder)).not.toContain('入口')
  expect(tool.assets).toHaveLength(1)
})

it('uses 32/15 MiB hysteresis and preserves the replacement prefix between batch cuts', () => {
  const data = records()
  data.messages = [data.messages[0]!]
  data.tools = []
  const p = createPolicy()
  expect(p.imageTriggerBytes).toBe(32 * 1024 * 1024)
  expect(p.imageTargetBytes).toBe(15 * 1024 * 1024)
  const input = {
    records: data,
    connection,
    policy: p,
    system: 'stable',
    toolTokens: 0,
    scene: {},
    outcomes: [],
  }
  let stableKey = ''
  for (let i = 1; i <= 17; i++) {
    const id = `batch-${i}`
    data.messages.push({
      id: `a${i}`,
      conversationId: 'c',
      sequence: i,
      runId: 'r',
      role: 'assistant',
      content: 'Rendered',
      state: 'complete',
      toolIds: [id],
    })
    data.tools.push({
      id,
      conversationId: 'c',
      messageId: `a${i}`,
      providerCallId: id,
      name: 'execute_js',
      input: {},
      state: 'succeeded',
      result: { ok: true },
      edits: [],
      assets: [{ id: `image-${i}`, width: 1024, height: 1024, bytes: (9 * 1024 * 1024) / 4 }],
    })
    const view = assembleContext(input)
    if (i <= 10) expect(view.images).toBe(i)
    if (i === 11) {
      expect(view.images).toBe(5)
      stableKey = view.usageKey
    }
    if (i >= 12 && i <= 16) {
      expect(view.images).toBe(i - 6)
      expect(view.usageKey).toBe(stableKey)
    }
    if (i === 17) {
      expect(view.images).toBe(5)
      expect(view.usageKey).not.toBe(stableKey)
    }
  }
})

it('derives summaries from the exact shared prefix, including prior checkpoints, image cuts and complete calls', () => {
  const data = records()
  addImages(data, 7, 300)
  data.checkpoint = {
    id: 'cp',
    conversationId: 'c',
    text: 'Earlier findings',
    throughSequence: 2,
    requestId: 'old',
  }
  data.messages.push({
    ...data.messages[0]!,
    id: 'later-user',
    sequence: 8,
    content: 'Keep the entrance too.',
  })
  const p = createPolicy(16000, 4000, { imageTriggerBytes: 1200, imageTargetBytes: 800 })
  const view = assembleContext({
    records: data,
    connection,
    policy: p,
    system: 'same-system',
    toolTokens: 123,
    scene: {},
    outcomes: [],
  })
  const plan = planSummary({ view, records: data, policy: p, toolTokens: 123 })
  const boundary = view.exchanges.find((e) => e.sequence === plan.throughSequence)!
  expect(plan.messages.slice(0, -1)).toEqual(view.messages.slice(0, boundary.end))
  expect(plan.messages[0]).toEqual({ role: 'system', content: 'same-system' })
  expect(JSON.stringify(plan.messages)).toContain('Earlier findings')
  expect(plan.messages.at(-1)?.role).toBe('user')
  expect(JSON.stringify(plan.messages)).toContain('体积预算省略')
  // Every summarized tool result has its complete assistant call in the same prefix.
  const calls = plan.messages.flatMap((m) =>
    m.role === 'assistant' && Array.isArray(m.content)
      ? m.content.filter((p) => p.type === 'tool-call').map((p) => p.toolCallId)
      : []
  )
  const results = plan.messages.flatMap((m) =>
    m.role === 'tool' ? m.content.map((p) => p.toolCallId) : []
  )
  expect(results).toEqual(calls)
})
it('uses dimensional fallback tokens and real MIME without exposing encoded image bytes', () => {
  expect(estimateImageTokens(2700, 3328)).toBe(8840)
  const data = records()
  addImages(data, 1, 1000)
  data.tools[0]!.assets[0] = {
    id: 'webp',
    width: 2000,
    height: 2000,
    bytes: 1000,
    mediaType: 'image/webp',
  }
  const view = assemble(data)
  const file = view.messages
    .flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? m.content : []))
    .find((p) => p.type === 'file')!
  expect(file).toMatchObject({ mediaType: 'image/webp', data: 'momo-asset:webp' })
  const withImage = tokens([{ role: 'user', content: [file] }], 0, data)
  expect(withImage).toBe(12 + 3969)
})
it('caps the default batch target at 15 MiB and honors smaller configured budgets', () => {
  expect(
    createAiPolicy({ contextWindow: 256000, maxTokens: 128000, imageBudgetMiB: 32 })
      .imageTargetBytes
  ).toBe(15 * 1024 * 1024)
  const smaller = createAiPolicy({ contextWindow: 256000, maxTokens: 128000, imageBudgetMiB: 12 })
  expect(smaller.imageTargetBytes).toBeLessThan(smaller.imageTriggerBytes)
})

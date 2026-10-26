import { expect, it } from 'vitest'
import { asSchema } from 'ai'
import {
  assembleContext,
  createPolicy,
  estimateToolTokens,
  planSummary,
  projectSource,
  requireUserBudget,
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
      name: 'inspect',
      input: {},
      effect: 'read',
      state: 'succeeded',
      assets: [],
      result: { ok: true, data: '家'.repeat(2048) },
    })
  }
  return {
    conversation: {
      id: 'c',
      schemeId: 's',
      title: 'House',
      createdAt: 0,
      updatedAt: 0,
      nextSequence: 8,
    },
    messages,
    tools,
    artifacts: [],
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
    planSummary(data, policy, false, true, deepseek).messages.some(
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
    plan = planSummary(data, policy)
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
  expect(projected.instruction).toContain('inspect')
  expect(JSON.stringify(tool.result)).toBe(original)
})

it('keeps earlier images in place when explicitly reading the same image again', () => {
  const data = records()
  const asset = { id: 'same-image', width: 100, height: 100, bytes: 100 }
  data.artifacts.push({
    id: 'artifact:c:R1',
    ref: 'R1',
    conversationId: 'c',
    schemeId: 's',
    kind: 'image',
    label: 'Same image',
    revision: 'v1',
    asset,
  })
  data.tools.forEach((tool) => {
    tool.result = { ok: true }
    tool.assets = []
  })
  data.tools[0]!.assets = [asset]
  const first = assemble(data)
  data.tools[6]!.assets = [asset]
  const view = assemble(data)
  // Only the explicit reread adds an attachment; the entire preceding transcript stays byte-for-byte stable.
  expect(view.messages.slice(0, first.messages.length - 1)).toEqual(first.messages.slice(0, -1))
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

it('uses model capacity instead of a hardcoded 24k threshold', () => {
  const policy = createPolicy()
  expect(policy.threshold).toBeLessThanOrEqual(policy.inputBudget)
  expect(createPolicy(policy.contextWindow * 2, policy.maxTokens).threshold).toBeGreaterThan(
    policy.threshold
  )
})
function addImages(data: ConversationRecords, count: number, bytes: number) {
  data.tools.forEach((t) => {
    t.result = { ok: true }
    t.assets = []
  })
  for (let i = 0; i < count; i++) {
    const asset = { id: 'image' + i, width: 1440, height: 1392, bytes }
    data.tools[i]!.assets = [asset]
    data.artifacts.push({
      id: 'artifact' + i,
      ref: 'R' + (i + 1),
      conversationId: 'c',
      schemeId: 's',
      kind: 'image',
      label: 'Image',
      revision: 'unchanged',
      asset,
    })
  }
}
it('offloads oldest pictures only when the encoded-byte trigger is crossed, retaining inspect references', () => {
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
  expect(JSON.stringify(view.messages)).toContain('因请求图片字节预算省略')
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
  const beforeReread =
    first.messages.findIndex(
      (message) =>
        message.role === 'tool' &&
        message.content.some((part) => part.type === 'tool-result' && part.toolCallId === 'call5')
    ) + 1
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
  data.tools[0]!.name = 'compute'
  data.tools[0]!.input = { code: "publish.set('Wall',input.items)" }
  const plan = planSummary(data, createPolicy(), true)
  expect(JSON.stringify(plan.messages)).toContain('The wall and its skirt')
  expect(JSON.stringify(plan.messages)).toContain('publish.set')
  expect(
    plan.messages.some(
      (m) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'file')
    )
  ).toBe(true)
})

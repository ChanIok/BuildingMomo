import { streamText, type ToolCallPart } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { createAgentRunner } from '@/lib/ai/runner'
import type { ModelRequest } from '@/lib/ai/model'
import 'fake-indexeddb/auto'
import { createStore } from 'idb-keyval'
import { vi } from 'vitest'
import { createConversationRepository } from '@/lib/ai/repository'
import { AiError, type ConversationRecords, type EditorHost } from '@/lib/ai/types'
import { analysisSnapshot } from './sceneAnalysis'

export async function workbenchFixture() {
  const repository = createConversationRepository(
    createStore(`workbench-${crypto.randomUUID()}`, 'records')
  )
  const conversation = await repository.create('House')
  const records: ConversationRecords = {
    conversation,
    messages: [],
    tools: [],
    variables: {
      id: `vars:${conversation.id}`,
      conversationId: conversation.id,
      values: {},
      references: [],
    },
  }
  let version = 'v1'
  const scene: EditorHost = {
    context: () => ({ schemeId: 'scheme-1', title: 'House' }),
    schemes: () => [{ id: 'scheme-1', name: 'House' }],
    revision: () => version,
    selection: vi.fn(() => ['a', 'b']),
    structure: () => ({ groups: [], collections: [] }),
    snapshot: vi.fn((_id, members) => {
      const s = analysisSnapshot()
      members ??= s.items.map((i) => i.id)
      if (members.some((id) => !s.items.some((i) => i.id === id))) throw new AiError('scope')
      return { ...s, id: version, items: s.items.filter((i) => members.includes(i.id)) }
    }),
    render: vi.fn(async () => ({
      blob: new Blob(['png'], { type: 'image/png' }),
      width: 100,
      height: 100,
      details: {},
    })),
    apply: vi.fn(() => {
      version = 'v2'
      return {
        ok: true,
        data: { regroupedItemCount: 2, groups: [{ groupId: 1 }], collections: [] },
        edit: { schemeId: 'scheme-1', transactionId: 'tx', postcondition: 'groups' },
      }
    }),
    verify: () => true,
  }
  return {
    repository,
    records,
    scene,
    invalidate: () => {
      version = 'external'
    },
  }
}
export interface ScriptedReply {
  text: string
  toolCalls: ToolCallPart[]
  reasoning?: string
  inputTokens?: number
}

/** Real SDK generation with a scripted provider; runner tests don't mock SDK results. */
export function createScriptedRunner(
  repository: ReturnType<typeof createConversationRepository>,
  script: (request: ModelRequest) => Promise<ScriptedReply>
) {
  return createAgentRunner(repository, (request) =>
    streamText({
      model: new MockLanguageModelV4({
        doStream: async () => {
          const reply = await script(request)
          return {
            stream: simulateReadableStream({
              initialDelayInMs: null,
              chunkDelayInMs: null,
              chunks: [
                ...(reply.reasoning
                  ? [
                      { type: 'reasoning-start' as const, id: 'reasoning' },
                      { type: 'reasoning-delta' as const, id: 'reasoning', delta: reply.reasoning },
                      { type: 'reasoning-end' as const, id: 'reasoning' },
                    ]
                  : []),
                { type: 'text-start', id: 'text' },
                { type: 'text-delta', id: 'text', delta: reply.text },
                { type: 'text-end', id: 'text' },
                ...reply.toolCalls.map((call) => ({ ...call, input: JSON.stringify(call.input) })),
                {
                  type: 'finish',
                  finishReason: {
                    unified: reply.toolCalls.length ? 'tool-calls' : 'stop',
                    raw: reply.toolCalls.length ? 'tool_calls' : 'stop',
                  },
                  usage: {
                    inputTokens: {
                      total: reply.inputTokens ?? 100,
                      noCache: reply.inputTokens ?? 100,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: { total: 10, text: 10, reasoning: 0 },
                  },
                },
              ],
            }),
          }
        },
      }),
      messages: request.messages,
      tools: request.tools,
      toolChoice: request.toolChoice,
      maxOutputTokens: request.maxOutputTokens,
      reasoning: request.connection.reasoning,
      abortSignal: request.abortSignal,
      maxRetries: 0,
      allowSystemInMessages: true,
      experimental_download: async (requests) =>
        Promise.all(
          requests.map(async ({ url }) => ({
            data: new Uint8Array(await (await request.resolveAsset(url.pathname))!.arrayBuffer()),
            mediaType: 'image/png',
          }))
        ),
    })
  )
}

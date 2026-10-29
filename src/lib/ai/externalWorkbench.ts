import { z } from 'zod'
import { executeInput } from './toolInputs'
import { executeWorkbenchTool, unresolvedEdits } from './execution'
import { acquireAiExecution } from './executionGate'
import type { ConversationRepository } from './repository'
import type { ScriptExecutor } from './scriptClient'
import {
  AiError,
  assertNotAborted,
  failure,
  type ConversationRecords,
  type EditorHost,
  type ToolRecord,
} from './types'

export const externalExecuteInput = executeInput.extend({
  contextId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Omit only on the first call of a new task. Reuse the returned contextId on every subsequent call.'
    ),
})

export function createExternalWorkbench(options: {
  repository: ConversationRepository
  host: EditorHost
  script?: ScriptExecutor
  onChange?: (records: ConversationRecords) => void
}) {
  const { repository, host } = options
  let active: { controller: AbortController; done: Promise<ConversationRecords> } | null = null
  let current: ConversationRecords | null = null
  const publish = (records: ConversationRecords) => {
    current = records
    options.onChange?.(records)
  }
  async function createContext() {
    const context = host.context()
    const conversation = await repository.create(context.title ?? 'BuildingMomo', {
      schemeId: context.schemeId,
    })
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
    records.conversation = await repository.save(conversation, [records.variables])
    publish(records)
    return records
  }
  async function load(contextId: string) {
    // Loading a live record from storage would run crash recovery on a healthy task.
    const records =
      active && current?.conversation.id === contextId ? current : await repository.load(contextId)
    if (!records?.conversation.external)
      throw new AiError(
        'scope',
        'Unknown external contextId; create a new context by omitting contextId.'
      )
    return records
  }
  async function execute(
    input: z.infer<typeof externalExecuteInput>,
    signal: AbortSignal,
    language: string
  ) {
    assertNotAborted(signal)
    const records = input.contextId ? await load(input.contextId) : await createContext()
    assertNotAborted(signal)
    const runId = crypto.randomUUID()
    const sequence = records.conversation.nextSequence++
    const tool: ToolRecord = {
      id: `tool:${records.conversation.id}:${String(sequence).padStart(12, '0')}:000000`,
      conversationId: records.conversation.id,
      messageId: '',
      providerCallId: runId,
      name: 'execute_js',
      input: { code: input.code },
      state: 'requested',
      assets: [],
      edits: [],
    }
    records.tools.push(tool)
    records.conversation.lastRun = { id: runId, state: 'running' }
    records.conversation = await repository.save(records.conversation, [tool])
    publish(records)
    try {
      assertNotAborted(signal)
      await executeWorkbenchTool({
        records,
        repository,
        host,
        tool,
        signal,
        language,
        script: options.script,
        defaultSchemeId: records.conversation.external!.schemeId,
        onChange: () => publish(records),
      })
      records.conversation.lastRun = {
        id: runId,
        state: tool.result?.ok ? 'completed' : signal.aborted ? 'interrupted' : 'failed',
      }
    } catch (error) {
      if (tool.state === 'requested') {
        tool.state = 'interrupted'
        tool.result = {
          ok: false,
          error: {
            code: failure(error).code,
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
      records.conversation.lastRun = {
        id: runId,
        state: signal.aborted ? 'interrupted' : 'failed',
        error: failure(error),
      }
    }
    records.conversation = await repository.save(records.conversation, [tool])
    publish(records)
    return records
  }
  return {
    async createContext() {
      if (active) throw new AiError('busy')
      return createContext()
    },
    load,
    async run(value: unknown, signal: AbortSignal, language = 'zh') {
      const input = externalExecuteInput.parse(value)
      const release = acquireAiExecution()
      const controller = new AbortController()
      try {
        const done = execute(input, AbortSignal.any([signal, controller.signal]), language)
        active = { controller, done }
        return await done
      } finally {
        active = null
        release()
      }
    },
    async stop() {
      const task = active
      task?.controller.abort()
      await task?.done.catch(() => {})
    },
    async remove(contextId: string) {
      if (active) throw new AiError('busy')
      const records = await load(contextId)
      await repository.remove(records.conversation)
      if (current?.conversation.id === contextId) current = null
    },
    async acknowledge(contextId: string, text: string) {
      if (active) throw new AiError('busy')
      const records = await load(contextId)
      const next = await repository.append(records.conversation, {
        role: 'user',
        content: text,
        state: 'complete',
        runId: crypto.randomUUID(),
        toolIds: [],
        acknowledges: unresolvedEdits(records).map((edit) => edit.id),
      })
      records.conversation = next.conversation
      records.messages.push(next.message)
      publish(records)
    },
  }
}

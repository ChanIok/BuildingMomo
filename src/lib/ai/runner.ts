import type { ModelMessage, CallWarning } from 'ai'
import { endpointIdentity, type AiConnection } from './connection'
import {
  assembleContext,
  estimateToolTokens,
  planSummary,
  requireUserBudget,
  requestOutputLimit,
  type ContextPolicy,
  type ContextView,
  type UsageAnchor,
} from './context'
import { effectiveReasoning } from './reasoning'
import { streamModel, modelFailure } from './model'
import type { ConversationRepository } from './repository'
import { createWorkbenchTools, workbenchTools, describeVariables } from './tools'
import { formatInputError } from './toolSchema'
import type { ScriptExecutor } from './scriptClient'
import {
  AiError,
  assertNotAborted,
  failure,
  type AssetRecord,
  type RequestDiagnostics,
  type ContextCheckpoint,
  type ConversationRecords,
  type MessageRecord,
  type RequestRecord,
  type EditorHost,
  type ToolOutput,
  type ToolRecord,
} from './types'

export interface RunProgress {
  phase: 'preparing' | 'requesting' | 'summarizing' | 'tools'
  startedAt: number
  toolId?: string
  diagnostics?: RequestDiagnostics
  context?: {
    estimated: number
    /** Last successful chat request input; estimated also includes subsequently added content. */
    actual?: number
    contextWindow: number
    usableContextWindow: number
    autoCompactTokenLimit: number
    configuredMaxOutputTokens: number
    requestMaxOutputTokens?: number
    images: number
    compacted: boolean
  }
}
export interface RunOptions {
  records: ConversationRecords
  connection: AiConnection
  policy: ContextPolicy
  system: string
  scene: EditorHost
  context?: ReturnType<EditorHost['context']>
  language?: string
  script?: ScriptExecutor
  text?: string
  onChange: (records: ConversationRecords) => void
  onProgress: (progress: RunProgress | null) => void
}

function inputError(error: unknown, name: string): string {
  if (error instanceof Error && error.cause instanceof Error) return inputError(error.cause, name)
  const definition = Object.hasOwn(workbenchTools, name)
    ? workbenchTools[name as keyof typeof workbenchTools]
    : undefined
  return definition
    ? formatInputError(definition.inputSchema, error, name)
    : error instanceof Error
      ? error.message
      : 'Invalid tool input'
}

export function unresolvedEdits(records: ConversationRecords) {
  const acknowledged = new Set(records.messages.flatMap((message) => message.acknowledges ?? []))
  return records.tools.flatMap((tool) =>
    tool.edits.filter((edit) => edit.state === 'uncertain' && !acknowledged.has(edit.id))
  )
}

export function createAgentRunner(
  repository: ConversationRepository,
  generate: typeof streamModel = streamModel
) {
  let active: { controller: AbortController; done: Promise<void> } | null = null

  async function execute(options: RunOptions, signal: AbortSignal) {
    const { records, scene, connection, policy, onChange, onProgress } = options
    const runId = crypto.randomUUID()
    const runContext = options.context ?? scene.context()
    const workbench = createWorkbenchTools(
      records,
      repository,
      scene,
      options.language ?? 'zh',
      options.script,
      runContext.schemeId
    )
    const definitions = workbench.definitions
    const toolTokens = await estimateToolTokens(definitions)
    let progress: RunProgress = { phase: 'preparing', startedAt: Date.now() }
    let draft: MessageRecord | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let streamingSave = Promise.resolve()
    let storageFailure: unknown
    // Reuse the last successful measured request across turns and page reloads.
    // Projection keys reject it if model, prompts, compaction or image cuts changed.
    const measured = (await repository.requests(records.conversation.id))
      .filter(
        (r) =>
          r.kind === 'chat' &&
          r.endedAt &&
          !r.error &&
          r.usageBaseline &&
          Number.isFinite(r.diagnostics.usage?.inputTokens) &&
          r.diagnostics.usage!.inputTokens! > 0
      )
      .sort(
        (a, b) => b.usageBaseline!.sequence - a.usageBaseline!.sequence || b.startedAt - a.startedAt
      )
      .at(0)
    let anchor: UsageAnchor | undefined = measured
      ? { ...measured.usageBaseline!, actual: measured.diagnostics.usage!.inputTokens! }
      : undefined
    const warnings = new Map<string, CallWarning>()
    const publish = () => onChange(records)
    const report = (patch: Partial<RunProgress>) => {
      progress = { ...progress, ...patch }
      onProgress(progress)
    }
    const assertCurrent = () => {
      assertNotAborted(signal)
      if (storageFailure) throw storageFailure
    }
    const save = async (changed: Parameters<ConversationRepository['save']>[1] = []) => {
      records.conversation = await repository.save(records.conversation, changed)
      publish()
    }
    async function flushDraft() {
      clearTimeout(timer)
      timer = undefined
      await streamingSave
      if (storageFailure) throw storageFailure
    }
    function scheduleDraft() {
      publish()
      if (timer || !draft) return
      timer = setTimeout(() => {
        timer = undefined
        const copy = structuredClone(draft!)
        streamingSave = streamingSave
          .then(async () => {
            await save([copy])
          })
          .catch((error) => {
            storageFailure = error
            active?.controller.abort()
          })
      }, 1500)
    }
    async function append(
      role: MessageRecord['role'],
      text: string,
      state: MessageRecord['state'],
      hostContext?: MessageRecord['hostContext']
    ) {
      await flushDraft()
      const next = await repository.append(records.conversation, {
        role,
        content: text,
        state,
        runId,
        toolIds: [],
        ...(hostContext ? { hostContext } : {}),
        ...(role === 'assistant'
          ? {
              source: {
                provider: connection.provider,
                endpoint: endpointIdentity(connection),
                model: connection.model,
              },
            }
          : {}),
      })
      records.conversation = next.conversation
      records.messages.push(next.message)
      publish()
      return next.message
    }

    async function request(
      kind: RequestRecord['kind'],
      messages: ModelMessage[],
      estimatedTokens: number,
      view?: ContextView,
      compactionReason?: RequestRecord['compactionReason']
    ) {
      const maxOutputTokens = requestOutputLimit(policy, estimatedTokens)
      const requestId = `request:${records.conversation.id}:${Date.now()}:${crypto.randomUUID()}`
      const record: RequestRecord = {
        id: requestId,
        conversationId: records.conversation.id,
        runId,
        kind,
        startedAt: Date.now(),
        endpoint: endpointIdentity(connection),
        model: connection.model,
        provider: connection.provider,
        reasoning: effectiveReasoning(connection),
        maxOutputTokens,
        diagnostics: {},
        estimatedTokens,
        ...(view
          ? {
              usageBaseline: {
                key: view.usageKey,
                local: view.localTokens,
                sequence: draft!.sequence,
              },
            }
          : {}),
        policy: { ...policy },
        compactionReason,
      }
      await save([record])
      assertCurrent()
      report({
        phase: kind === 'summary' ? 'summarizing' : 'requesting',
        startedAt: record.startedAt,
        diagnostics: { phase: 'connecting' },
        toolId: undefined,
        context: {
          estimated: estimatedTokens,
          contextWindow: policy.contextWindow,
          usableContextWindow: policy.usableContextWindow,
          autoCompactTokenLimit: policy.autoCompactTokenLimit,
          configuredMaxOutputTokens: policy.maxTokens,
          requestMaxOutputTokens: maxOutputTokens,
          images:
            view?.images ??
            messages.reduce(
              (sum, message) =>
                sum +
                (message.role === 'user' && Array.isArray(message.content)
                  ? message.content.filter((part) => part.type === 'file').length
                  : 0),
              0
            ),
          compacted: view?.compacted ?? Boolean(records.checkpoint),
        },
      })
      const diagnostics = (patch: RequestDiagnostics) => {
        for (const warning of patch.warnings ?? []) warnings.set(JSON.stringify(warning), warning)
        if (warnings.size && records.conversation.lastRun)
          records.conversation.lastRun.warnings = [...warnings.values()]
        record.diagnostics = { ...record.diagnostics, ...patch }
        report({ diagnostics: record.diagnostics })
      }
      try {
        const generation = generate({
          connection,
          messages,
          tools: definitions,
          toolChoice: 'auto',
          maxOutputTokens,
          abortSignal: signal,
          resolveAsset: async (id) => {
            const asset = await repository.read<AssetRecord>(id)
            return asset?.conversationId === records.conversation.id ? asset.blob : undefined
          },
          onRequest: async (body) => {
            assertCurrent()
            record.body = body
            await save([record])
            assertCurrent()
          },
          onResponse: (httpStatus) => diagnostics({ httpStatus, phase: 'waiting' }),
        })
        for await (const part of generation.stream) {
          assertCurrent()
          if (part.type === 'start-step') diagnostics({ warnings: part.warnings })
          if (
            part.type === 'tool-input-start' ||
            part.type === 'tool-input-delta' ||
            part.type === 'tool-input-end'
          )
            (record.toolInput ??= []).push(part)
          if (part.type === 'error') throw part.error
          if (part.type === 'abort') {
            assertNotAborted(signal)
            throw new AiError('timeout')
          }
          if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
            const phase = part.type === 'text-delta' ? 'text' : 'reasoning'
            if (
              record.diagnostics.phase !== phase ||
              record.diagnostics.firstOutputMs === undefined
            )
              diagnostics({
                phase,
                firstOutputMs: record.diagnostics.firstOutputMs ?? Date.now() - record.startedAt,
              })
            if (kind === 'chat' && draft) {
              if (typeof draft.content === 'string')
                draft.content = draft.content ? [{ type: 'text', text: draft.content }] : []
              const last = draft.content.at(-1)
              if ((last?.type === 'text' || last?.type === 'reasoning') && last.type === phase)
                last.text += part.text
              else draft.content.push({ type: phase, text: part.text })
              scheduleDraft()
            }
          } else if (
            (part.type === 'tool-input-start' || part.type === 'tool-input-delta') &&
            record.diagnostics.phase !== 'tool_arguments'
          )
            diagnostics({ phase: 'tool_arguments' })
        }
        assertCurrent()
        const response = await generation.finalStep
        diagnostics({
          finishReason: response.finishReason,
          usage: response.usage,
          warnings: response.warnings,
          toolCalls: response.toolCalls.map((call) => ({
            type: 'tool-call',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          })),
        })
        if (response.finishReason === 'length') throw new AiError('length')
        if (response.finishReason === 'content-filter') throw new AiError('content_filter')
        if (response.finishReason !== 'stop' && response.finishReason !== 'tool-calls')
          throw new AiError('truncated')
        if ((response.finishReason === 'tool-calls') !== Boolean(response.toolCalls.length))
          throw new AiError('protocol')
        if (!response.text && !response.toolCalls.length) throw new AiError('empty')
        if (
          new Set(response.toolCalls.map((call) => call.toolCallId)).size !==
          response.toolCalls.length
        )
          throw new AiError('protocol')
        if (kind === 'summary' && (response.toolCalls.length || !response.text.trim()))
          throw new AiError('protocol')
        record.endedAt = Date.now()
        await flushDraft()
        await save([record])
        if (
          view &&
          Number.isFinite(response.usage.inputTokens) &&
          response.usage.inputTokens! > 0
        ) {
          anchor = {
            key: view.usageKey,
            local: view.localTokens,
            actual: response.usage.inputTokens!,
          }
          report({ context: { ...progress.context!, actual: response.usage.inputTokens } })
        }
        const assistant = (await generation.responseMessages).find(
          (message) => message.role === 'assistant'
        )
        return { response, content: assistant?.content, requestId }
      } catch (cause) {
        const error = signal.aborted
          ? new DOMException('Stopped', 'AbortError')
          : modelFailure(cause)
        record.error = failure(error)
        record.endedAt = Date.now()
        await flushDraft().catch(() => {})
        await save([record])
        throw error
      }
    }

    async function summarize(
      reason: NonNullable<RequestRecord['compactionReason']>,
      force = false
    ) {
      const view = context()
      let plan = planSummary({ view, records, policy, toolTokens, force })
      let result: Awaited<ReturnType<typeof request>>
      try {
        result = await request('summary', plan.messages, plan.estimatedTokens, undefined, reason)
      } catch (error) {
        if (!(error instanceof AiError) || error.code !== 'context_overflow') throw error
        plan = planSummary({ view, records, policy, toolTokens, force: true, includeImages: false })
        result = await request('summary', plan.messages, plan.estimatedTokens, undefined, reason)
      }
      const { response, requestId } = result
      const checkpoint: ContextCheckpoint = {
        id: `checkpoint:${records.conversation.id}:${crypto.randomUUID()}`,
        conversationId: records.conversation.id,
        throughSequence: plan.throughSequence,
        text: response.text,
        requestId,
      }
      records.checkpoint = checkpoint
      records.conversation.checkpointId = checkpoint.id
      anchor = undefined
      await save([checkpoint])
    }

    function context() {
      return assembleContext({
        records,
        connection,
        policy,
        toolTokens,
        system: options.system,
        scene: { ...runContext, variables: describeVariables(records) },
        anchor,
        outcomes: records.tools
          .flatMap((tool) => tool.edits)
          .slice(-12)
          .map((edit) => ({
            recordId: edit.id,
            state: edit.state,
            verification:
              edit.state === 'succeeded' && edit.outcome
                ? scene.verify(edit.outcome)
                  ? 'present'
                  : 'changed_or_undone'
                : edit.state === 'uncertain'
                  ? 'uncertain_do_not_replay'
                  : edit.state,
          })),
      })
    }

    async function executeTool(tool: ToolRecord) {
      assertCurrent()
      report({ phase: 'tools', toolId: tool.id, diagnostics: undefined })
      if (tool.name !== 'execute_js' || tool.inputError) {
        tool.state = 'failed'
        tool.result = {
          ok: false,
          error: { code: 'invalid_input', message: tool.inputError ?? 'Use execute_js({code})' },
        }
        await save([tool])
        return
      }
      let output: ToolOutput
      try {
        output = await workbench.execute(tool, signal)
      } catch (error) {
        tool.state = tool.edits.some((e) => e.state === 'uncertain' || e.state === 'prepared')
          ? 'uncertain'
          : 'interrupted'
        tool.result = {
          ok: false,
          error: {
            code: failure(error).code,
            message: error instanceof Error ? error.message : String(error),
          },
        }
        await save([tool])
        throw error
      }
      const assets: AssetRecord[] = []
      const nextTool = { ...tool, assets: [...tool.assets] }
      for (const image of output.attachments ?? []) {
        const asset: AssetRecord = {
          id: image.imageId,
          conversationId: records.conversation.id,
          width: image.width,
          height: image.height,
          bytes: image.blob.size,
          blob: image.blob,
          mediaType: image.blob.type,
          ...(image.details ? { details: image.details } : {}),
        }
        nextTool.assets.push({
          id: asset.id,
          width: asset.width,
          height: asset.height,
          bytes: asset.bytes,
          mediaType: asset.mediaType,
          ...(asset.details ? { details: asset.details } : {}),
        })
        assets.push(asset)
      }
      const { attachments: _attachments, variables, ...result } = output
      nextTool.result = result
      nextTool.state = tool.edits.some((e) => e.state === 'uncertain')
        ? 'uncertain'
        : result.ok
          ? 'succeeded'
          : signal.aborted
            ? 'interrupted'
            : 'failed'
      await save([nextTool, ...assets, ...(variables ? [variables] : [])])
      Object.assign(tool, nextTool)
      if (variables) records.variables = variables
      publish()
    }

    records.conversation.lastRun = { id: runId, state: 'running' }
    try {
      onProgress(progress)
      if (options.text) await append('user', options.text, 'complete')
      else await save()
      requireUserBudget(records, options.system, policy)
      while (true) {
        assertCurrent()
        let view = context()
        const exchanges = records.messages.filter(
          (m) =>
            m.role === 'assistant' &&
            m.state === 'complete' &&
            m.sequence > (records.checkpoint?.throughSequence ?? -1)
        ).length
        if (exchanges && view.estimatedTokens >= policy.autoCompactTokenLimit) {
          await summarize('capacity', exchanges === 1)
          view = context()
        }
        if (view.estimatedTokens >= policy.usableContextWindow) throw new AiError('context_budget')
        let generated: Awaited<ReturnType<typeof request>> | undefined
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            draft = await append('assistant', '', 'streaming', view.hostContext)
            generated = await request('chat', view.messages, view.estimatedTokens, view)
            break
          } catch (error) {
            if (attempt > 0 || !(error instanceof AiError) || error.code !== 'context_overflow')
              throw error
            if (draft) {
              draft.state = 'interrupted'
              await save([draft])
              draft = undefined
            }
            await summarize('context_overflow', true)
            view = context()
            if (view.estimatedTokens >= policy.usableContextWindow)
              throw new AiError('context_overflow')
          }
        }
        assertCurrent()
        await flushDraft()
        const completedDraft = draft!
        const response = generated!.response
        const content = generated!.content ?? response.text
        completedDraft.content =
          typeof content === 'string'
            ? content
            : content.filter((part) => part.type !== 'tool-call')
        completedDraft.state = 'complete'
        const calls: ToolRecord[] = response.toolCalls.map((call, index) => ({
          id: `tool:${records.conversation.id}:${String(completedDraft.sequence).padStart(12, '0')}:${String(index).padStart(6, '0')}`,
          conversationId: records.conversation.id,
          messageId: completedDraft.id,
          providerCallId: call.toolCallId,
          name: call.toolName,
          input: call.input,
          inputError: call.invalid ? inputError(call.error, call.toolName) : undefined,
          providerOptions: call.providerMetadata,
          state: 'requested',
          assets: [],
          edits: [],
        }))
        completedDraft.toolIds = calls.map((tool) => tool.id)
        records.tools.push(...calls)
        await save([completedDraft, ...calls])
        draft = undefined
        if (!calls.length) {
          const current = context()
          report({
            context: {
              ...progress.context!,
              estimated: current.estimatedTokens,
              images: current.images,
              compacted: current.compacted,
            },
          })
          break
        }
        for (const tool of calls) await executeTool(tool)
      }
      assertCurrent()
      records.conversation.lastRun = {
        id: runId,
        state: 'completed',
        ...(warnings.size ? { warnings: [...warnings.values()] } : {}),
      }
    } catch (error) {
      records.conversation.lastRun = {
        id: runId,
        state: signal.aborted ? 'interrupted' : 'failed',
        error: failure(storageFailure ?? error),
        ...(warnings.size ? { warnings: [...warnings.values()] } : {}),
      }
      throw storageFailure ?? error
    } finally {
      await flushDraft().catch(() => {})
      const changed: (MessageRecord | ToolRecord)[] = []
      if (draft?.state === 'streaming') {
        draft.state = 'interrupted'
        changed.push(draft)
      }
      for (const tool of records.tools) {
        if (tool.state !== 'requested' && tool.state !== 'prepared') continue
        tool.edits = tool.edits.map((e) =>
          e.state === 'prepared' ? { ...e, state: 'uncertain' as const } : e
        )
        tool.state = tool.edits.some((e) => e.state === 'uncertain') ? 'uncertain' : 'interrupted'
        tool.result = {
          ok: false,
          error: {
            code: tool.state === 'uncertain' ? 'uncertain_edit' : 'interrupted',
            message: 'Run stopped without a confirmed outcome. Do not replay this call.',
          },
        }
        changed.push(tool)
      }
      try {
        await save(changed)
      } finally {
        onProgress(null)
      }
    }
  }

  return {
    async run(options: RunOptions) {
      if (active) throw new AiError('busy')
      const controller = new AbortController()
      const done = execute(options, controller.signal)
      active = { controller, done }
      try {
        await done
      } finally {
        active = null
      }
    },
    async stop() {
      const current = active
      if (!current) return
      current.controller.abort()
      await current.done.catch(() => {})
    },
  }
}

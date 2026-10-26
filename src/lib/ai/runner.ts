import type { ModelMessage, CallWarning } from 'ai'
import { endpointIdentity, type AiConnection } from './connection'
import {
  assembleContext,
  anchorKey,
  estimateToolTokens,
  planSummary,
  requireUserBudget,
  tokens,
  type ContextPolicy,
  type ContextView,
  type UsageAnchor,
} from './context'
import { effectiveReasoning } from './reasoning'
import { streamModel, modelFailure } from './model'
import type { ConversationRepository } from './repository'
import { createWorkbenchTools, workbenchTools } from './tools'
import { formatInputError } from './toolSchema'
import type { ComputeExecutor } from './computeClient'
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
  type ArtifactRecord,
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
    actual?: number
    budget: number
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
  language?: string
  compute?: ComputeExecutor
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
  return records.tools.filter((tool) => tool.state === 'uncertain' && !acknowledged.has(tool.id))
}

export function createAgentRunner(
  repository: ConversationRepository,
  generate: typeof streamModel = streamModel
) {
  let active: { controller: AbortController; done: Promise<void> } | null = null

  async function execute(options: RunOptions, signal: AbortSignal) {
    const { records, scene, connection, policy, onChange, onProgress } = options
    const runId = crypto.randomUUID()
    const workbench = createWorkbenchTools(
      records,
      repository,
      scene,
      options.language ?? 'zh',
      options.compute
    )
    const definitions = workbench.definitions
    const toolTokens = await estimateToolTokens(definitions)
    let progress: RunProgress = { phase: 'preparing', startedAt: Date.now() }
    let draft: MessageRecord | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let streamingSave = Promise.resolve()
    let storageFailure: unknown
    let anchor: UsageAnchor | undefined
    const warnings = new Map<string, CallWarning>()
    const publish = () => onChange(records)
    const report = (patch: Partial<RunProgress>) => {
      progress = { ...progress, ...patch }
      onProgress(progress)
    }
    const assertCurrent = (version?: string) => {
      assertNotAborted(signal)
      if (storageFailure) throw storageFailure
      try {
        scene.assertCurrent(version ?? scene.current().version)
      } catch (error) {
        if (error instanceof Error && error.name === 'SceneAnalysisError')
          throw new AiError('stale')
        throw error
      }
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
      const requestId = `request:${records.conversation.id}:${Date.now()}:${crypto.randomUUID()}`
      const requestVersion = scene.current().version
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
        maxOutputTokens: policy.maxTokens,
        diagnostics: {},
        estimatedTokens,
        policy: { ...policy },
        compactionReason,
      }
      await save([record])
      assertCurrent(requestVersion)
      report({
        phase: kind === 'summary' ? 'summarizing' : 'requesting',
        startedAt: record.startedAt,
        diagnostics: { phase: 'connecting' },
        toolId: undefined,
        ...(view
          ? {
              context: {
                estimated: view.estimatedTokens,
                budget: policy.inputBudget,
                images: view.images,
                compacted: view.compacted,
              },
            }
          : {}),
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
          tools: kind === 'summary' ? {} : definitions,
          toolChoice: kind === 'summary' ? 'none' : 'auto',
          maxOutputTokens: policy.maxTokens,
          abortSignal: signal,
          resolveAsset: async (id) => {
            const asset = await repository.read<AssetRecord>(id)
            return asset?.conversationId === records.conversation.id ? asset.blob : undefined
          },
          onRequest: async (body) => {
            assertCurrent(requestVersion)
            record.body = body
            await save([record])
            assertCurrent(requestVersion)
          },
          onResponse: (httpStatus) => diagnostics({ httpStatus, phase: 'waiting' }),
        })
        for await (const part of generation.stream) {
          assertCurrent(requestVersion)
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
        assertCurrent(requestVersion)
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
        if (view && response.usage.inputTokens) {
          anchor = {
            key: anchorKey(records, connection, view),
            local: view.localTokens,
            actual: response.usage.inputTokens,
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
      let plan = planSummary(records, policy, force, true, connection)
      let result: Awaited<ReturnType<typeof request>>
      try {
        result = await request('summary', plan.messages, tokens(plan.messages), undefined, reason)
      } catch (error) {
        if (!(error instanceof AiError) || error.code !== 'context_overflow') throw error
        plan = planSummary(records, policy, true, false, connection)
        result = await request('summary', plan.messages, tokens(plan.messages), undefined, reason)
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
      const current = scene.current()
      return assembleContext({
        records,
        connection,
        policy,
        toolTokens,
        system: options.system,
        scene: { ...current.summary, revision: current.version },
        anchor,
        outcomes: records.tools
          .filter((tool) => tool.effect === 'edit')
          .slice(-12)
          .map((tool) => ({
            recordId: tool.id,
            state: tool.state,
            verification:
              tool.state === 'succeeded' && tool.edit
                ? scene.verify(tool.edit)
                  ? 'present'
                  : 'changed_or_undone'
                : tool.state === 'uncertain'
                  ? 'uncertain_do_not_replay'
                  : tool.state,
          })),
      })
    }

    async function executeTool(tool: ToolRecord, version: string) {
      assertCurrent(version)
      report({ phase: 'tools', toolId: tool.id, diagnostics: undefined })
      const definition = Object.hasOwn(workbenchTools, tool.name)
        ? workbenchTools[tool.name as keyof typeof workbenchTools]
        : undefined
      if (!definition) {
        tool.state = 'failed'
        tool.result = { ok: false, error: { code: 'invalid_input', message: 'Unknown tool' } }
        await save([tool])
        return
      }
      if (tool.inputError) {
        tool.state = 'failed'
        tool.result = { ok: false, error: { code: 'invalid_input', message: tool.inputError } }
        await save([tool])
        return
      }
      if (tool.effect === 'edit') {
        if (unresolvedEdits(records).length) {
          tool.state = 'failed'
          tool.result = {
            ok: false,
            error: {
              code: 'uncertain_edit',
              message:
                'The user must inspect and acknowledge the unresolved edit before further editing. Read-only inspection is allowed.',
            },
          }
          await save([tool])
          return
        }
        tool.state = 'prepared'
        try {
          await save([tool])
          assertCurrent(version)
        } catch (error) {
          // This process knows the side effect has not started. A crash still leaves
          // the durable prepared record uncertain, but an ordinary Stop does not.
          tool.state = 'interrupted'
          tool.result = {
            ok: false,
            error: { code: 'not_executed', message: 'Stopped before the edit started.' },
          }
          await save([tool])
          throw error
        }
      }
      let output: ToolOutput
      try {
        output = await workbench.execute(
          tool.name,
          tool.input as Record<string, unknown>,
          version,
          signal,
          tool.id
        )
      } catch (error) {
        // These errors occur during pre-commit reads/checks; apply itself is synchronous.
        const notExecuted =
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof AiError && ['stale', 'cancelled', 'storage'].includes(error.code))
        const uncertain = tool.effect === 'edit' && !notExecuted
        tool.state = uncertain ? 'uncertain' : 'interrupted'
        tool.result = {
          ok: false,
          error: {
            code: uncertain ? 'uncertain_edit' : 'interrupted',
            message: uncertain
              ? 'No confirmed outcome. Do not replay this call.'
              : tool.effect === 'edit'
                ? 'Stopped before completion; this edit was not executed.'
                : 'Read interrupted before completion.',
          },
        }
        await save([tool])
        throw error
      }

      const assets: AssetRecord[] = []
      for (const image of output.attachments ?? []) {
        const id = image.imageId
        if (!id.startsWith(`asset:${records.conversation.id}:`)) throw new AiError('storage')
        const asset: AssetRecord = {
          id,
          conversationId: records.conversation.id,
          width: image.width,
          height: image.height,
          bytes: image.blob.size,
          blob: image.blob,
        }
        tool.assets.push({ id, width: asset.width, height: asset.height, bytes: asset.bytes })
        if (!(await repository.read(id))) assets.push(asset)
      }
      const { attachments: _attachments, artifacts = [], edit, ...result } = output
      tool.artifactIds = artifacts.filter((a): a is ArtifactRecord => 'ref' in a).map((a) => a.ref)
      tool.result = result
      tool.edit = edit
      tool.state = result.ok ? 'succeeded' : 'failed'
      // No abort check here: a completed outcome must become durable even after Stop.
      await save([tool, ...assets, ...artifacts])
      records.artifacts.push(
        ...artifacts.filter(
          (a): a is ArtifactRecord =>
            'ref' in a && !records.artifacts.some((old) => old.id === a.id)
        )
      )
      publish()
      if (!result.ok && ['stale_snapshot', 'cancelled'].includes(result.error?.code ?? ''))
        throw new AiError('stale')
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
        if (exchanges && view.estimatedTokens > policy.threshold) {
          await summarize('capacity', exchanges === 1)
          view = context()
        }
        if (view.estimatedTokens > policy.inputBudget) throw new AiError('context_budget')
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
            if (view.estimatedTokens > policy.inputBudget) throw new AiError('context_overflow')
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
          effect:
            Object.hasOwn(workbenchTools, call.toolName) &&
            workbenchTools[call.toolName as keyof typeof workbenchTools].metadata?.effect === 'edit'
              ? 'edit'
              : 'read',
          state: 'requested',
          assets: [],
        }))
        completedDraft.toolIds = calls.map((tool) => tool.id)
        records.tools.push(...calls)
        await save([completedDraft, ...calls])
        draft = undefined
        if (!calls.length) break
        const editIndex = calls.findIndex((tool) => tool.effect === 'edit')
        const invalidBatch =
          editIndex !== -1 &&
          (editIndex !== calls.length - 1 ||
            calls.filter((tool) => tool.effect === 'edit').length > 1)
        if (invalidBatch) {
          for (const tool of calls) {
            tool.state = 'failed'
            tool.result = {
              ok: false,
              error: {
                code: 'not_executed',
                message: 'No calls in this batch executed. Use at most one edit and place it LAST.',
              },
            }
          }
          await save(calls)
          continue
        }
        const version = scene.current().version
        for (const tool of calls) await executeTool(tool, version)
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
        tool.state = tool.state === 'prepared' ? 'uncertain' : 'interrupted'
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

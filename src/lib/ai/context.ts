import { asSchema, type ModelMessage, type FilePart, type ToolSet } from 'ai'
import {
  DEFAULT_AI_PREFERENCES,
  endpointIdentity,
  modelSettingsKey,
  resolveConnection,
  shouldReplayReasoning,
  validateConnection,
  type AiConnection,
  type AiPreferences,
  type AiSettings,
} from './connection'
import {
  AiError,
  messageText,
  type ConversationRecords,
  type ImageReference,
  type HostContextRecord,
} from './types'
import { estimateText, toolModelResult, TOOL_OUTPUT_BYTES } from './tools'
import { describeArtifact } from './artifacts'
import { SUMMARY_PROMPT } from './prompts'

export interface ContextPolicy {
  contextWindow: number
  maxTokens: number
  inputBudget: number
  threshold: number
  toolOutputBytes: number
  imageTriggerBytes: number
  imageTargetBytes: number
}
/** Capacity-driven compaction; byte budgets follow OpenCode, not a picture-count window. */
export function createPolicy(
  contextWindow = DEFAULT_AI_PREFERENCES.contextWindow,
  maxTokens = DEFAULT_AI_PREFERENCES.maxTokens,
  resources: Partial<
    Pick<ContextPolicy, 'toolOutputBytes' | 'imageTriggerBytes' | 'imageTargetBytes'>
  > = {}
): ContextPolicy {
  if (
    !Number.isSafeInteger(contextWindow) ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 1 ||
    contextWindow - maxTokens < 4000
  )
    throw new AiError('settings')
  const inputBudget = contextWindow - maxTokens
  const imageTriggerBytes = DEFAULT_AI_PREFERENCES.imageBudgetMiB * 1024 * 1024
  const budgets = {
    toolOutputBytes: TOOL_OUTPUT_BYTES,
    imageTriggerBytes,
    imageTargetBytes: Math.floor(imageTriggerBytes * 0.6),
    ...resources,
  }
  if (
    Object.values(budgets).some((v) => !Number.isSafeInteger(v) || v < 1) ||
    budgets.imageTargetBytes > budgets.imageTriggerBytes
  )
    throw new AiError('settings')
  return {
    contextWindow,
    maxTokens,
    inputBudget,
    threshold: Math.min(
      inputBudget,
      contextWindow - Math.max(Math.floor(contextWindow * 0.15), contextWindow >= 32000 ? 16000 : 0)
    ),
    ...budgets,
  }
}

export function createAiPolicy(settings: AiPreferences) {
  const imageTriggerBytes = settings.imageBudgetMiB * 1024 * 1024
  return createPolicy(settings.contextWindow, settings.maxTokens, {
    imageTriggerBytes,
    imageTargetBytes: Math.floor(imageTriggerBytes * 0.6),
  })
}

export function resolveAiConfig(settings: AiSettings) {
  const connection = resolveConnection(settings)
  validateConnection(connection)
  return { connection, policy: createAiPolicy(settings) }
}

export async function estimateToolTokens(tools: ToolSet) {
  const declarations = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
    }))
  )
  return declarations.length ? estimateText(JSON.stringify(declarations)) : 0
}

export function tokens(messages: readonly ModelMessage[], toolTokens = 0) {
  return (
    toolTokens +
    messages.reduce((sum, message) => {
      if (
        (message.role === 'user' || message.role === 'system') &&
        Array.isArray(message.content)
      ) {
        return (
          sum +
          12 +
          message.content.reduce(
            (cost, part) => cost + (part.type === 'text' ? estimateText(part.text) : 2048),
            0
          )
        )
      }
      return sum + 12 + estimateText(JSON.stringify(message))
    }, 0)
  )
}

export function projectSource(
  id: string,
  records: ConversationRecords,
  connection: AiConnection | null,
  toolOutputBytes: number
): ModelMessage {
  const message = records.messages.find((m) => m.id === id)
  if (message) {
    if (message.role === 'user')
      return {
        role: 'user',
        content:
          messageText(message) +
          (message.references?.length
            ? `\n[引用资料] ${JSON.stringify(
                message.references.map((ref) => {
                  const a = records.artifacts.find((a) => a.ref === ref)
                  if (!a) throw new AiError('storage')
                  return describeArtifact(a)
                })
              )}`
            : ''),
      }
    const calls = message.toolIds.map((toolId) => records.tools.find((tool) => tool.id === toolId)!)
    if (calls.some((call) => !call)) throw new AiError('storage')
    const sameModel =
      connection !== null &&
      message.source?.model === connection.model &&
      message.source.endpoint === endpointIdentity(connection) &&
      message.source.provider === connection.provider
    const replay = connection && shouldReplayReasoning(connection) && sameModel
    const content = [
      ...(typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : message.content),
      ...calls.map((call) => ({
        type: 'tool-call' as const,
        toolCallId: call.providerCallId,
        toolName: call.name,
        input: call.input,
        providerOptions: call.providerOptions,
      })),
    ]
    return {
      role: 'assistant',
      content: content
        .filter((part) => part.type !== 'reasoning' || replay)
        .map((part) => {
          if (sameModel || !('providerOptions' in part)) return part
          const { providerOptions: _options, ...plain } = part
          return plain
        }),
    }
  }
  const tool = records.tools.find((t) => t.id === id)
  if (tool)
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: tool.providerCallId,
          toolName: tool.name,
          output: { type: 'text', value: toolModelResult(tool, toolOutputBytes) },
        },
      ],
    }
  if (records.checkpoint?.id === id)
    return {
      role: 'user',
      content: `[task-checkpoint] 延续以下任务进展：\n${records.checkpoint.text}`,
    }
  throw new AiError('storage')
}

export interface ContextView {
  messages: ModelMessage[]
  estimatedTokens: number
  localTokens: number
  images: number
  compacted: boolean
  hostContext?: HostContextRecord
}
export interface UsageAnchor {
  key: string
  local: number
  actual: number
}

function imageContent(asset: ImageReference, records: ConversationRecords) {
  const a = records.artifacts.find((a) => a.asset?.id === asset.id)
  if (!a) throw new AiError('storage', 'Image has no artifact reference')
  return [
    {
      type: 'text' as const,
      text: `图片 ${a.ref} · 场景版本 ${a.revision}；可用 inspect 取回原图。`,
    },
    { type: 'file' as const, mediaType: 'image/png', data: `momo-asset:${asset.id}` },
  ]
}

function imageAsset(part: FilePart, records: ConversationRecords) {
  const id = String(part.data).replace(/^momo-asset:/, '')
  const asset = records.artifacts.find((a) => a.asset?.id === id)?.asset
  if (!asset) throw new AiError('storage', 'Image has no artifact reference')
  return asset
}

/** Chat and summary share one encoded-byte budget; original records never change. */
function boundImages(
  messages: ModelMessage[],
  records: ConversationRecords,
  policy: ContextPolicy
) {
  const images = messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) => (part.type === 'file' ? [imageAsset(part, records)] : []))
      : []
  )
  let bytes = 0,
    cut = 0
  for (const asset of images) {
    bytes += Math.ceil(asset.bytes / 3) * 4
    if (bytes > policy.imageTriggerBytes)
      while (bytes > policy.imageTargetBytes && cut < images.length)
        bytes -= Math.ceil(images[cut++]!.bytes / 3) * 4
  }
  let index = 0
  const selected = messages.map((message): ModelMessage => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'file' || index++ >= cut) return part
        const ref = records.artifacts.find((a) => a.asset?.id === imageAsset(part, records).id)!.ref
        return {
          type: 'text' as const,
          text: `[图片 ${ref} 未在此处附上，可用 inspect ${ref} 取回。因请求图片字节预算省略。]`,
        }
      }),
    }
  })
  return { messages: selected, images: images.length - cut }
}

export function assembleContext(input: {
  system: string
  records: ConversationRecords
  connection: AiConnection
  policy: ContextPolicy
  toolTokens: number
  scene: unknown
  outcomes: HostContextRecord['outcomes']
  anchor?: UsageAnchor
}): ContextView {
  const { records, connection, policy } = input
  const through = records.checkpoint?.throughSequence ?? -1
  const projected: ModelMessage[] = [{ role: 'system', content: input.system }]
  const source = (id: string) => projectSource(id, records, connection, policy.toolOutputBytes)
  for (const message of records.messages)
    if (message.role === 'user' && message.sequence <= through) projected.push(source(message.id))
  if (records.checkpoint) projected.push(source(records.checkpoint.id))
  for (const message of records.messages) {
    if (message.sequence <= through) continue
    // Even an interrupted reply may have consumed these facts. Replay them in their original position.
    if (message.hostContext) projected.push({ role: 'user', content: message.hostContext.text })
    if (message.state !== 'complete') continue
    projected.push(source(message.id))
    if (message.role !== 'assistant') continue
    const attachments: ImageReference[] = []
    for (const id of message.toolIds) {
      const tool = records.tools.find((t) => t.id === id)
      if (!tool) throw new AiError('storage')
      projected.push(source(id))
      attachments.push(...tool.assets)
    }
    if (attachments.length) {
      projected.push({
        role: 'user',
        content: attachments.flatMap((asset) => imageContent(asset, records)),
      })
    }
  }
  const bounded = boundImages(projected, records, policy)
  const messages = bounded.messages
  const latest = records.messages.findLast(
    (message) => message.sequence > through && message.hostContext
  )?.hostContext
  // A checkpoint starts a new baseline, including when it keeps later exchanges with old deltas.
  const previous = latest?.checkpointId === records.checkpoint?.id ? latest : undefined
  const changes: string[] = []
  if (!previous || JSON.stringify(previous.scene) !== JSON.stringify(input.scene))
    changes.push(`编辑器：${JSON.stringify(input.scene)}`)
  const outcomes = input.outcomes.filter(
    (outcome) => !previous?.outcomes.some((old) => JSON.stringify(old) === JSON.stringify(outcome))
  )
  if (outcomes.length) changes.push(`操作核验：${JSON.stringify(outcomes)}`)
  const hostContext = changes.length
    ? structuredClone({
        scene: input.scene,
        outcomes: input.outcomes,
        text: ['[current-state]', ...changes].join('\n'),
        checkpointId: records.checkpoint?.id,
      })
    : undefined
  if (hostContext) messages.push({ role: 'user', content: hostContext.text })
  const localTokens = tokens(messages, input.toolTokens)
  const view = {
    messages,
    localTokens,
    estimatedTokens: localTokens,
    images: bounded.images,
    compacted: Boolean(records.checkpoint),
    hostContext,
  }
  const key = anchorKey(records, connection, view)
  if (input.anchor?.key === key)
    view.estimatedTokens = Math.max(
      localTokens,
      input.anchor.actual + localTokens - input.anchor.local
    )
  return view
}

export function anchorKey(
  records: ConversationRecords,
  connection: AiConnection,
  view: ContextView
) {
  const ids = view.messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) => (part.type === 'file' ? [String(part.data)] : []))
      : []
  )
  return `${modelSettingsKey(connection)}:${shouldReplayReasoning(connection)}:${records.checkpoint?.id}:${ids.join(',')}`
}

export function planSummary(
  records: ConversationRecords,
  policy: ContextPolicy,
  force = false,
  includeImages = true,
  connection: AiConnection | null = null
): { messages: ModelMessage[]; throughSequence: number } {
  const previous = records.checkpoint?.throughSequence ?? -1
  const completed = records.messages.filter(
    (m) => m.sequence > previous && m.role === 'assistant' && m.state === 'complete'
  )
  if (!completed.length) throw new AiError('context_budget')
  const exchange = (m: (typeof completed)[number], outputBytes: number): ModelMessage[] => {
    const tools = m.toolIds.map((id) => records.tools.find((t) => t.id === id)!)
    if (tools.some((t) => !t)) throw new AiError('storage')
    const assets = tools.flatMap((t) => t.assets)
    return [
      ...(m.hostContext ? [{ role: 'user' as const, content: m.hostContext.text }] : []),
      projectSource(m.id, records, connection, outputBytes),
      ...tools.map((t) => projectSource(t.id, records, connection, outputBytes)),
      ...(assets.length
        ? [
            {
              role: 'user' as const,
              content: assets.flatMap((a) =>
                includeImages
                  ? imageContent(a, records)
                  : [
                      {
                        type: 'text' as const,
                        text: `已保存图片 ${records.artifacts.find((r) => r.asset?.id === a.id)?.ref}；因容量限制未附入本次摘要请求。`,
                      },
                    ]
              ),
            },
          ]
        : []),
    ]
  }
  // Keep recent complete exchanges by token budget, not by a fixed number of tool calls.
  const retain = Math.floor(policy.inputBudget * (force ? 0.08 : 0.16))
  let split = completed.length,
    kept = 0
  for (let i = completed.length - 1; i >= 1; i--) {
    const cost = tokens(exchange(completed[i]!, policy.toolOutputBytes))
    if (kept && kept + cost > retain) break
    kept += cost
    split = i
  }
  const candidates = completed.slice(0, split)
  const requirements = records.messages
    .filter((m) => m.role === 'user')
    .map((m) => ({
      recordId: m.id,
      text: messageText(m),
      references: m.references?.map((ref) =>
        describeArtifact(records.artifacts.find((a) => a.ref === ref)!)
      ),
    }))
  const prefix: ModelMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        originalUserRequirements: requirements,
        previousCheckpoint: records.checkpoint?.text,
      }),
    },
  ]
  let outputBytes = policy.toolOutputBytes
  let messages = [...prefix, ...candidates.flatMap((m) => exchange(m, outputBytes))]
  // Only a real capacity shortfall permits a smaller summary transcript; originals stay retrievable.
  while (tokens(messages) > policy.inputBudget && outputBytes > 1024) {
    outputBytes = Math.max(1024, Math.floor(outputBytes / 2))
    messages = [...prefix, ...candidates.flatMap((m) => exchange(m, outputBytes))]
  }
  messages = boundImages(messages, records, policy).messages
  if (tokens(messages) > policy.inputBudget) {
    if (includeImages) return planSummary(records, policy, force, false, connection)
    throw new AiError('context_budget')
  }
  return { messages, throughSequence: candidates[candidates.length - 1]!.sequence }
}

export function requireUserBudget(
  records: ConversationRecords,
  system: string,
  policy: ContextPolicy
) {
  if (
    tokens([
      { role: 'system', content: system },
      ...records.messages
        .filter((m) => m.role === 'user')
        .map((m): ModelMessage => ({ role: 'user', content: messageText(m) })),
    ]) > policy.inputBudget
  )
    throw new AiError('context_budget')
}

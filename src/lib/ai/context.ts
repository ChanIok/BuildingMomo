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
import { SUMMARY_PROMPT } from './prompts'

export interface ContextPolicy {
  contextWindow: number
  maxTokens: number
  usableContextWindow: number
  autoCompactTokenLimit: number
  toolOutputBytes: number
  imageTriggerBytes: number
  imageTargetBytes: number
}
/** Token capacity and encoded image bytes have independent limits. */
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
    contextWindow < 5000 ||
    maxTokens < 1
  )
    throw new AiError('settings')
  const imageTriggerBytes =
    resources.imageTriggerBytes ?? DEFAULT_AI_PREFERENCES.imageBudgetMiB * 1024 * 1024
  const budgets = {
    toolOutputBytes: TOOL_OUTPUT_BYTES,
    imageTriggerBytes,
    imageTargetBytes: Math.min(15 * 1024 * 1024, Math.floor((imageTriggerBytes * 15) / 32)),
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
    usableContextWindow: Math.floor(contextWindow * 0.95),
    autoCompactTokenLimit: Math.floor(contextWindow * 0.9),
    ...budgets,
  }
}

/** Output is a ceiling, not a fixed reservation deducted from every input window. */
export function requestOutputLimit(policy: ContextPolicy, estimatedInputTokens: number) {
  const remaining = policy.usableContextWindow - Math.ceil(estimatedInputTokens)
  if (!Number.isFinite(remaining) || remaining < 1) throw new AiError('context_budget')
  return Math.min(policy.maxTokens, remaining)
}

export function createAiPolicy(settings: AiPreferences) {
  return createPolicy(settings.contextWindow, settings.maxTokens, {
    imageTriggerBytes: settings.imageBudgetMiB * 1024 * 1024,
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

/** Dimension-aware fallback, not a provider billing formula. Actual input usage calibrates it. */
export function estimateImageTokens(width: number, height: number) {
  return Math.ceil(width / 32) * Math.ceil(height / 32)
}

export function tokens(
  messages: readonly ModelMessage[],
  toolTokens = 0,
  records?: ConversationRecords
) {
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
          message.content.reduce((cost, part) => {
            if (part.type === 'text') return cost + estimateText(part.text)
            const asset = part.type === 'file' && records ? imageAsset(part, records) : undefined
            return cost + (asset ? estimateImageTokens(asset.width, asset.height) : 2048)
          }, 0)
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
        content: messageText(message),
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
  /** Complete assistant/tool/image boundaries in the shared projection. */
  exchanges: { sequence: number; start: number; end: number }[]
  estimatedTokens: number
  localTokens: number
  images: number
  compacted: boolean
  hostContext?: HostContextRecord
  /** Identifies the stable request projection; appended images do not change it. */
  usageKey: string
}
export interface UsageAnchor {
  key: string
  local: number
  actual: number
}

function imageContent(asset: ImageReference) {
  return [
    { type: 'text' as const, text: `图片 ${asset.id}；可用 api.showImage(imageId) 取回原图。` },
    {
      type: 'file' as const,
      mediaType: asset.mediaType ?? 'image/png',
      data: `momo-asset:${asset.id}`,
    },
  ]
}
function imageAsset(part: FilePart, records: ConversationRecords) {
  const id = String(part.data).replace(/^momo-asset:/, '')
  const asset = records.tools.flatMap((t) => t.assets).find((asset) => asset.id === id)
  if (!asset) throw new AiError('storage', 'Image metadata is missing')
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
        const ref = imageAsset(part, records).id
        return {
          type: 'text' as const,
          text: `[图片 ${ref} 因体积预算省略；api.showImage("${ref}") 可重新查看。]`,
        }
      }),
    }
  })
  return {
    messages: selected,
    images: images.length - cut,
    omitted: images.slice(0, cut).map((asset) => asset.id),
  }
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
  const exchanges: ContextView['exchanges'] = []
  const source = (id: string) => projectSource(id, records, connection, policy.toolOutputBytes)
  for (const message of records.messages)
    if (message.role === 'user' && message.sequence <= through) projected.push(source(message.id))
  if (records.checkpoint) projected.push(source(records.checkpoint.id))
  for (const message of records.messages) {
    if (message.sequence <= through) continue
    const start = projected.length
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
        content: attachments.flatMap((asset) => imageContent(asset)),
      })
    }
    exchanges.push({ sequence: message.sequence, start, end: projected.length })
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
  const localTokens = tokens(messages, input.toolTokens, records)
  const view = {
    messages,
    exchanges,
    localTokens,
    estimatedTokens: localTokens,
    images: bounded.images,
    compacted: Boolean(records.checkpoint),
    hostContext,
    // Only prefix rewrites invalidate measured usage. New turns/images are deltas.
    usageKey: JSON.stringify([
      modelSettingsKey(connection),
      shouldReplayReasoning(connection),
      connection.reasoning,
      connection.providerOptions,
      connection.requestBody,
      records.checkpoint?.id,
      input.system,
      input.toolTokens,
      policy.toolOutputBytes,
      bounded.omitted,
      '32px-patches',
    ]),
  }
  if (input.anchor?.key === view.usageKey)
    view.estimatedTokens = Math.max(0, input.anchor.actual + localTokens - input.anchor.local)
  return view
}

export function planSummary(input: {
  view: ContextView
  records: ConversationRecords
  policy: ContextPolicy
  toolTokens: number
  force?: boolean
  includeImages?: boolean
}): { messages: ModelMessage[]; throughSequence: number; estimatedTokens: number } {
  const { view, records, policy, toolTokens, force = false, includeImages = true } = input
  const { exchanges } = view
  if (!exchanges.length) throw new AiError('context_budget')
  const retain = Math.floor(policy.autoCompactTokenLimit * (force ? 0.08 : 0.16))
  let split = exchanges.length,
    kept = 0
  for (let i = exchanges.length - 1; i >= 1; i--) {
    const exchange = exchanges[i]!
    const cost = tokens(view.messages.slice(exchange.start, exchange.end), 0, records)
    if (kept + cost > retain) break
    kept += cost
    split = i
  }
  // Derive from the exact chat prefix. Never reconstruct a parallel summary transcript.
  while (split > 0) {
    const boundary = exchanges[split - 1]!
    let prefix = view.messages.slice(0, boundary.end)
    if (!includeImages)
      prefix = prefix.map((message): ModelMessage => {
        if (message.role !== 'user' || !Array.isArray(message.content)) return message
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === 'file'
              ? {
                  type: 'text',
                  text: `图片 ${imageAsset(part, records).id} 已保存；本次容量恢复摘要未附原图。`,
                }
              : part
          ),
        }
      })
    const messages: ModelMessage[] = [...prefix, { role: 'user', content: SUMMARY_PROMPT }]
    const local = tokens(messages, toolTokens, records)
    // Keep the measured correction for an unchanged prefix; a no-image recovery uses local estimates.
    const estimatedTokens = includeImages
      ? Math.max(0, view.estimatedTokens + local - view.localTokens)
      : local
    if (estimatedTokens < policy.usableContextWindow)
      return { messages, throughSequence: boundary.sequence, estimatedTokens }
    split--
  }
  if (includeImages) return planSummary({ ...input, includeImages: false })
  throw new AiError('context_budget')
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
    ]) >= policy.usableContextWindow
  )
    throw new AiError('context_budget')
}

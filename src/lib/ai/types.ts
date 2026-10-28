import type {
  AssistantModelMessage,
  ModelMessage,
  LanguageModelUsage,
  ToolCallPart,
  TextStreamPart,
  ToolSet,
  CallWarning,
} from 'ai'
import type { AiProvider, AiReasoning } from './connection'

export interface ImageReference {
  id: string
  width: number
  height: number
  bytes: number
  mediaType?: string
  /** Compact render receipt, retained independently of script return/log output. */
  details?: Record<string, unknown>
}
export interface RequestDiagnostics {
  phase?: 'connecting' | 'waiting' | 'reasoning' | 'text' | 'tool_arguments'
  httpStatus?: number
  firstOutputMs?: number
  finishReason?: string
  usage?: LanguageModelUsage
  toolCalls?: ToolCallPart[]
  warnings?: CallWarning[]
}
export interface Failure {
  code: string
  name: string
}
export type RunState = 'running' | 'completed' | 'interrupted' | 'failed'
export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  nextSequence: number
  lastRun?: { id: string; state: RunState; error?: Failure; warnings?: CallWarning[] }
  checkpointId?: string
}
export interface MessageRecord {
  id: string
  conversationId: string
  sequence: number
  runId: string
  role: 'user' | 'assistant'
  /** SDK text/reasoning parts and continuation metadata. Calls live in ToolRecord. */
  content: AssistantModelMessage['content']
  state: 'streaming' | 'complete' | 'interrupted'
  toolIds: string[]
  acknowledges?: string[]
  source?: { provider: AiProvider; endpoint: string; model: string }
  /** Frozen host facts sent immediately before this assistant attempt, not player input. */
  hostContext?: HostContextRecord
}
/** Text is derived for display/search, never stored as a parallel message representation. */
export function messageText(
  message: Pick<ModelMessage, 'content'>,
  type: 'text' | 'reasoning' = 'text'
) {
  return typeof message.content === 'string'
    ? type === 'text'
      ? message.content
      : ''
    : message.content
        .filter((part) => part.type === type)
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
}
export interface HostContextRecord {
  scene: unknown
  outcomes: { recordId: string; state: string; verification: string }[]
  text: string
  checkpointId?: string
}
export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}
export interface EditOutcome {
  schemeId: string
  transactionId?: string
  postcondition: string
}
export interface ToolRecord {
  id: string
  conversationId: string
  messageId: string
  providerCallId: string
  name: string
  input: ToolCallPart['input']
  inputError?: string
  providerOptions?: ToolCallPart['providerOptions']
  state: 'requested' | 'prepared' | 'succeeded' | 'failed' | 'interrupted' | 'uncertain'
  result?: ToolResult
  assets: ImageReference[]
  edits: EditRecord[]
}
export interface ImageAttachment {
  imageId: string
  blob: Blob
  width: number
  height: number
  details?: Record<string, unknown>
}
export interface ToolOutput extends ToolResult {
  attachments?: ImageAttachment[]
  variables?: VariablesRecord
  edit?: EditOutcome
}
export interface AssetRecord extends ImageReference {
  conversationId: string
  blob: Blob
}
export interface ContextCheckpoint {
  id: string
  conversationId: string
  throughSequence: number
  text: string
  requestId: string
}
export interface RequestRecord {
  id: string
  conversationId: string
  runId: string
  kind: 'chat' | 'summary'
  startedAt: number
  endedAt?: number
  endpoint: string
  model: string
  provider: AiProvider
  reasoning?: AiReasoning
  maxOutputTokens: number
  /** Actual provider request captured before sending. Image data is replaced with local asset URLs. */
  body?: unknown
  /** Native SDK input events retain incomplete arguments for failed-request diagnostics. */
  toolInput?: Extract<
    TextStreamPart<ToolSet>,
    { type: 'tool-input-start' | 'tool-input-delta' | 'tool-input-end' }
  >[]
  diagnostics: RequestDiagnostics
  estimatedTokens: number
  /** Local estimate at the measured request boundary; actual usage stays in diagnostics. */
  usageBaseline?: { key: string; local: number; sequence: number }
  policy: import('./context').ContextPolicy
  compactionReason?: 'capacity' | 'context_overflow'
  error?: Failure
}
export interface ConversationRecords {
  conversation: Conversation
  messages: MessageRecord[]
  tools: ToolRecord[]
  variables: VariablesRecord
  checkpoint?: ContextCheckpoint
}
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface ItemReference {
  schemeId: string
  internalId: string
  revision: string
}
export interface VariablesRecord {
  id: string
  conversationId: string
  values: Record<string, JsonValue>
  references: ItemReference[]
}
export interface EditRecord {
  id: string
  state: 'prepared' | 'succeeded' | 'failed' | 'uncertain'
  schemeId: string
  input: unknown
  result?: unknown
  outcome?: EditOutcome
}
export interface ScriptItem {
  ref: number
  instanceId: number
  gameId: number
  name: string | null
  groupId: number
  position: import('../sceneAnalysis/types').AnalysisVector3
  rotation: import('../sceneAnalysis/types').AnalysisVector3
  scale: import('../sceneAnalysis/types').AnalysisVector3
  bounds: import('../sceneAnalysis/types').AnalysisBounds | null
}
export interface RenderPanel {
  label: string
  members: string[]
  kind: 'scene' | 'atlas'
  focus?: string[]
  camera?: import('../sceneAnalysis/images').AnalysisCamera
  width?: number
  height?: number
  layout?: import('../sceneAnalysis/images').ImageLayout
  color?: string
  labels?: boolean | string[]
}
export interface EditorHost {
  context(): { schemeId: string | null; title?: string }
  schemes(): { id: string; name: string }[]
  revision(schemeId: string): string
  selection(schemeId: string): string[]
  structure(schemeId: string): {
    groups: import('../collectionTree').GroupMetadata[]
    collections: import('../collectionTree').SchemeCollection[]
  }
  snapshot(schemeId: string, members?: string[]): import('../sceneAnalysis/types').AnalysisSnapshot
  render(
    schemeId: string,
    panels: RenderPanel[],
    signal: AbortSignal,
    layout?: import('../sceneAnalysis/images').ImageLayout
  ): Promise<import('../sceneAnalysis/images').AnalysisImageOutput>
  apply(schemeId: string, parameters: unknown, version: string): ToolOutput
  verify(edit: EditOutcome): boolean
}

export class AiError extends Error {
  readonly code: string
  constructor(code: string, message = code) {
    super(message)
    this.name = 'AiError'
    this.code = code
  }
}
export function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}
export function failure(error: unknown): Failure {
  return {
    code:
      error instanceof AiError
        ? error.code
        : error instanceof Error && error.name === 'AbortError'
          ? 'cancelled'
          : 'unexpected',
    name: error instanceof Error ? error.name : 'UnknownError',
  }
}

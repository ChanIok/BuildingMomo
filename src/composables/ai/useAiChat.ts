import { computed, onScopeDispose, shallowRef, triggerRef, watch, type Ref } from 'vue'
import { useLocalStorage, useTimestamp } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveConnection } from '@/lib/ai/connection'
import { resolveAiConfig } from '@/lib/ai/context'
import { useAiEditorHost } from './useAiEditorHost'
import { useI18n } from '@/composables/useI18n'
import { createConversationRepository, type ConversationRepository } from '@/lib/ai/repository'
import { createAgentRunner, unresolvedEdits, type RunProgress } from '@/lib/ai/runner'
import { systemPrompt } from '@/lib/ai/prompts'
import { exportConversation } from '@/lib/ai/diagnostics'
import {
  failure,
  messageText,
  type AssetRecord,
  type Conversation,
  type ConversationRecords,
  type MessageRecord,
  type ToolRecord,
} from '@/lib/ai/types'
import type { AnalysisCaptureProvider } from '@/lib/sceneAnalysis/images'
import type { ChatEntry } from './chatContext'

export function useAiChat(options: {
  enabled: Readonly<Ref<boolean>>
  getCaptureProvider: () => AnalysisCaptureProvider | null
  repository?: ConversationRepository
}) {
  const settings = useSettingsStore()
  const { t, locale } = useI18n()
  const repository = options.repository ?? createConversationRepository()
  const runner = createAgentRunner(repository)
  const editorHost = useAiEditorHost({ getCaptureProvider: options.getCaptureProvider })
  const records = shallowRef<ConversationRecords | null>(null)
  const sessions = shallowRef<Conversation[]>([])
  const phase = shallowRef<'idle' | 'loading' | 'running'>('idle')
  const error = shallowRef('')
  const storageState = shallowRef<'idle' | 'saved' | 'error'>('idle')
  const progress = shallowRef<RunProgress | null>(null)
  const contextInfo = shallowRef<RunProgress['context']>()
  const visibleMessages = shallowRef(50)
  const activeConversation = useLocalStorage('buildingmomo_ai_active', '')
  const secrets = new Set<string>()
  const {
    timestamp: now,
    pause,
    resume: startClock,
  } = useTimestamp({ interval: 1000, controls: true, immediate: false })
  let navigation = 0,
    disposed = false
  let admission: AbortController | undefined
  async function stop() {
    admission?.abort()
    await runner.stop()
  }
  const isRunning = computed(() => phase.value === 'running')
  const isLoading = computed(() => phase.value === 'loading')
  const sessionId = computed(() => records.value?.conversation.id ?? '')
  const interrupted = computed(() =>
    Boolean(
      records.value?.conversation.lastRun &&
      records.value.conversation.lastRun.state !== 'completed'
    )
  )
  const uncertain = computed(() => (records.value ? unresolvedEdits(records.value) : []))
  const messageEntries = new WeakMap<MessageRecord, ChatEntry>()
  const toolEntries = new WeakMap<
    ToolRecord,
    { state: ToolRecord['state']; result: ToolRecord['result']; entry: ChatEntry }
  >()
  const entries = computed<ChatEntry[]>(() => {
    const data = records.value
    if (!data) return []
    const byId = new Map(data.tools.map((tool) => [tool.id, tool]))
    return data.messages.slice(-visibleMessages.value).flatMap((message) => {
      const row: ChatEntry = messageEntries.get(message) ?? {
        id: message.id,
        role: message.role,
        text: messageText(message),
        reasoning: messageText(message, 'reasoning'),
        state:
          message.state === 'streaming'
            ? 'running'
            : message.state === 'interrupted'
              ? 'cancelled'
              : 'success',
      }
      if (message.state !== 'streaming') messageEntries.set(message, row)
      return [
        row,
        ...message.toolIds.map((id): ChatEntry => {
          const tool = byId.get(id)!
          const cached = toolEntries.get(tool)
          if (cached?.state === tool.state && cached.result === tool.result) return cached.entry
          const terminal = !['requested', 'prepared'].includes(tool.state)
          let formatted: string | undefined
          const entry: ChatEntry = {
            id,
            role: 'tool',
            toolName: tool.name,
            code: (tool.input as { code?: string })?.code,
            text: '',
            output: tool.result
              ? () => {
                  const text =
                    formatted ??
                    JSON.stringify(
                      {
                        ...tool.result,
                        edits: tool.edits.map(({ id, schemeId, state, result }) => ({
                          id,
                          schemeId,
                          state,
                          result,
                        })),
                      },
                      null,
                      2
                    )
                  if (terminal) formatted = text
                  return text
                }
              : undefined,
            state:
              progress.value?.toolId === id && ['requested', 'prepared'].includes(tool.state)
                ? 'running'
                : tool.state === 'succeeded'
                  ? 'success'
                  : tool.state === 'interrupted'
                    ? 'cancelled'
                    : 'error',
            images: tool.assets,
          }
          if (terminal) toolEntries.set(tool, { state: tool.state, result: tool.result, entry })
          return entry
        }),
      ]
    })
  })
  const contextUsage = computed(() =>
    contextInfo.value
      ? t('ai.contextUsage', {
          tokens: contextInfo.value.estimated.toLocaleString(),
          budget: contextInfo.value.contextWindow.toLocaleString(),
          images: contextInfo.value.images,
        })
      : ''
  )
  const requestWarnings = computed(() => {
    const activeWarnings = progress.value?.diagnostics?.warnings
    return (records.value?.conversation.lastRun?.warnings ?? activeWarnings ?? []).map(
      (warning) => {
        if (warning.type === 'other') return warning.message
        if (warning.type === 'deprecated') return `${warning.setting}: ${warning.message}`
        return [
          t(warning.type === 'unsupported' ? 'ai.warningUnsupported' : 'ai.warningCompatibility', {
            feature: warning.feature,
          }),
          warning.details,
        ]
          .filter(Boolean)
          .join('\n')
      }
    )
  })
  const requestStatus = computed(() => {
    const current = progress.value
    if (!current) return ''
    return t('ai.requestProgress', {
      phase: t(
        `ai.phases.${current.phase === 'summarizing' ? 'summarizing' : current.phase === 'tools' ? 'tools' : (current.diagnostics?.phase ?? 'connecting')}`
      ),
      seconds: Math.max(0, Math.floor((now.value - current.startedAt) / 1000)),
    })
  })
  function explain(cause: unknown) {
    const code = failure(cause).code
    if (code === 'storage') storageState.value = 'error'
    error.value =
      code === 'cancelled'
        ? t('ai.stopped')
        : t(`ai.errors.${code === 'stale_snapshot' ? 'stale' : code}`)
  }
  async function restoreContextInfo(loaded: ConversationRecords | null) {
    if (loaded) {
      try {
        const reqs = await repository.requests(loaded.conversation.id)
        const lastReq = reqs.at(-1)
        if (lastReq) {
          const imageCount = loaded.tools.reduce((sum, t) => sum + (t.assets?.length ?? 0), 0)
          contextInfo.value = {
            estimated: lastReq.estimatedTokens,
            contextWindow: lastReq.policy.contextWindow,
            usableContextWindow: lastReq.policy.usableContextWindow,
            autoCompactTokenLimit: lastReq.policy.autoCompactTokenLimit,
            configuredMaxOutputTokens: lastReq.policy.maxTokens,
            requestMaxOutputTokens: lastReq.maxOutputTokens,
            images: imageCount,
            compacted: Boolean(loaded.checkpoint),
            actual:
              lastReq.diagnostics.usage?.totalTokens ?? lastReq.diagnostics.usage?.promptTokens,
          }
          return
        }
      } catch {
        // Ignore and fallback
      }
    }
    try {
      const { policy } = resolveAiConfig(settings.ai)
      contextInfo.value = {
        estimated: 0,
        contextWindow: policy.contextWindow,
        usableContextWindow: policy.usableContextWindow,
        autoCompactTokenLimit: policy.autoCompactTokenLimit,
        configuredMaxOutputTokens: policy.maxTokens,
        requestMaxOutputTokens: policy.maxTokens,
        images: 0,
        compacted: false,
      }
    } catch {
      contextInfo.value = undefined
    }
  }

  async function navigate(id?: string, fresh = false) {
    const mine = ++navigation
    phase.value = 'loading'
    error.value = ''
    await stop()
    if (mine !== navigation || disposed) return
    records.value = null
    visibleMessages.value = 50
    storageState.value = 'idle'
    try {
      const listed = await repository.list()
      if (mine !== navigation || disposed) return
      sessions.value = listed
      const target = fresh ? '' : (id ?? (activeConversation.value || sessions.value[0]?.id))
      const loaded = target ? await repository.load(target) : null
      if (mine !== navigation || disposed) return
      records.value = loaded
      activeConversation.value = loaded?.conversation.id ?? ''
      storageState.value = loaded ? 'saved' : 'idle'
      await restoreContextInfo(loaded)
    } catch (cause) {
      if (mine === navigation) explain(cause)
    } finally {
      if (mine === navigation && !disposed) phase.value = 'idle'
    }
  }
  void navigate()
  watch(
    () => options.enabled.value,
    (enabled) => {
      if (!enabled) void stop()
    }
  )
  watch(
    () =>
      JSON.stringify([
        resolveConnection(settings.ai),
        settings.ai.contextWindow,
        settings.ai.maxTokens,
        settings.ai.imageBudgetMiB,
      ]),
    () => {
      void stop()
      if (!records.value) {
        void restoreContextInfo(null)
      }
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => {
    disposed = true
    navigation++
    void stop()
    pause()
  })

  async function send(text: string, continueOnly = false) {
    text = text.trim()
    if (phase.value !== 'idle' || !options.enabled.value || (!text && !continueOnly)) return false
    if (storageState.value === 'error') {
      error.value = t('ai.errors.storage')
      return false
    }
    let config: ReturnType<typeof resolveAiConfig>
    try {
      config = resolveAiConfig(settings.ai)
    } catch {
      error.value = t('ai.errors.settings')
      return false
    }
    const mine = navigation
    const runContext = editorHost.host.context()
    const preparation = new AbortController()
    admission = preparation
    phase.value = 'running'
    error.value = ''
    try {
      if (!records.value) {
        const conversation = await repository.create(text.slice(0, 60) || t('ai.title'))
        if (mine !== navigation || disposed) return false
        records.value = {
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
        activeConversation.value = conversation.id
        sessions.value = [conversation, ...sessions.value]
        storageState.value = 'saved'
      }
      if (preparation.signal.aborted) return false
      const current = records.value
      const { connection, policy } = config
      secrets.add(connection.apiKey)
      Object.values(connection.headers ?? {}).forEach((value) => secrets.add(value))
      startClock()
      await runner.run({
        records: current,
        scene: editorHost.host,
        context: runContext,
        language: locale.value,
        connection,
        policy,
        system: systemPrompt(locale.value),
        text: continueOnly ? undefined : text,
        onChange(data) {
          if (disposed || mine !== navigation) return
          if (records.value?.conversation.id === data.conversation.id) {
            records.value = data
            triggerRef(records)
            storageState.value = 'saved'
          }
          sessions.value = [
            data.conversation,
            ...sessions.value.filter((entry) => entry.id !== data.conversation.id),
          ]
        },
        onProgress(next) {
          if (mine !== navigation || disposed) return
          progress.value = next
          if (next?.context) contextInfo.value = next.context
        },
      })
    } catch (cause) {
      if (mine === navigation && !disposed) {
        if (cause instanceof Error && cause.name === 'SceneAnalysisError')
          error.value = t('ai.errors.scope')
        else explain(cause)
      }
    } finally {
      if (admission === preparation) admission = undefined
      if (mine === navigation && !disposed) {
        pause()
        phase.value = 'idle'
        progress.value = null
      }
    }
    return true
  }
  async function deleteSession() {
    const current = records.value?.conversation
    if (!current) return
    const mine = navigation
    phase.value = 'loading'
    try {
      await stop()
      await repository.remove(current)
      if (mine === navigation && !disposed) await navigate(undefined, true)
    } catch (cause) {
      if (mine === navigation && !disposed) {
        explain(cause)
        phase.value = 'idle'
      }
    }
  }
  async function acknowledgeUncertain() {
    if (!records.value || phase.value !== 'idle' || !uncertain.value.length) return
    const current = records.value
    const mine = navigation
    phase.value = 'loading'
    try {
      const next = await repository.append(current.conversation, {
        role: 'user',
        content: t('ai.acknowledgeMessage'),
        state: 'complete',
        runId: crypto.randomUUID(),
        toolIds: [],
        acknowledges: uncertain.value.map((tool) => tool.id),
      })
      current.conversation = next.conversation
      current.messages.push(next.message)
      if (mine === navigation && !disposed) {
        triggerRef(records)
        error.value = ''
      }
    } catch (cause) {
      if (mine === navigation && !disposed) explain(cause)
    } finally {
      if (mine === navigation && !disposed) phase.value = 'idle'
    }
  }
  return {
    entries,
    sessions,
    sessionId,
    isRunning,
    isLoading,
    error,
    storageState,
    contextUsage,
    contextInfo,
    requestStatus,
    requestWarnings,
    interrupted,
    uncertain,
    hasOlder: computed(() => (records.value?.messages.length ?? 0) > visibleMessages.value),
    loadOlder: () => {
      visibleMessages.value += 50
    },
    compacted: computed(() => Boolean(records.value?.checkpoint)),
    canExportTrace: computed(
      () => Boolean(records.value?.messages.length) && phase.value === 'idle'
    ),
    send,
    resume: () => send('', true),
    stop,
    reset: () => navigate(undefined, true),
    openSession: (id: string) => navigate(id),
    deleteSession,
    acknowledgeUncertain,
    exportTrace: async (includeImages = false) =>
      records.value
        ? exportConversation(repository, records.value, includeImages, [...secrets])
        : null,
    loadImage: async (id: string) => {
      const asset = await repository.read<AssetRecord>(id)
      return asset && asset.conversationId === records.value?.conversation.id
        ? asset.blob
        : undefined
    },
  }
}

import { computed, onScopeDispose, shallowRef, triggerRef, watch, type Ref } from 'vue'
import { useLocalStorage, useTimestamp } from '@vueuse/core'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveConnection } from '@/lib/ai/connection'
import { resolveAiConfig } from '@/lib/ai/context'
import { useAiEditorHost } from './useAiEditorHost'
import { useEditorSelection } from '@/composables/editor/useEditorSelection'
import { createArtifacts } from '@/lib/ai/artifacts'
import { useI18n } from '@/composables/useI18n'
import { createConversationRepository, type ConversationRepository } from '@/lib/ai/repository'
import { createAgentRunner, unresolvedEdits, type RunProgress } from '@/lib/ai/runner'
import { systemPrompt } from '@/lib/ai/prompts'
import { exportConversation } from '@/lib/ai/diagnostics'
import {
  failure,
  messageText,
  type ArtifactRecord,
  type AssetRecord,
  type Conversation,
  type ConversationRecords,
} from '@/lib/ai/types'
import type { AnalysisCaptureProvider } from '@/lib/sceneAnalysis/images'
import type { ChatEntry } from './chatContext'

export function useAiChat(options: {
  enabled: Readonly<Ref<boolean>>
  getCaptureProvider: () => AnalysisCaptureProvider | null
  repository?: ConversationRepository
}) {
  const editor = useEditorStore(),
    settings = useSettingsStore()
  const { t, locale } = useI18n()
  const repository = options.repository ?? createConversationRepository()
  const runner = createAgentRunner(repository)
  const editorHost = useAiEditorHost({ getCaptureProvider: options.getCaptureProvider })
  const editorSelection = useEditorSelection()
  const records = shallowRef<ConversationRecords | null>(null)
  const sessions = shallowRef<Conversation[]>([])
  const phase = shallowRef<'idle' | 'loading' | 'running'>('idle')
  const error = shallowRef('')
  const storageState = shallowRef<'idle' | 'saved' | 'error'>('idle')
  const progress = shallowRef<RunProgress | null>(null)
  const contextInfo = shallowRef<RunProgress['context']>()
  const visibleMessages = shallowRef(50)
  const activeByScheme = useLocalStorage<Record<string, string>>('buildingmomo_ai_active_v3', {})
  const secrets = new Set<string>()
  const {
    timestamp: now,
    pause,
    resume: startClock,
  } = useTimestamp({ interval: 1000, controls: true, immediate: false })
  let navigation = 0,
    disposed = false
  let admission: AbortController | undefined
  let sceneInterrupted = false
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
  const entries = computed<ChatEntry[]>(() => {
    const data = records.value
    if (!data) return []
    const byId = new Map(data.tools.map((tool) => [tool.id, tool]))
    const references = (refs?: string[]) =>
      refs
        ?.map((ref) => data.artifacts.find((a) => a.ref === ref))
        .filter((a): a is ArtifactRecord => Boolean(a))
    return data.messages.slice(-visibleMessages.value).flatMap((message) => {
      const row: ChatEntry = {
        id: message.id,
        role: message.role,
        text: messageText(message),
        reasoning: messageText(message, 'reasoning'),
        references: references(message.references),
        state:
          message.state === 'streaming'
            ? 'running'
            : message.state === 'interrupted'
              ? 'cancelled'
              : 'success',
      }
      return [
        row,
        ...message.toolIds.map((id): ChatEntry => {
          const tool = byId.get(id)!
          const organized =
            tool.name === 'apply' && tool.result?.ok
              ? (tool.result.data as {
                  regroupedItemCount: number
                  groups: unknown[]
                  collections: unknown[]
                })
              : null
          return {
            id,
            role: 'tool',
            toolName: tool.name,
            text: organized
              ? t('ai.organized', {
                  count: organized.regroupedItemCount,
                  groups: organized.groups.length,
                  collections: organized.collections.length,
                })
              : (tool.result?.error?.message ?? ''),
            state:
              progress.value?.toolId === id && ['requested', 'prepared'].includes(tool.state)
                ? 'running'
                : tool.state === 'succeeded'
                  ? 'success'
                  : tool.state === 'interrupted'
                    ? 'cancelled'
                    : 'error',
            images: tool.assets,
            references: references(tool.artifactIds),
          }
        }),
      ]
    })
  })
  const contextUsage = computed(() =>
    contextInfo.value
      ? t(contextInfo.value.actual ? 'ai.contextActual' : 'ai.contextUsage', {
          tokens: (contextInfo.value.actual ?? contextInfo.value.estimated).toLocaleString(),
          budget: contextInfo.value.budget.toLocaleString(),
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
  async function navigate(id?: string, fresh = false) {
    const mine = ++navigation
    phase.value = 'loading'
    error.value = ''
    await stop()
    if (mine !== navigation || disposed) return
    records.value = null
    visibleMessages.value = 50
    contextInfo.value = undefined
    storageState.value = 'idle'
    const schemeId = editor.activeScheme?.id
    try {
      if (!schemeId) {
        sessions.value = []
        return
      }
      const listed = await repository.list(schemeId)
      if (mine !== navigation || disposed) return
      sessions.value = listed
      const target = fresh ? '' : (id ?? activeByScheme.value[schemeId] ?? sessions.value[0]?.id)
      const loaded = target ? await repository.load(schemeId, target) : null
      if (mine !== navigation || editor.activeScheme?.id !== schemeId || disposed) return
      records.value = loaded
      activeByScheme.value = { ...activeByScheme.value, [schemeId]: loaded?.conversation.id ?? '' }
      storageState.value = loaded ? 'saved' : 'idle'
    } catch (cause) {
      if (mine === navigation) explain(cause)
    } finally {
      if (mine === navigation && !disposed) phase.value = 'idle'
    }
  }
  watch(
    () => editor.activeScheme?.id,
    () => {
      void navigate()
    },
    { immediate: true, flush: 'sync' }
  )
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
    },
    { flush: 'sync' }
  )
  watch(
    () => (editor.activeScheme ? editorHost.host.current().version : ''),
    () => {
      if (isRunning.value && !editorHost.writing) {
        sceneInterrupted = true
        error.value = t('ai.errors.stale')
        void stop()
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
    if (
      phase.value !== 'idle' ||
      !options.enabled.value ||
      !editor.activeScheme ||
      (!text && !continueOnly)
    )
      return false
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
    const mine = navigation,
      scheme = editor.activeScheme
    const preparation = new AbortController()
    admission = preparation
    phase.value = 'running'
    error.value = ''
    sceneInterrupted = false
    contextInfo.value = undefined
    try {
      if (!records.value) {
        const conversation = await repository.create(scheme.id, text.slice(0, 60) || t('ai.title'))
        if (mine !== navigation || disposed) return false
        records.value = { conversation, messages: [], tools: [], artifacts: [] }
        activeByScheme.value = { ...activeByScheme.value, [scheme.id]: conversation.id }
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
          if (editor.activeScheme?.id === data.conversation.schemeId)
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
        if (sceneInterrupted) error.value = t('ai.errors.stale')
        else if (cause instanceof Error && cause.name === 'SceneAnalysisError')
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
    readReference: async (ref: string) => {
      const current = records.value
      if (!current) return null
      const store = createArtifacts(current, repository),
        a = store.get(ref)
      let value = await store.data(a)
      if (records.value?.conversation.id !== current.conversation.id) return null
      if (a.kind === 'set') {
        try {
          value =
            a.count === 0
              ? []
              : editorHost.host.snapshot(await store.members(a.ref)).items.map((i) => i.instanceId)
        } catch {
          value = { count: a.count, status: t('ai.referenceUnavailable') }
        }
      }
      const producer = current.tools.find((t) => t.id === a.source?.toolId)
      if (records.value?.conversation.id !== current.conversation.id) return null
      return {
        reference: a,
        value,
        current: a.revision === editorHost.host.current().version,
        code: producer?.name === 'compute' ? (producer.input as { code: string }).code : undefined,
      }
    },
    selectReference: async (ref: string) => {
      const current = records.value
      if (!current || phase.value === 'loading') return false
      const store = createArtifacts(current, repository),
        a = store.get(ref)
      const members = await store.members(ref)
      if (
        records.value?.conversation.id !== current.conversation.id ||
        editor.activeScheme?.id !== a.schemeId
      )
        return false
      const targets = editorSelection.resolveSelectionTargets(members, { skipGroupExpansion: true })
      if (targets.size !== members.length) return false
      editorSelection.updateSelection(members, false, { skipGroupExpansion: true })
      return true
    },
    loadImage: async (id: string) => {
      const asset = await repository.read<AssetRecord>(id)
      return asset && asset.conversationId === records.value?.conversation.id
        ? asset.blob
        : undefined
    },
  }
}

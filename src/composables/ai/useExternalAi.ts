import { computed, onScopeDispose, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue'
import { useDesktopStore } from '@/stores/desktopStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/composables/useI18n'
import { createConversationRepository } from '@/lib/ai/repository'
import { createExternalWorkbench } from '@/lib/ai/externalWorkbench'
import { createMcpHandler, desktopAiProtocol, type McpHttpRequest } from '@/lib/ai/mcp'
import { unresolvedEdits } from '@/lib/ai/execution'
import {
  failure,
  type AssetRecord,
  type Conversation,
  type ConversationRecords,
} from '@/lib/ai/types'
import type { AnalysisCaptureProvider } from '@/lib/sceneAnalysis/images'
import { useAiEditorHost } from './useAiEditorHost'

export const externalAiKey: InjectionKey<ReturnType<typeof useExternalAi>> = Symbol('externalAi')

export function useExternalAi(options: {
  enabled: Readonly<Ref<boolean>>
  getCaptureProvider: () => AnalysisCaptureProvider | null
}) {
  const desktop = useDesktopStore()
  const settings = useSettingsStore()
  const { t, locale } = useI18n()
  const repository = createConversationRepository()
  const { host } = useAiEditorHost({ getCaptureProvider: options.getCaptureProvider })
  const sessions = shallowRef<Conversation[]>([])
  const selected = shallowRef<ConversationRecords | null>(null)
  const enabled = ref(false),
    configuring = ref(false),
    running = ref(false)
  const error = ref(''),
    nativeError = ref('')
  const port = computed({
    get: () => settings.ai.externalPort,
    set: (value: number) => {
      settings.ai.externalPort = value
    },
  })
  const supported = computed(
    () => desktop.isDesktop && desktop.status.aiProtocol === desktopAiProtocol
  )
  const epoch = crypto.randomUUID()
  const requests = new Map<string, AbortController>()
  const executions = new Set<string>()
  let navigation = 0,
    disposed = false
  const update = (records: ConversationRecords) => {
    if (disposed) return
    sessions.value = [
      records.conversation,
      ...sessions.value.filter((s) => s.id !== records.conversation.id),
    ]
    if (!selected.value || selected.value.conversation.id === records.conversation.id)
      selected.value = { ...records }
  }
  const workbench = createExternalWorkbench({ repository, host, onChange: update })
  const handle = createMcpHandler({
    workbench,
    repository,
    isReady: () => enabled.value && supported.value && options.enabled.value && !disposed,
    language: () => locale.value,
  })
  const webview = typeof window === 'undefined' ? undefined : window.chrome?.webview
  const send = (message: Record<string, unknown>) =>
    webview?.postMessage({ ...message, protocol: desktopAiProtocol, epoch })
  const stop = async () => {
    requests.forEach((controller) => controller.abort())
    await workbench.stop()
  }
  async function receive(event: MessageEvent) {
    const data = event.data
    if (!data || data.protocol !== desktopAiProtocol || data.epoch !== epoch || disposed) return
    if (data.type === 'mcpStatus') {
      enabled.value = Boolean(data.enabled)
      configuring.value = false
      nativeError.value = String(data.error ?? '')
      if (!enabled.value) void stop()
    } else if (data.type === 'mcpCancel') requests.get(data.requestId)?.abort()
    else if (
      data.type === 'mcpRequest' &&
      typeof data.requestId === 'string' &&
      !requests.has(data.requestId)
    ) {
      const controller = new AbortController()
      requests.set(data.requestId, controller)
      const request = data.request as McpHttpRequest
      const executing =
        request?.body &&
        typeof request.body === 'object' &&
        'method' in request.body &&
        request.body.method === 'tools/call'
      if (executing) {
        executions.add(data.requestId)
        running.value = true
      }
      try {
        const response = await handle(
          { ...request, protocolVersion: request.protocolVersion || undefined },
          controller.signal
        )
        if (!disposed) send({ type: 'mcpResponse', requestId: data.requestId, response })
      } catch {
        if (!disposed)
          send({
            type: 'mcpResponse',
            requestId: data.requestId,
            response: {
              status: 500,
              body: {
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: -32603,
                  message: 'Execution could not be recorded. Inspect BuildingMomo before retrying.',
                },
              },
            },
          })
      } finally {
        requests.delete(data.requestId)
        executions.delete(data.requestId)
        running.value = executions.size > 0
      }
    }
  }
  const listener = (event: MessageEvent) => {
    void receive(event)
  }
  webview?.addEventListener('message', listener)
  watch(
    [supported, () => options.enabled.value],
    () => {
      enabled.value = false
      configuring.value = false
      void stop()
      if (supported.value) send({ type: 'mcpHello', allowed: options.enabled.value })
    },
    { immediate: true, flush: 'sync' }
  )
  onScopeDispose(() => {
    disposed = true
    navigation++
    send({ type: 'mcpConfigure', enabled: false })
    webview?.removeEventListener('message', listener)
    void stop()
  })
  async function loadContext(id: string) {
    const mine = ++navigation
    try {
      const records = await workbench.load(id)
      if (mine === navigation && !disposed) {
        selected.value = { ...records }
        error.value = ''
      }
    } catch (cause) {
      error.value = failure(cause).code
    }
  }
  async function refresh() {
    try {
      const listed = (await repository.list()).filter((entry) => entry.external)
      if (disposed) return
      sessions.value = listed
      if (!selected.value && sessions.value[0]) await loadContext(sessions.value[0].id)
    } catch (cause) {
      error.value = failure(cause).code
    }
  }
  void refresh()
  return {
    supported,
    enabled,
    configuring,
    running,
    port,
    error,
    nativeError,
    sessions,
    selected,
    uncertain: computed(() => (selected.value ? unresolvedEdits(selected.value) : [])),
    url: computed(() => `http://127.0.0.1:${port.value}/mcp`),
    connectionConfigs: computed(() => {
      const url = `http://127.0.0.1:${port.value}/mcp`
      return {
        chatgpt: `[mcp_servers.buildingmomo]\nurl = "${url}"\ntool_timeout_sec = 75\n`,
        deepseek: `- id: mcp-buildingmomo\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: buildingmomo\n    transport: streamable-http\n    url: ${url}\n    toolCallTimeoutMs: 75000\n`,
        json: JSON.stringify({ mcpServers: { buildingmomo: { type: 'http', url } } }, null, 2),
      }
    }),
    configure(value: boolean) {
      if (!supported.value || !options.enabled.value) return
      const nextPort = Number(port.value)
      if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
        nativeError.value = 'invalid_port'
        return
      }
      port.value = nextPort
      configuring.value = true
      nativeError.value = ''
      if (!value) void stop()
      send({ type: 'mcpConfigure', enabled: value, port: port.value })
    },
    stop,
    loadContext,
    async newContext() {
      try {
        selected.value = { ...(await workbench.createContext()) }
        error.value = ''
      } catch (cause) {
        error.value = failure(cause).code
      }
    },
    async removeContext() {
      if (!selected.value) return
      try {
        await workbench.remove(selected.value.conversation.id)
        navigation++
        selected.value = null
        await refresh()
      } catch (cause) {
        error.value = failure(cause).code
      }
    },
    async acknowledge() {
      if (!selected.value) return
      try {
        await workbench.acknowledge(selected.value.conversation.id, t('ai.acknowledgeMessage'))
        error.value = ''
      } catch (cause) {
        error.value = failure(cause).code
      }
    },
    async loadImage(id: string) {
      const image = await repository.read<AssetRecord>(id)
      return image && image.conversationId === selected.value?.conversation.id
        ? image.blob
        : undefined
    },
  }
}

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp, effectScope, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useExternalAi, externalAiKey } from '@/composables/ai/useExternalAi'
import { useDesktopStore } from '@/stores/desktopStore'
import { useEditorStore } from '@/stores/editorStore'
import { createConversationRepository } from '@/lib/ai/repository'
import SidebarExternalAI from '@/components/ai/SidebarExternalAI.vue'
import { makeAppItem } from '../../fixtures/item'

vi.mock('@/lib/ai/scriptClient', async () => {
  const { evaluateScript } = await import('@/lib/ai/scriptRuntime')
  return {
    runScript: (code: string, values: any, call: any, signal: AbortSignal) => {
      if (code === '__wait__')
        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () =>
              resolve({ ok: false, logs: [], error: { code: 'cancelled', message: 'Stopped' } }),
            { once: true }
          )
        })
      return evaluateScript(code, values, call)
    },
  }
})
vi.mock('@vueuse/core', async (original) => {
  const actual = await original<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useLocalStorage: (key: string, value: unknown, options?: object) =>
      actual.useStorage(key, value, globalThis.localStorage, options),
  }
})
vi.mock('@/composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('zh') }),
}))

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  setActivePinia(createPinia())
  const repository = createConversationRepository()
  for (const conversation of await repository.list()) await repository.remove(conversation)
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function setup(protocol = 1) {
  const sent: any[] = []
  const listeners = new Set<(event: MessageEvent) => void>()
  vi.stubGlobal('window', {
    chrome: {
      webview: {
        postMessage: (message: unknown) => sent.push(message),
        addEventListener: (_type: string, callback: (event: MessageEvent) => void) =>
          listeners.add(callback),
        removeEventListener: (_type: string, callback: (event: MessageEvent) => void) =>
          listeners.delete(callback),
      },
    },
  })
  const desktop = useDesktopStore()
  desktop.status.isDesktop = true
  desktop.status.aiProtocol = protocol
  const editor = useEditorStore()
  editor.createScheme('House')
  editor.activeScheme!.items.value = [makeAppItem({ internalId: 'a' })]
  editor.activeScheme!.selectedItemIds.value = new Set(['a'])
  editor.triggerSceneUpdate()
  const allowed = ref(true)
  const scope = effectScope()
  scopes.push(scope)
  const service = scope.run(() =>
    useExternalAi({ enabled: allowed, getCaptureProvider: () => null })
  )!
  await nextTick()
  const epoch = sent.find((message) => message.type === 'mcpHello')?.epoch
  const emit = (data: Record<string, unknown>) =>
    listeners.forEach((callback) =>
      callback({ data: { epoch, protocol: 1, ...data } } as MessageEvent)
    )
  const call = async (requestId: string, code: string, contextId?: string) => {
    emit({
      type: 'mcpRequest',
      requestId,
      request: {
        protocolVersion: '2025-11-25',
        body: {
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: { name: 'execute_js', arguments: { code, ...(contextId ? { contextId } : {}) } },
        },
      },
    })
    await vi.waitFor(() =>
      expect(
        sent.some((message) => message.type === 'mcpResponse' && message.requestId === requestId)
      ).toBe(true)
    )
    return sent.find((message) => message.type === 'mcpResponse' && message.requestId === requestId)
      .response
  }
  return { service, sent, emit, call, allowed, listeners, scope }
}

it('handshakes without model configuration and configures a URL-only connection', async () => {
  const f = await setup()
  expect(f.sent[0]).toMatchObject({ type: 'mcpHello', protocol: 1, allowed: true })
  f.service.port.value = 12
  f.service.configure(true)
  expect(f.service.nativeError.value).toBe('invalid_port')
  f.service.port.value = 50725
  f.service.configure(true)
  const configuration = f.sent.at(-1)
  expect(configuration).toEqual({
    type: 'mcpConfigure',
    enabled: true,
    port: 50725,
    protocol: 1,
    epoch: expect.any(String),
  })
  f.emit({ type: 'mcpStatus', enabled: true, error: '' })
  expect(f.service.enabled.value).toBe(true)
  f.service.configure(false)
  f.emit({ type: 'mcpStatus', enabled: false, error: '' })
  f.service.configure(true)
  expect(f.sent.at(-1)).toEqual(configuration)
  expect(localStorage.getItem('buildingmomo_mcp_token')).toBeNull()
  expect(f.service.connectionConfigs.value.chatgpt).toContain('url = "http://127.0.0.1:50725/mcp"')
  expect(f.service.connectionConfigs.value.deepseek).toContain('transport: streamable-http')
  expect(JSON.parse(f.service.connectionConfigs.value.json)).toEqual({
    mcpServers: { buildingmomo: { type: 'http', url: 'http://127.0.0.1:50725/mcp' } },
  })
  for (const config of Object.values(f.service.connectionConfigs.value))
    expect(config).not.toMatch(/Authorization|Bearer|headers/)
})

it('ignores stale page messages and disables the service when authorization is lost', async () => {
  const f = await setup()
  f.emit({ type: 'mcpStatus', epoch: 'old-page', enabled: true })
  expect(f.service.enabled.value).toBe(false)
  f.emit({ type: 'mcpStatus', enabled: true })
  f.allowed.value = false
  expect(f.service.enabled.value).toBe(false)
  expect(f.sent.at(-1)).toMatchObject({ type: 'mcpHello', allowed: false })
  f.scope.stop()
  expect(f.listeners.size).toBe(0)
})

it('routes two chat contexts independently and records actual tool calls without assistant messages', async () => {
  const f = await setup()
  f.emit({ type: 'mcpStatus', enabled: true })
  const a = await f.call('a', 'vars.name="A";vars.items=await api.selection()')
  const b = await f.call('b', 'vars.name="B"')
  const contextId = a.body.result.structuredContent.contextId
  expect(contextId).not.toBe(b.body.result.structuredContent.contextId)
  const next = await f.call('c', 'console.log(vars.name,vars.items.length)', contextId)
  expect(next.body.result.structuredContent.data.logs).toEqual([['A', 1]])
  expect(f.service.running.value).toBe(false)
  await f.service.loadContext(contextId)
  expect(f.service.selected.value?.messages).toEqual([])
  expect(f.service.selected.value?.tools).toHaveLength(2)
})

it('stops a live call and returns its recorded cancellation instead of leaving HTTP waiting', async () => {
  const f = await setup()
  f.emit({ type: 'mcpStatus', enabled: true })
  const pending = f.call('wait', '__wait__')
  await vi.waitFor(() => expect(f.service.selected.value?.tools.at(-1)?.state).toBe('requested'))
  f.emit({ type: 'mcpCancel', requestId: 'wrong' })
  expect(f.service.running.value).toBe(true)
  await f.service.stop()
  expect(await pending).toMatchObject({
    body: { result: { isError: true, structuredContent: { error: { code: 'cancelled' } } } },
  })
  expect(f.service.running.value).toBe(false)
})

it('renders the actual external panel and provides a clear upgrade state for an old shell', async () => {
  const f = await setup(0)
  expect(f.sent).toEqual([])
  const app = createSSRApp({ render: () => h(SidebarExternalAI) })
  app.provide(externalAiKey, f.service)
  const html = await renderToString(app)
  expect(html).toContain('ai.external.upgrade')
  expect(html).toContain('disabled')
})

it('renders task names and dates with technical IDs collapsed into details', async () => {
  const f = await setup()
  f.emit({ type: 'mcpStatus', enabled: true })
  await f.call('read', 'console.log(42)')
  const conversation = f.service.selected.value!.conversation
  useEditorStore().getSchemeById(conversation.external!.schemeId!)!.name.value = 'Garden'
  const app = createSSRApp({ render: () => h(SidebarExternalAI) })
  app.provide(externalAiKey, f.service)
  const html = await renderToString(app)
  expect(html).toContain('ai.external.statusEnabled')
  expect(html).toContain('ai.toolExecuted')
  expect(html).toContain('House · ')
})

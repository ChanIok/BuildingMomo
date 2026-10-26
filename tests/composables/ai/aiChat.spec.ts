import 'fake-indexeddb/auto'
import { createStore } from 'idb-keyval'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, effectScope, nextTick, ref } from 'vue'
import { useAiChat } from '@/composables/ai/useAiChat'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveConnection, setModelSettings } from '@/lib/ai/connection'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { createConversationRepository } from '@/lib/ai/repository'
import type { AnalysisCaptureProvider } from '@/lib/sceneAnalysis/images'
import { makeAppItem } from '../../fixtures/item'

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
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
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  setActivePinia(createPinia())
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function setup(provider: AnalysisCaptureProvider | null = null, enabled = ref(true)) {
  const editor = useEditorStore()
  editor.createScheme('House')
  const scheme = editor.activeScheme!
  scheme.items.value = ['a', 'b', 'outside'].map((id, index) =>
    makeAppItem({ internalId: id, instanceId: index + 1000 })
  )
  scheme.selectedItemIds.value = new Set(['a', 'b'])
  editor.triggerSceneUpdate()
  const settings = useSettingsStore().ai
  settings.connection = {
    provider: 'compatible' as const,
    apiUrl: 'https://example.test/v1',
    model: 'chosen',
  }
  settings.apiKey = 'private-key'
  const repository = createConversationRepository(
    createStore(`chat-${crypto.randomUUID()}`, 'records')
  )
  async function mount() {
    const scope = effectScope()
    scopes.push(scope)
    const chat = scope.run(() =>
      useAiChat({ enabled, getCaptureProvider: () => provider, repository })
    )!
    await vi.waitFor(() => expect(chat.isLoading.value).toBe(false))
    return { chat, scope }
  }
  return { editor, scheme, settings, enabled, repository, mount, ...(await mount()) }
}
function stream(delta: unknown, finish = 'tool_calls') {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
function tool(name: string, parameters: unknown) {
  return stream({
    tool_calls: [
      {
        index: 0,
        id: crypto.randomUUID(),
        type: 'function',
        function: { name, arguments: JSON.stringify(parameters) },
      },
    ],
  })
}
const body = (init?: RequestInit) => JSON.parse(init?.body as string)
const lastTool = (request: { messages: { role: string; content: unknown }[] }) =>
  JSON.parse(String(request.messages.findLast((m) => m.role === 'tool')?.content))
function pendingFetch() {
  return vi.fn(
    (_url, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Stopped', 'AbortError')),
          { once: true }
        )
      })
  )
}

function inspectThenReply() {
  let requests = 0
  return vi.fn(async () =>
    requests++ % 2 === 0
      ? tool('inspect', { ref: 'selection' })
      : stream({ content: 'Reply' }, 'stop')
  )
}

it('stops on access revocation and blocks new requests while preserving the session and connection for reauthorization', async () => {
  vi.stubEnv('VITE_ENABLE_SECURE_MODE', 'true')
  const settings = useSettingsStore()
  settings.isAuthenticated = true
  const s = await setup(
    null,
    computed(() => settings.canUseExperimentalFeatures)
  )
  const fetcher = pendingFetch()
  vi.stubGlobal('fetch', fetcher)
  const run = s.chat.send('First')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  const session = s.chat.sessionId.value
  settings.isAuthenticated = false
  await run
  expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true)
  expect(await s.chat.send('Blocked')).toBe(false)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(s.chat.sessionId.value).toBe(session)
  expect(settings.ai.apiKey).toBe('private-key')
  const reply = vi.fn(async () => stream({ content: 'Reply' }, 'stop'))
  vi.stubGlobal('fetch', reply)
  settings.isAuthenticated = true
  expect(reply).not.toHaveBeenCalled()
  expect(await s.chat.send('Continue')).toBe(true)
  expect(reply).toHaveBeenCalledOnce()
  expect(s.chat.sessionId.value).toBe(session)
  expect(s.chat.entries.value.some((entry) => entry.text === 'First')).toBe(true)
})

it('captures selection at tool execution, keeps its exact members through later selection changes, and verifies Undo', async () => {
  const { chat, scheme, editor } = await setup()
  const original = scheme.items.value
  let n = 0
  const fetcher = vi.fn(async (_url, init) => {
    const request = body(init)
    if (n++ === 0) {
      expect(JSON.stringify(request)).not.toContain('[Message references]')
      expect(
        request.messages.find((message: { role: string }) => message.role === 'user').content
      ).toBe('Organize the current selection')
      expect(JSON.stringify(request.messages)).not.toContain('"position"')
      scheme.selectedItemIds.value = new Set(['b', 'outside'])
      editor.triggerSelectionUpdate()
      return tool('inspect', { ref: 'selection' })
    }
    if (n === 2) {
      expect(lastTool(request).data).toMatchObject({ ref: 'R1', count: 2 })
      scheme.selectedItemIds.value = new Set(['a'])
      editor.triggerSelectionUpdate()
      return tool('inspect', { ref: 'R1', mode: 'items' })
    }
    if (n === 3) {
      expect(lastTool(request).data.rows.map((i: { instanceId: number }) => i.instanceId)).toEqual([
        1001, 1002,
      ])
      return tool('apply', {
        collections: [],
        groups: [{ id: 'roof', name: 'Roof', collectionId: null, ref: 'R1' }],
      })
    }
    expect(lastTool(request).data.regroupedItemCount).toBe(2)
    return stream({ content: 'Done' }, 'stop')
  })
  vi.stubGlobal('fetch', fetcher)
  await chat.send('Organize the current selection')
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(scheme.items.value[0]).toBe(original[0])
  expect(chat.entries.value[0]?.references).toBeUndefined()
  expect(chat.entries.value.find((e) => e.role === 'tool')?.references?.[0]?.count).toBe(2)
  useEditorHistory().undo()
  expect(scheme.items.value).toEqual(original)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      expect(JSON.stringify(body(init))).toContain('changed_or_undone')
      return stream({ content: 'Rechecked' }, 'stop')
    })
  )
  await chat.send('Check again')
  expect(chat.entries.value.find((e) => e.text === 'Check again')?.references).toBeUndefined()
})

it('restores multiple conversations and tool-captured references without requesting the API', async () => {
  const s = await setup()
  const fetcher = inspectThenReply()
  vi.stubGlobal('fetch', fetcher)
  await s.chat.send('First')
  const first = s.chat.sessionId.value
  await s.chat.reset()
  s.scheme.selectedItemIds.value = new Set(['outside'])
  await s.chat.send('Second')
  const second = s.chat.sessionId.value
  await s.chat.openSession(first)
  expect(s.chat.entries.value.filter((e) => e.text).map((e) => e.text)).toEqual(['First', 'Reply'])
  expect(s.chat.entries.value.find((e) => e.role === 'tool')?.references?.[0]?.count).toBe(2)
  s.scope.stop()
  const restored = await s.mount()
  expect(restored.chat.sessionId.value).toBe(first)
  expect(restored.chat.sessions.value).toHaveLength(2)
  expect(await restored.chat.readReference('R1')).toMatchObject({
    value: [1000, 1001],
    current: false,
  })
  expect(fetcher).toHaveBeenCalledTimes(4)
  await restored.chat.openSession(second)
  expect(restored.chat.entries.value.find((e) => e.role === 'tool')?.references?.[0]?.count).toBe(1)
  await restored.chat.deleteSession()
  expect(restored.chat.entries.value).toEqual([])
  expect(restored.chat.sessions.value.map((c) => c.id)).toEqual([first])
})

it('round-trips DeepSeek reasoning through streaming tools, a final answer and the next user message', async () => {
  const s = await setup()
  s.settings.connection.model = 'deepseek-v4-pro'
  setModelSettings(s.settings, s.settings.connection, {
    requestBody: { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
    replayReasoning: true,
  })
  const sent: any[] = []
  const fetcher = vi.fn(async (_url, init) => {
    sent.push(body(init))
    if (sent.length === 1)
      return stream({
        reasoning_content: 'Inspect the selected parts',
        tool_calls: [
          {
            index: 0,
            id: 'inspect-1',
            type: 'function',
            function: { name: 'inspect', arguments: '{"ref":"selection"}' },
          },
        ],
      })
    return stream({ reasoning_content: 'Checked the result', content: 'Done' }, 'stop')
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await s.chat.send('Inspect')).toBe(true)
  expect(sent).toHaveLength(2)
  expect(sent[1].messages.find((m: any) => m.role === 'assistant')).toMatchObject({
    reasoning_content: 'Inspect the selected parts',
    tool_calls: [{ id: 'inspect-1' }],
  })
  expect(sent[1].messages.find((m: any) => m.role === 'tool')).toHaveProperty(
    'tool_call_id',
    'inspect-1'
  )
  expect(await s.chat.send('Continue discussing')).toBe(true)
  expect(sent).toHaveLength(3)
  expect(
    sent[2].messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.reasoning_content)
  ).toEqual(['Inspect the selected parts', 'Checked the result'])
  expect(
    sent.every(
      (r) =>
        r.reasoning_effort === 'max' &&
        r.thinking.type === 'enabled' &&
        r.max_tokens === s.settings.maxTokens
    )
  ).toBe(true)
  expect(resolveConnection(s.settings).replayReasoning).toBe(true)
})

it.each([
  'reset',
  'scheme',
  'disable',
  'dispose',
  'settings',
  'reasoning',
  'budget',
  'preferences',
  'stop',
] as const)('settles a streaming run safely on %s', async (action) => {
  const s = await setup(),
    fetcher = pendingFetch()
  vi.stubGlobal('fetch', fetcher)
  if (action === 'preferences') s.settings.contextWindow *= 2
  const run = s.chat.send('Old')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  if (action === 'reset') await s.chat.reset()
  if (action === 'scheme') s.editor.createScheme('New')
  if (action === 'disable') s.enabled.value = false
  if (action === 'dispose') s.scope.stop()
  if (action === 'settings') s.settings.connection.model = 'new-model'
  if (action === 'reasoning')
    setModelSettings(s.settings, s.settings.connection, {
      requestBody: { reasoning_effort: 'high' },
    })
  if (action === 'budget') s.settings.imageBudgetMiB = 30
  if (action === 'preferences') useSettingsStore().resetSettings()
  if (action === 'stop') await s.chat.stop()
  await nextTick()
  await run
  expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true)
  if (action !== 'dispose')
    await vi.waitFor(() => {
      expect(s.chat.isRunning.value).toBe(false)
      expect(s.chat.isLoading.value).toBe(false)
    })
  if (action === 'reset' || action === 'scheme') expect(s.chat.entries.value).toEqual([])
  const [conversation] = await s.repository.list(s.scheme.id)
  const restored = (await s.repository.load(s.scheme.id, conversation!.id))!
  expect(restored.conversation.lastRun?.state).toBe('interrupted')
  expect(restored.messages.at(-1)?.state).toBe('interrupted')
})

it('cancels admission while conversation creation is pending, before a runner exists', async () => {
  const s = await setup(),
    fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const original = s.repository.create
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.repository, 'create').mockImplementation(async (...args) => {
    await ready
    return original(...args)
  })
  const run = s.chat.send('First')
  await s.chat.stop()
  release()
  await run
  expect(fetcher).not.toHaveBeenCalled()
  expect(s.chat.isRunning.value).toBe(false)
})

it('stops external edits and keeps existing references without capturing new selection on continuation', async () => {
  const s = await setup(),
    pending = pendingFetch()
  let requests = 0
  const fetcher = vi.fn((url, init) =>
    requests++ === 0 ? Promise.resolve(tool('inspect', { ref: 'selection' })) : pending(url, init)
  )
  vi.stubGlobal('fetch', fetcher)
  const run = s.chat.send('First')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  s.scheme.items.value = s.scheme.items.value.map((item) => ({ ...item, x: 1 }))
  await run
  expect(s.chat.error.value).toBe('ai.errors.stale')
  s.scheme.selectedItemIds.value = new Set(['outside'])
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => stream({ content: 'Continued' }, 'stop'))
  )
  await s.chat.resume()
  expect(s.chat.entries.value.find((e) => e.role === 'tool')?.references?.[0]?.count).toBe(2)
  expect((await s.repository.load(s.scheme.id, s.chat.sessionId.value))?.tools).toHaveLength(1)
})

it('requires explicit acknowledgment of recovered prepared edits and never rewrites their outcome', async () => {
  const s = await setup()
  const conversation = await s.repository.create(s.scheme.id, 'Interrupted')
  const { message, conversation: meta } = await s.repository.append(conversation, {
    role: 'assistant',
    content: '',
    state: 'complete',
    runId: 'crash',
    toolIds: [`tool:${conversation.id}:0:0`],
  })
  await s.repository.save(meta, [
    {
      id: `tool:${conversation.id}:0:0`,
      conversationId: meta.id,
      messageId: message.id,
      providerCallId: 'p',
      name: 'apply',
      input: {},
      effect: 'edit',
      state: 'prepared',
      assets: [],
    },
  ])
  await s.chat.openSession(meta.id)
  expect(s.chat.uncertain.value).toHaveLength(1)
  await s.chat.acknowledgeUncertain()
  expect(s.chat.uncertain.value).toHaveLength(0)
  expect((await s.repository.load(s.scheme.id, meta.id))!.tools[0]!.state).toBe('uncertain')
})

it('rejects missing settings, permits chat without selection and redacts exported credentials', async () => {
  const s = await setup(),
    fetcher = vi.fn(async () => new Response('provider-secret', { status: 401 }))
  vi.stubGlobal('fetch', fetcher)
  s.settings.connection.model = ''
  expect(await s.chat.send('hello')).toBe(false)
  s.settings.connection.model = 'chosen'
  s.settings.apiKey = 'private-key'
  s.scheme.selectedItemIds.value = new Set()
  await s.chat.send('hello')
  expect(s.chat.error.value).toBe('ai.errors.auth')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(s.chat.entries.value[0]?.references).toBeUndefined()
  s.scheme.selectedItemIds.value = new Set(['a'])
  s.settings.connection.apiUrl += '?key=query-secret'
  await s.chat.send('hello')
  const json = (await s.chat.exportTrace())!
  for (const secret of ['private-key', 'query-secret', 'provider-secret', 'Authorization'])
    expect(json).not.toContain(secret)
  expect(JSON.parse(json).requests[0]).toMatchObject({
    endpoint: 'https://example.test/v1/chat/completions',
    diagnostics: { httpStatus: 401 },
    error: { code: 'auth' },
  })
})

it('selects an artifact exactly through selection history, without expanding its existing group', async () => {
  const s = await setup()
  s.scheme.items.value = s.scheme.items.value.map((i) => ({ ...i, groupId: 7 }))
  s.editor.triggerSceneUpdate()
  vi.stubGlobal('fetch', inspectThenReply())
  await s.chat.send('Inspect these')
  s.scheme.selectedItemIds.value = new Set(['outside'])
  const items = s.scheme.items.value,
    version = s.editor.sceneVersion
  expect(await s.chat.selectReference('R1')).toBe(true)
  expect(s.scheme.selectedItemIds.value).toEqual(new Set(['a', 'b']))
  expect(s.scheme.items.value).toBe(items)
  expect(s.editor.sceneVersion).toBe(version)
  useEditorHistory().undo()
  expect(s.scheme.selectedItemIds.value).toEqual(new Set(['outside']))
})
it('does not partially select an artifact after protection changes', async () => {
  const s = await setup()
  s.scheme.items.value = s.scheme.items.value.map((i) =>
    i.internalId === 'a' ? { ...i, groupId: 7 } : i
  )
  s.editor.triggerSceneUpdate()
  vi.stubGlobal('fetch', inspectThenReply())
  await s.chat.send('Inspect these')
  s.scheme.selectedItemIds.value = new Set(['outside'])
  s.scheme.lockedGroupIds.value = new Set([7])
  expect(await s.chat.selectReference('R1')).toBe(false)
  expect(s.scheme.selectedItemIds.value).toEqual(new Set(['outside']))
})

it('displays persisted provider warnings including deprecated settings', async () => {
  const { chat, scheme, repository } = await setup()
  const conversation = await repository.create(scheme.id, 'Warnings')
  await repository.save({
    ...conversation,
    lastRun: {
      id: 'warning-run',
      state: 'completed',
      warnings: [
        { type: 'deprecated', setting: 'old_option', message: 'Use new_option instead.' },
        { type: 'other', message: 'Provider notice' },
        { type: 'unsupported', feature: 'temperature', details: 'Not supported' },
        { type: 'compatibility', feature: 'reasoning' },
      ],
    },
  })
  await chat.openSession(conversation.id)
  expect(chat.requestWarnings.value).toEqual([
    'old_option: Use new_option instead.',
    'Provider notice',
    'ai.warningUnsupported\nNot supported',
    'ai.warningCompatibility',
  ])
})

it('returns only images belonging to the active conversation and tolerates missing assets', async () => {
  const { chat, scheme, repository } = await setup()
  await expect(chat.loadImage('missing')).resolves.toBeUndefined()
  const conversation = await repository.create(scheme.id, 'Images')
  await repository.save(conversation, [
    {
      id: 'asset:test',
      conversationId: conversation.id,
      width: 1,
      height: 1,
      bytes: 5,
      blob: new Blob(['image']),
    },
  ])
  await chat.openSession(conversation.id)
  expect(await (await chat.loadImage('asset:test'))!.text()).toBe('image')
  await expect(chat.loadImage('missing')).resolves.toBeUndefined()
  await chat.reset()
  await expect(chat.loadImage('asset:test')).resolves.toBeUndefined()
})

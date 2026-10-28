import 'fake-indexeddb/auto'
import { createStore } from 'idb-keyval'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, effectScope, nextTick, ref } from 'vue'
import { useAiChat } from '@/composables/ai/useAiChat'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorStore } from '@/stores/editorStore'
import { createConversationRepository } from '@/lib/ai/repository'
import type { AnalysisCaptureProvider } from '@/lib/sceneAnalysis/images'
import { makeAppItem } from '../../fixtures/item'

vi.mock('@/lib/ai/scriptClient', async () => {
  const { evaluateScript } = await import('@/lib/ai/scriptRuntime')
  return { runScript: (code: string, values: any, call: any) => evaluateScript(code, values, call) }
})
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

it('shares global conversations across schemes and restores persisted vars without executing code or requesting the model', async () => {
  const s = await setup()
  let count = 0
  const fetcher = vi.fn(async () =>
    count++ === 0
      ? tool('execute_js', {
          code: 'vars.selected=await api.selection();console.log(vars.selected.length)',
        })
      : stream({ content: 'Saved' }, 'stop')
  )
  vi.stubGlobal('fetch', fetcher)
  await s.chat.send('Keep this selection')
  const session = s.chat.sessionId.value
  expect(s.chat.entries.value.find((e) => e.role === 'tool')?.code).toContain('vars.selected')
  s.editor.createScheme('B')
  await nextTick()
  expect(s.chat.sessionId.value).toBe(session)
  expect(s.chat.sessions.value).toHaveLength(1)
  s.scope.stop()
  const restored = await s.mount()
  expect(restored.chat.sessionId.value).toBe(session)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect((await s.repository.load(session))?.variables.values.selected).toHaveLength(2)
  await restored.chat.reset()
  await restored.chat.send('Another conversation')
  expect(restored.chat.sessions.value).toHaveLength(2)
  await restored.chat.openSession(session)
  expect(restored.chat.entries.value.some((e) => e.text === 'Keep this selection')).toBe(true)
})
it('continues an in-flight model request while the user switches scheme or edits an unrelated scheme', async () => {
  const s = await setup()
  let release!: (response: Response) => void
  const fetcher = vi.fn(
    (_url, init) =>
      new Promise<Response>((resolve) => {
        release = resolve
      })
  )
  vi.stubGlobal('fetch', fetcher)
  const run = s.chat.send('Compare schemes')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  const session = s.chat.sessionId.value
  s.editor.createScheme('Other')
  s.editor.triggerSceneUpdate()
  await nextTick()
  expect(s.chat.isRunning.value).toBe(true)
  expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(false)
  release(stream({ content: 'Done' }, 'stop'))
  await run
  expect(s.chat.sessionId.value).toBe(session)
})
it('supports ordinary conversations without any loaded scheme', async () => {
  const s = await setup()
  s.editor.closeScheme(s.scheme.id)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => stream({ content: 'Hello' }, 'stop'))
  )
  expect(await s.chat.send('Hello')).toBe(true)
  expect(s.chat.entries.value.at(-1)?.text).toBe('Hello')
})

it('freezes the message target before asynchronous conversation creation', async () => {
  const s = await setup(),
    create = s.repository.create.bind(s.repository)
  let release!: () => void
  vi.spyOn(s.repository, 'create').mockImplementation(async (title) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return create(title)
  })
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      calls++ === 0
        ? tool('execute_js', {
            code: 'vars.selected=await api.selection();console.log(vars.selected.length)',
          })
        : stream({ content: 'Saved' }, 'stop')
    )
  )
  const sending = s.chat.send('Keep this selection')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  s.editor.createScheme('B')
  release()
  await sending
  const saved = (await s.repository.load(s.chat.sessionId.value))!
  expect(saved.variables.values.selected).toHaveLength(2)
  expect(saved.variables.references.every((r) => r.schemeId === s.scheme.id)).toBe(true)
})
it('stops on feature access revocation while preserving conversation and settings', async () => {
  const enabled = ref(true),
    s = await setup(null, enabled),
    fetcher = pendingFetch()
  vi.stubGlobal('fetch', fetcher)
  const run = s.chat.send('First')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  const session = s.chat.sessionId.value
  enabled.value = false
  await run
  expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true)
  expect(await s.chat.send('Blocked')).toBe(false)
  expect(s.chat.sessionId.value).toBe(session)
  expect(s.settings.apiKey).toBe('private-key')
})
it('deletes only the chosen conversation including vars, preserving completed scheme edits and other conversations', async () => {
  const s = await setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => stream({ content: 'Done' }, 'stop'))
  )
  await s.chat.send('First')
  const first = s.chat.sessionId.value
  await s.chat.reset()
  await s.chat.send('Second')
  await s.chat.deleteSession()
  expect(await s.repository.list()).toHaveLength(1)
  expect(await s.repository.load(first)).not.toBeNull()
  expect(s.scheme.items.value).toHaveLength(3)
})

it('formats tool details lazily once and reuses completed entries during later requests', async () => {
  const s = await setup()
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      calls++ === 0
        ? tool('execute_js', { code: 'console.log({sample:"x".repeat(100000)})' })
        : stream({ content: 'Done' }, 'stop')
    )
  )
  await s.chat.send('Inspect')
  const stringify = vi.spyOn(JSON, 'stringify')
  const entries = s.chat.entries.value
  const output = entries.find((e) => e.role === 'tool')!
  expect(output.text).toBe('')
  expect(stringify).not.toHaveBeenCalled()
  const formatted = output.output!()
  expect(formatted).toContain('x'.repeat(100000))
  expect(output.output!()).toBe(formatted)
  expect(stringify).toHaveBeenCalledOnce()
  stringify.mockRestore()

  const fetcher = pendingFetch()
  vi.stubGlobal('fetch', fetcher)
  const next = s.chat.send('Continue')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  expect(s.chat.entries.value[0]).toBe(entries[0])
  expect(s.chat.entries.value.find((e) => e.id === output.id)).toBe(output)
  await s.chat.stop()
  await next
  expect(output.output!()).toBe(formatted)
})

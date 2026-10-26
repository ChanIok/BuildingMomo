import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useAiModels } from '@/composables/ai/useAiModels'
import { AiError } from '@/lib/ai/types'
import type { AiModel, ModelConnection } from '@/lib/ai/models'
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function setup() {
  const scope = effectScope()
  scopes.push(scope)
  const draft = ref<ModelConnection | undefined>({
    provider: 'compatible',
    apiUrl: 'http://localhost:1234/v1',
    apiKey: '',
  })
  const enabled = ref(true)
  const query = vi.fn<(connection: ModelConnection, signal: AbortSignal) => Promise<AiModel[]>>()
  const discovery = scope.run(() =>
    useAiModels(
      () => draft.value,
      () => enabled.value,
      query
    )
  )!
  return { scope, draft, enabled, query, discovery }
}
it('does not query automatically or require a saved connection/model, and treats empty lists as successful', async () => {
  const s = setup()
  expect(s.query).not.toHaveBeenCalled()
  s.query.mockResolvedValue([])
  expect(await s.discovery.refresh()).toBe(true)
  expect(s.query.mock.calls[0]?.[0]).toEqual(s.draft.value)
  expect(s.discovery.state.value).toBe('ready')
  expect(s.discovery.models.value).toEqual([])
})
it.each(['key', 'url', 'provider', 'headers', 'close', 'dispose'] as const)(
  'cancels and ignores a pending response on %s',
  async (mode) => {
    const s = setup(),
      response = deferred<AiModel[]>()
    s.query.mockReturnValue(response.promise)
    const pending = s.discovery.refresh(),
      abort = s.query.mock.calls[0]![1]
    if (mode === 'key') s.draft.value!.apiKey = 'new-key'
    if (mode === 'url') s.draft.value!.apiUrl += '?route=other'
    if (mode === 'provider') s.draft.value!.provider = 'google'
    if (mode === 'headers') s.draft.value!.headers = { 'X-Auth': 'changed' }
    if (mode === 'close') s.enabled.value = false
    if (mode === 'dispose') s.scope.stop()
    expect(abort.aborted).toBe(true)
    response.resolve([{ id: 'stale', name: 'Stale' }])
    expect(await pending).toBe(false)
    expect(s.discovery.state.value).toBe('idle')
    expect(s.discovery.models.value).toEqual([])
  }
)
it('gives a newer query sole ownership, including when the old request rejects late', async () => {
  const s = setup(),
    first = deferred<AiModel[]>(),
    second = deferred<AiModel[]>()
  s.query.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const old = s.discovery.refresh(),
    latest = s.discovery.refresh()
  second.resolve([{ id: 'fresh', name: 'Fresh' }])
  expect(await latest).toBe(true)
  first.reject(new AiError('models_auth'))
  expect(await old).toBe(false)
  expect(s.discovery.models.value.map((model) => model.id)).toEqual(['fresh'])
  expect(s.discovery.error.value).toBeUndefined()
  expect(s.discovery.state.value).toBe('ready')
})
it('does not query while disabled or with invalid draft JSON, and clears an old failure when inputs change', async () => {
  const s = setup()
  s.enabled.value = false
  expect(await s.discovery.refresh()).toBe(false)
  s.enabled.value = true
  s.draft.value = undefined
  expect(await s.discovery.refresh()).toBe(false)
  expect(s.discovery.error.value).toMatchObject({ code: 'settings' })
  expect(s.query).not.toHaveBeenCalled()
  s.draft.value = { provider: 'compatible', apiUrl: 'http://localhost:1234/v1', apiKey: '' }
  expect(s.discovery.state.value).toBe('idle')
  expect(s.discovery.error.value).toBeUndefined()
})

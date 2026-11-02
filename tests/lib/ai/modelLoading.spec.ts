import { afterEach, expect, it, vi } from 'vitest'
import { createPolicy } from '@/lib/ai/context'
import { workbenchFixture } from '../../fixtures/ai'
import type { RunOptions } from '@/lib/ai/runner'

afterEach(() => {
  vi.doUnmock('@/lib/ai/model')
  vi.resetModules()
})

async function setup() {
  const fixture = await workbenchFixture()
  const { createAgentRunner } = await import('@/lib/ai/runner')
  const options: RunOptions = {
    ...fixture,
    connection: {
      provider: 'compatible',
      apiUrl: 'https://example.test/v1',
      apiKey: '',
      model: 'chosen',
    },
    policy: createPolicy(),
    system: 'Rules',
    text: 'Inspect',
    onChange() {},
    onProgress: vi.fn(),
  }
  return { ...fixture, options, runner: createAgentRunner(fixture.repository) }
}

it('loads the model only on request and records a stop during loading without generating', async () => {
  vi.resetModules()
  let finishLoading!: () => void
  const pending = new Promise<void>((resolve) => {
    finishLoading = resolve
  })
  const generate = vi.fn()
  const load = vi.fn(async () => {
    await pending
    return { streamModel: generate, modelFailure: (error: unknown) => error }
  })
  vi.doMock('@/lib/ai/model', load)
  const s = await setup()
  expect(load).not.toHaveBeenCalled()

  const outcome = s.runner.run(s.options).catch((error: unknown) => error)
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
  const stopped = s.runner.stop()
  finishLoading()

  expect(await outcome).toMatchObject({ name: 'AbortError' })
  await stopped
  expect(generate).not.toHaveBeenCalled()
  expect(s.records.conversation.lastRun).toMatchObject({
    state: 'interrupted',
    error: { code: 'cancelled' },
  })
  expect((await s.repository.requests(s.records.conversation.id))[0]).toMatchObject({
    error: { code: 'cancelled' },
    endedAt: expect.any(Number),
  })
  expect(s.options.onProgress).toHaveBeenLastCalledWith(null)
})

it('persists model loading failure without importing again to classify it', async () => {
  vi.resetModules()
  const error = new Error('Model chunk unavailable')
  const load = vi.fn(async () => {
    throw error
  })
  vi.doMock('@/lib/ai/model', load)
  const s = await setup()

  // Vitest wraps a rejected module factory in an import error.
  await expect(s.runner.run(s.options)).rejects.toMatchObject({ cause: error })

  expect(load).toHaveBeenCalledOnce()
  expect(s.records.conversation.lastRun).toMatchObject({ state: 'failed' })
  expect(s.records.messages.at(-1)?.state).toBe('interrupted')
  expect((await s.repository.requests(s.records.conversation.id))[0]).toMatchObject({
    error: { code: 'unexpected' },
    endedAt: expect.any(Number),
  })
  expect(s.options.onProgress).toHaveBeenLastCalledWith(null)
})

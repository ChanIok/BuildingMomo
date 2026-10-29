import { expect, it, vi } from 'vitest'
import { createExternalWorkbench } from '@/lib/ai/externalWorkbench'
import { evaluateScript } from '@/lib/ai/scriptRuntime'
import { aiExecutionBusy } from '@/lib/ai/executionGate'
import { createScriptedRunner, workbenchFixture } from '../../fixtures/ai'
import { createPolicy } from '@/lib/ai/context'

async function setup() {
  const f = await workbenchFixture()
  const workbench = createExternalWorkbench({
    ...f,
    host: f.scene,
    script: (code, values, call) => evaluateScript(code, values, call),
  })
  const run = (code: string, contextId?: string) =>
    workbench.run({ code, ...(contextId ? { contextId } : {}) }, new AbortController().signal)
  return { ...f, workbench, run }
}

it('persists independent vars, references and records without model messages or requests', async () => {
  const f = await setup()
  const a = await f.run('vars.value="A";vars.selected=await api.selection()')
  const b = await f.run('vars.value="B"')
  expect(a.conversation.id).not.toBe(b.conversation.id)
  expect(a.variables.references).toHaveLength(2)
  expect(b.variables.references).toHaveLength(0)
  const resumed = await f.run('console.log(vars.value,vars.selected.length)', a.conversation.id)
  expect(resumed.tools.at(-1)?.result?.data).toMatchObject({ logs: [['A', 2]] })
  expect((await f.workbench.load(b.conversation.id)).variables.values).toEqual({ value: 'B' })
  expect(resumed.messages).toEqual([])
  expect(await f.repository.requests(a.conversation.id)).toEqual([])
})

it('never falls back for an unknown, deleted or built-in context', async () => {
  const f = await setup()
  await expect(f.run('vars.x=1', 'missing')).rejects.toMatchObject({ code: 'scope' })
  await expect(f.run('vars.x=1', f.records.conversation.id)).rejects.toMatchObject({
    code: 'scope',
  })
  const a = await f.run('vars.x=1')
  await f.workbench.remove(a.conversation.id)
  await expect(f.run('vars.x=2', a.conversation.id)).rejects.toMatchObject({ code: 'scope' })
  expect(aiExecutionBusy.value).toBe(false)
})

it('keeps its default scheme when the active tab changes', async () => {
  const f = await setup()
  const a = await f.run('vars.selected=await api.selection()')
  vi.spyOn(f.scene, 'context').mockReturnValue({ schemeId: 'another', title: 'Other' })
  await f.run('await api.selection()', a.conversation.id)
  expect(f.scene.selection).toHaveBeenLastCalledWith('scheme-1')
  const b = await f.run('await api.selection()')
  expect(b.conversation.external?.schemeId).toBe('another')
  expect(f.scene.selection).toHaveBeenLastCalledWith('another')
})

it('shares actual edits but rejects stale furniture from the other task until refreshed', async () => {
  const f = await setup()
  const a = await f.run('vars.selected=await api.selection()')
  await f.run('await api.organize([{name:"B",items:await api.selection()}])')
  const stale = await f.run(
    'await api.organize([{name:"A",items:vars.selected}])',
    a.conversation.id
  )
  expect(stale.tools.at(-1)?.result?.error).toMatchObject({ code: 'stale' })
  expect(f.scene.apply).toHaveBeenCalledOnce()
  const next = await f.run(
    'vars.selected=await api.refresh(vars.selected);await api.organize([{name:"A",items:vars.selected}])',
    a.conversation.id
  )
  expect(next.tools.at(-1)?.state).toBe('succeeded')
  expect(f.scene.apply).toHaveBeenCalledTimes(2)
})

it('retains completed edits and old vars after a later script failure', async () => {
  const f = await setup()
  const a = await f.run('vars.keep=1')
  const next = await f.run(
    'await api.organize([{name:"Roof",items:await api.selection()}]);vars.keep=2;throw Error("later")',
    a.conversation.id
  )
  expect(next.variables.values).toEqual({ keep: 1 })
  expect(next.tools.at(-1)).toMatchObject({ state: 'failed', edits: [{ state: 'succeeded' }] })
  const restored = await f.workbench.load(a.conversation.id)
  expect(restored.tools.at(-1)?.edits[0]?.state).toBe('succeeded')
  expect(f.scene.apply).toHaveBeenCalledOnce()
})

it('recovers prepared edits without replaying and requires user acknowledgement for writes', async () => {
  const f = await setup()
  const a = await f.run('vars.selected=await api.selection()')
  const tool = {
    ...a.tools[0]!,
    state: 'prepared' as const,
    edits: [{ id: 'uncertain', schemeId: 'scheme-1', state: 'prepared' as const, input: {} }],
  }
  await f.repository.save(a.conversation, [tool])
  const restored = await f.workbench.load(a.conversation.id)
  expect(restored.tools[0]?.state).toBe('uncertain')
  expect(f.scene.apply).not.toHaveBeenCalled()
  const next = await f.run(
    'await api.organize([{name:"Roof",items:vars.selected}])',
    a.conversation.id
  )
  expect(next.tools.at(-1)?.result?.error).toMatchObject({ code: 'uncertain_edit' })
  await f.workbench.acknowledge(a.conversation.id, 'Checked the scene')
  await f.run('await api.organize([{name:"Roof",items:vars.selected}])', a.conversation.id)
  expect(f.scene.apply).toHaveBeenCalledOnce()
})

it('shares a single execution slot with the built-in runner and releases it on stop', async () => {
  const f = await workbenchFixture()
  const workbench = createExternalWorkbench({
    repository: f.repository,
    host: f.scene,
    script: (_code, _values, _call, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve({ ok: false, logs: [], error: { code: 'cancelled', message: 'Stopped' } }),
          { once: true }
        )
      }),
  })
  const pending = workbench.run({ code: 'wait' }, new AbortController().signal)
  await vi.waitFor(() => expect(aiExecutionBusy.value).toBe(true))
  await expect(
    workbench.run({ code: 'other' }, new AbortController().signal)
  ).rejects.toMatchObject({ code: 'busy' })
  const generate = vi.fn(async () => ({ text: 'Done', toolCalls: [] }))
  await expect(
    createScriptedRunner(f.repository, generate).run({
      records: f.records,
      scene: f.scene,
      connection: {
        provider: 'compatible',
        apiUrl: 'https://example.test/v1',
        apiKey: '',
        model: 'm',
      },
      policy: createPolicy(16000, 4000),
      system: '',
      onChange: () => {},
      onProgress: () => {},
    })
  ).rejects.toMatchObject({ code: 'busy' })
  expect(generate).not.toHaveBeenCalled()
  await vi.waitFor(async () =>
    expect(
      (await f.repository.list()).some(
        (entry) => entry.external && entry.lastRun?.state === 'running'
      )
    ).toBe(true)
  )
  await workbench.stop()
  expect((await pending).tools[0]?.state).toBe('interrupted')
  expect(aiExecutionBusy.value).toBe(false)
})

it('does not publish new vars or images when the outcome batch fails to save', async () => {
  const f = await setup()
  const a = await f.run('vars.keep=1')
  const save = f.repository.save.bind(f.repository)
  vi.spyOn(f.repository, 'save').mockImplementation((conversation, changed = []) => {
    if (changed.some((record) => 'blob' in record)) throw Error('Storage failed')
    return save(conversation, changed)
  })
  const next = await f.run(
    'vars.keep=2;await api.render([{items:await api.selection(),label:"view"}])',
    a.conversation.id
  )
  expect(next.variables.values).toEqual({ keep: 1 })
  expect(next.tools.at(-1)).toMatchObject({ state: 'interrupted', assets: [] })
})

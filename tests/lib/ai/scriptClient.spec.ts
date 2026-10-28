import { expect, it, vi } from 'vitest'
import { Worker as NodeWorker } from 'node:worker_threads'
import { createScriptExecutor } from '@/lib/ai/scriptClient'
import { scriptMath } from '@/lib/ai/math'
import { analysisSnapshot } from '../../fixtures/sceneAnalysis'
it('reuses coordinate transforms, statistics and conservative geometry', () => {
  const items = [...analysisSnapshot().items]
  expect(scriptMath.gap(items[0]!.bounds, items[1]!.bounds)).toBe(20)
  expect(scriptMath.gap(null, items[0]!.bounds)).toBeNull()
  const frame = scriptMath.dominantFrame(
    items.map((i, n) => ({
      ...i,
      rotation: { ...i.rotation, z: n === 0 ? 89.8 : n === 1 ? 0.2 : 90 },
    }))
  )
  expect(frame.support).toBe(3)
  expect(Math.min(frame.yaw, 90 - frame.yaw)).toBeLessThan(0.1)
  const point = { x: 17, y: -51, z: 20 },
    restored = scriptMath.fromFrame(
      scriptMath.toFrame(point, { yaw: 27, origin: { x: 100, y: 200, z: 3 } }),
      { yaw: 27, origin: { x: 100, y: 200, z: 3 } }
    )
  expect(restored.x).toBeCloseTo(point.x)
  expect(restored.y).toBeCloseTo(point.y)
  expect(restored.z).toBe(point.z)
})
/** Node 24 bridge loads the actual TS module worker. No duplicate evaluator. */
function nativeWorkerFactory() {
  const entry = new URL('../../../src/workers/aiScript.worker.ts', import.meta.url).href
  const node = new NodeWorker(
    `
    const {parentPort}=require('node:worker_threads');
    const {registerHooks}=require('node:module');
    registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(e){if(specifier.startsWith('.')&&!specifier.endsWith('.ts'))return next(specifier+'.ts',context);throw e}}});
    globalThis.self=globalThis;
    globalThis.postMessage=data=>parentPort.postMessage(data);
    const ready=import(${JSON.stringify(entry)});
    parentPort.on('message',async data=>{await ready;globalThis.onmessage({data})});
  `,
    { eval: true }
  )
  const adapter = {
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
    postMessage: (value: unknown) => node.postMessage(value),
    terminate: vi.fn(() => {
      void node.terminate()
    }),
  }
  node.on('message', (data) =>
    adapter.onmessage?.call(adapter as unknown as Worker, { data } as MessageEvent)
  )
  node.on('error', (error) =>
    adapter.onerror?.call(
      adapter as unknown as Worker,
      { message: error.message, preventDefault() {} } as ErrorEvent
    )
  )
  return adapter as unknown as Worker
}
it('runs async RPC and persistent vars through the actual production Worker', async () => {
  const factory = vi.fn(nativeWorkerFactory),
    execute = createScriptExecutor(factory, 3000)
  const call = vi.fn(async () => [{ ref: 1 }, { ref: 2 }])
  const result = await execute(
    'vars.selected=await api.selection();console.log(vars.selected.length);return 3',
    {},
    call,
    new AbortController().signal
  )
  expect(result).toMatchObject({
    ok: true,
    values: { selected: [{ ref: 1 }, { ref: 2 }] },
    logs: [[2]],
    result: 3,
  })
  expect(call).toHaveBeenCalledWith('selection', [])
  expect(factory.mock.results[0]?.value.terminate).toHaveBeenCalledOnce()
  const failed = await execute(
    'vars.bad=1;throw Error("failed")',
    {},
    call,
    new AbortController().signal
  )
  expect(failed).toMatchObject({ ok: false, error: { message: 'failed' } })
  expect(failed.values).toBeUndefined()
})
it('terminates infinite loops and stops without returning partial vars', async () => {
  const factory = vi.fn(nativeWorkerFactory),
    execute = createScriptExecutor(factory, 500)
  expect(
    await execute('vars.bad=1;while(true){}', {}, vi.fn(), new AbortController().signal)
  ).toMatchObject({ ok: false, error: { code: 'compute_timeout' } })
  const controller = new AbortController(),
    run = execute('while(true){}', {}, vi.fn(), controller.signal)
  controller.abort()
  expect(await run).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  expect(factory.mock.results.every((r) => r.value.terminate.mock.calls.length === 1)).toBe(true)
  const before = factory.mock.calls.length
  expect(await execute('', {}, vi.fn(), controller.signal)).toMatchObject({ ok: false })
  expect(factory).toHaveBeenCalledTimes(before)
})
it('preserves normal caught host errors and drains pending host calls before saving vars', async () => {
  const execute = createScriptExecutor(nativeWorkerFactory, 3000)
  const reject = vi.fn(async () => {
    throw Object.assign(new Error('No such guide'), { code: 'invalid_input' })
  })
  expect(
    await execute(
      'await api.help("guide:organization");vars.x=1',
      {},
      reject,
      new AbortController().signal
    )
  ).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'No such guide' } })
  expect(
    await execute(
      'try { await api.help("guide:organization") } catch(e) { vars.error=e.code };vars.x=1',
      {},
      reject,
      new AbortController().signal
    )
  ).toMatchObject({ ok: true, values: { error: 'invalid_input', x: 1 } })
  let completed = false
  expect(
    await execute(
      'api.help("guide:organization");vars.x=1',
      {},
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        completed = true
        return null
      },
      new AbortController().signal
    )
  ).toMatchObject({ ok: true, values: { x: 1 } })
  expect(completed).toBe(true)
})

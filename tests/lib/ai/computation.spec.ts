import { expect, it, vi } from 'vitest'
import { Worker as NodeWorker } from 'node:worker_threads'
import { createComputeExecutor } from '@/lib/ai/computeClient'
import { computeApi, evaluateComputation } from '@/lib/ai/computation'
import { analysisSnapshot } from '../../fixtures/sceneAnalysis'

it.each(['publish.report({count:1})', "publish.report('数量')", 'publish.set([1000])'])(
  'explains the two-argument publication signature: %s',
  (code) => {
    expect(() => evaluateComputation(code, {})).toThrow('名称和数据两个参数')
  }
)

it('supports useful local grouping, distributions, frame transforms and conservative distances', () => {
  const items = [...analysisSnapshot().items]
  expect(
    evaluateComputation(
      "publish.report('Heights',api.distribution(input.items.map(i=>i.position.z)));publish.set('Floors',input.items.filter(i=>i.groupId===7));",
      { items }
    )
  ).toMatchObject([
    {
      kind: 'report',
      value: [
        { value: 102, count: 2 },
        { value: 502, count: 1 },
      ],
    },
    { kind: 'set', value: [1000, 1001] },
  ])
  expect(computeApi.gap(items[0]!.bounds, items[1]!.bounds)).toBe(20)
  expect(computeApi.gap(null, items[0]!.bounds)).toBeNull()
  const frame = computeApi.dominantFrame(
    items.map((i, n) => ({
      ...i,
      rotation: { ...i.rotation, z: n === 0 ? 89.8 : n === 1 ? 0.2 : 90 },
    }))
  )
  expect(frame.support).toBe(3)
  expect(Math.min(frame.yaw, 90 - frame.yaw)).toBeLessThan(0.1)
  const point = { x: 17, y: -51, z: 20 },
    restored = computeApi.fromFrame(
      computeApi.toFrame(point, { yaw: 27, origin: { x: 100, y: 200, z: 3 } }),
      { yaw: 27, origin: { x: 100, y: 200, z: 3 } }
    )
  expect(restored.x).toBeCloseTo(point.x)
  expect(restored.y).toBeCloseTo(point.y)
  expect(restored.z).toBe(point.z)
})
it('does not publish partial results when computation fails', () => {
  expect(() => evaluateComputation("publish.report('x',1);throw Error('bad')", {})).toThrow('bad')
})
/** Node 24 bridge loads the actual TS module worker. No duplicate evaluator. */
function nativeWorkerFactory() {
  const entry = new URL('../../../src/workers/aiCompute.worker.ts', import.meta.url).href
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
it('runs the production module in a real native thread and terminates successful and failed jobs', async () => {
  const factory = vi.fn(nativeWorkerFactory),
    execute = createComputeExecutor(factory, 3000)
  expect(
    await execute(
      "publish.report('Sum',input.values.reduce((a,b)=>a+b,0))",
      { values: [1, 2, 3] },
      new AbortController().signal
    )
  ).toEqual([{ kind: 'report', label: 'Sum', value: 6 }])
  expect(factory.mock.results[0]?.value.terminate).toHaveBeenCalledOnce()
  await expect(
    execute("throw Error('worker syntax/domain failure')", {}, new AbortController().signal)
  ).rejects.toMatchObject({ code: 'compute' })
  expect(factory.mock.results[1]?.value.terminate).toHaveBeenCalledOnce()
})
it('terminates an infinite loop on deadline, and a stopped native job on AbortSignal', async () => {
  const factory = vi.fn(nativeWorkerFactory),
    execute = createComputeExecutor(factory, 500)
  await expect(execute('while(true){}', {}, new AbortController().signal)).rejects.toMatchObject({
    code: 'compute_timeout',
  })
  expect(factory.mock.results[0]?.value.terminate).toHaveBeenCalledOnce()
  const controller = new AbortController(),
    run = execute('while(true){}', {}, controller.signal)
  controller.abort()
  await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  expect(factory.mock.results[1]?.value.terminate).toHaveBeenCalledOnce()
})
it('never starts an already stopped job and settles an erroneous worker only once', async () => {
  const controller = new AbortController()
  controller.abort()
  const factory = vi.fn(nativeWorkerFactory)
  expect(() => createComputeExecutor(factory)('', {}, controller.signal)).toThrow()
  expect(factory).not.toHaveBeenCalled()
  const worker = {
    terminate: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null,
    onerror: null,
  } as unknown as Worker
  const run = createComputeExecutor(() => worker, 1000)('', {}, new AbortController().signal)
  worker.onmessage!({ data: { ok: false, error: 'CSP' } } as MessageEvent)
  worker.onmessage!({ data: { ok: true, outputs: [] } } as MessageEvent)
  await expect(run).rejects.toMatchObject({ code: 'compute' })
  expect(worker.terminate).toHaveBeenCalledOnce()
})

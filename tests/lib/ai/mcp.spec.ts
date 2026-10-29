import { expect, it, vi } from 'vitest'
import { createMcpHandler, externalToolDefinition } from '@/lib/ai/mcp'
import { createExternalWorkbench } from '@/lib/ai/externalWorkbench'
import { evaluateScript } from '@/lib/ai/scriptRuntime'
import { workbenchFixture } from '../../fixtures/ai'

async function setup() {
  const f = await workbenchFixture()
  const workbench = createExternalWorkbench({
    repository: f.repository,
    host: f.scene,
    script: (code, values, call) => evaluateScript(code, values, call),
  })
  const isReady = vi.fn(() => true)
  const handle = createMcpHandler({
    workbench,
    repository: f.repository,
    isReady,
    language: () => 'zh',
  })
  const request = async (
    method: string,
    params: Record<string, unknown> = {},
    version = '2025-11-25'
  ) =>
    handle(
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method,
          params:
            version === '2026-07-28'
              ? {
                  ...params,
                  _meta: {
                    'io.modelcontextprotocol/protocolVersion': version,
                    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
                    'io.modelcontextprotocol/clientCapabilities': {},
                  },
                }
              : params,
        },
        protocolVersion: version,
        methodHeader: method,
        nameHeader: params.name as string,
      },
      new AbortController().signal
    )
  return { ...f, handle, request, isReady }
}

it('discovers the same execute_js contract with explicit state handles on both protocol eras', async () => {
  const f = await setup()
  expect(await f.request('initialize', { protocolVersion: '2025-11-25' })).toMatchObject({
    status: 200,
    body: { result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } } },
  })
  expect(await f.request('tools/list')).toMatchObject({
    body: { result: { tools: [{ name: 'execute_js' }] } },
  })
  expect(externalToolDefinition.inputSchema).toMatchObject({
    required: ['code'],
    additionalProperties: false,
    properties: { contextId: { type: 'string' } },
  })
  expect(await f.request('server/discover', {}, '2026-07-28')).toMatchObject({
    body: {
      result: { resultType: 'complete', supportedVersions: expect.arrayContaining(['2026-07-28']) },
    },
  })
})

it('returns contextId, compact text output and actual image bytes', async () => {
  const f = await setup()
  const response: any = await f.request('tools/call', {
    name: 'execute_js',
    arguments: {
      code: 'vars.x=7;await api.render([{items:await api.selection(),label:"view"}]);console.log(vars.x)',
    },
  })
  const result = response.body.result
  expect(result.isError).toBe(false)
  expect(result.structuredContent).toMatchObject({
    contextId: expect.any(String),
    defaultSchemeId: 'scheme-1',
    data: { logs: [[7]] },
  })
  expect(result.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'cG5n' })
  const next: any = await f.request('tools/call', {
    name: 'execute_js',
    arguments: { contextId: result.structuredContent.contextId, code: 'console.log(vars.x)' },
  })
  expect(next.body.result.structuredContent.data.logs).toEqual([[7]])
  const other: any = await f.request('tools/call', {
    name: 'execute_js',
    arguments: { code: 'console.log(typeof vars.x)' },
  })
  expect(other.body.result.structuredContent.data.logs).toEqual([['undefined']])
})

it('returns actionable tool errors without losing the newly created context', async () => {
  const f = await setup()
  const response: any = await f.request('tools/call', {
    name: 'execute_js',
    arguments: { code: 'throw Error("bad code")' },
  })
  expect(response.body.result).toMatchObject({
    isError: true,
    structuredContent: { contextId: expect.any(String), error: { code: 'compute' } },
  })
  expect(
    await f.request('tools/call', { name: 'execute_js', arguments: { code: '', mode: 'bad' } })
  ).toMatchObject({ body: { result: { isError: true } } })
  expect(f.scene.apply).not.toHaveBeenCalled()
})

it('rejects invalid RPC, unsupported protocols, mismatched metadata and disabled access before execution', async () => {
  const f = await setup()
  expect(await f.handle({ body: [] }, new AbortController().signal)).toMatchObject({ status: 400 })
  expect(
    await f.handle(
      {
        body: {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'execute_js', arguments: { code: 'vars.x=1' } },
        },
      },
      new AbortController().signal
    )
  ).toMatchObject({ status: 400 })
  expect(await f.request('tools/list', {}, '2099-01-01')).toMatchObject({
    status: 400,
    body: { error: { code: -32022 } },
  })
  expect(
    await f.handle(
      { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, protocolVersion: '2026-07-28' },
      new AbortController().signal
    )
  ).toMatchObject({ status: 400, body: { error: { code: -32020 } } })
  f.isReady.mockReturnValue(false)
  expect(await f.request('tools/list')).toMatchObject({ status: 503 })
  expect((await f.repository.list()).filter((entry) => entry.external)).toHaveLength(0)
})

it('does not let another chat cancel a task through a colliding JSON-RPC id', async () => {
  const f = await workbenchFixture()
  const started = vi.fn()
  const workbench = createExternalWorkbench({
    repository: f.repository,
    host: f.scene,
    script: (_code, _values, _call, signal) =>
      new Promise((resolve) => {
        started()
        signal.addEventListener(
          'abort',
          () => resolve({ ok: false, logs: [], error: { code: 'cancelled', message: 'Stopped' } }),
          { once: true }
        )
      }),
  })
  const handle = createMcpHandler({
    workbench,
    repository: f.repository,
    isReady: () => true,
    language: () => 'zh',
  })
  const request = {
    protocolVersion: '2025-11-25',
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'execute_js', arguments: { code: 'wait' } },
    },
  }
  const controller = new AbortController()
  const pending = handle(request, controller.signal)
  await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
  const busy: any = await handle(request, new AbortController().signal)
  expect(JSON.parse(busy.body.result.content[0].text).error.code).toBe('busy')
  expect(
    await handle(
      {
        protocolVersion: '2025-11-25',
        body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
      },
      new AbortController().signal
    )
  ).toEqual({ status: 202 })
  expect(controller.signal.aborted).toBe(false)
  controller.abort()
  expect(await pending).toMatchObject({ body: { result: { isError: true } } })
})

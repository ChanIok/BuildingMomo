import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { exportConversation } from '@/lib/ai/diagnostics'
import { workbenchFixture } from '../../fixtures/ai'
import type { RequestRecord, ToolRecord } from '@/lib/ai/types'
import { createPolicy } from '@/lib/ai/context'
it('exports exact saved requests, vars, edit outcomes and optional images with recursive redaction', async () => {
  const f = await workbenchFixture(),
    id = f.records.conversation.id
  const request: RequestRecord = {
    id: `request:${id}:r`,
    conversationId: id,
    runId: 'r',
    kind: 'chat',
    startedAt: 1,
    endpoint: 'https://example.test/v1',
    model: 'm',
    provider: 'compatible',
    maxOutputTokens: 1000,
    diagnostics: {},
    estimatedTokens: 10,
    policy: createPolicy(),
    body: {
      messages: [{ role: 'user', content: 'original secret' }],
      headers: { Authorization: 'secret' },
    },
  }
  const asset = {
    id: `asset:${id}:image`,
    conversationId: id,
    width: 1,
    height: 1,
    bytes: 3,
    blob: new Blob(['png'], { type: 'image/png' }),
  }
  const tool: ToolRecord = {
    id: `tool:${id}:t`,
    conversationId: id,
    messageId: 'm',
    providerCallId: 'c',
    name: 'execute_js',
    input: { code: 'await api.render([{items:vars.selected,label:"选区"}])' },
    state: 'succeeded',
    assets: [{ id: asset.id, width: 1, height: 1, bytes: 3 }],
    edits: [],
  }
  f.records.tools.push(tool)
  f.records.variables.values = { saved: { apiKey: 'secret', note: 'contains secret' } }
  await f.repository.save(f.records.conversation, [request, asset, tool, f.records.variables])
  const plain = JSON.parse(await exportConversation(f.repository, f.records, false, ['secret']))
  expect(plain.requests[0].body.messages[0].content).toBe('original [REDACTED]')
  expect(plain.requests[0].body.headers).toBeUndefined()
  expect(plain.variables.values.saved.apiKey).toBeUndefined()
  expect(plain.images[0].dataUrl).toBeUndefined()
  const withImages = JSON.parse(await exportConversation(f.repository, f.records, true, ['secret']))
  expect(withImages.images[0].dataUrl).toMatch(/^data:image\/png;base64,/)
  expect(withImages.format).toBe('buildingmomo-ai')
})

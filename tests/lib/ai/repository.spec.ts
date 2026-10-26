import 'fake-indexeddb/auto'
import { createStore } from 'idb-keyval'
import { expect, it } from 'vitest'
import { createConversationRepository } from '@/lib/ai/repository'
import { createArtifacts } from '@/lib/ai/artifacts'
import type {
  ConversationRecords,
  PayloadRecord,
  AssetRecord,
  MessageRecord,
  ToolRecord,
} from '@/lib/ai/types'

export function repository() {
  return createConversationRepository(createStore(`ai-test-${crypto.randomUUID()}`, 'records'))
}

it('allocates ordered messages transactionally, lists by scheme and loads ordered records without assets', async () => {
  const repo = repository()
  const conversation = await repo.create('scheme', 'House')
  const input = {
    role: 'user' as const,
    content: 'Do not change the garden',
    state: 'complete' as const,
    runId: 'r',
    toolIds: [],
  }
  const [a, b] = await Promise.all([
    repo.append(conversation, input),
    repo.append(conversation, { ...input, content: 'Continue' }),
  ])
  expect([a.message.sequence, b.message.sequence]).toEqual([0, 1])
  expect((await repo.load('scheme', conversation.id))?.conversation.nextSequence).toBe(2)
  expect((await repo.load('scheme', conversation.id))?.messages.map((m) => m.content)).toEqual([
    input.content,
    'Continue',
  ])
  expect((await repo.list('other')).length).toBe(0)
  expect((await repo.list('scheme'))[0]?.id).toBe(conversation.id)
})

it('atomically stores outcome and Blob, recovers prepared edits as uncertain without replaying', async () => {
  const repo = repository(),
    conversation = await repo.create('scheme', 'House')
  conversation.lastRun = { id: 'r', state: 'running' }
  const appended = await repo.append(conversation, {
    role: 'assistant',
    content: 'partial',
    state: 'streaming',
    toolIds: ['t'],
    runId: 'r',
  })
  const tool: ToolRecord = {
    id: `tool:${conversation.id}:0:0`,
    conversationId: conversation.id,
    messageId: appended.message.id,
    providerCallId: 'provider-1',
    name: 'apply',
    input: {},
    effect: 'edit',
    state: 'prepared',
    assets: [],
  }
  const message: MessageRecord = { ...appended.message, toolIds: [tool.id] }
  const asset: AssetRecord = {
    id: `asset:${conversation.id}:image`,
    conversationId: conversation.id,
    blob: new Blob(['png'], { type: 'image/png' }),
    width: 10,
    height: 20,
    bytes: 3,
  }
  await repo.save(appended.conversation, [tool, message, asset])
  const loaded = (await repo.load('scheme', conversation.id))!
  expect(loaded.messages[0]?.state).toBe('interrupted')
  expect(loaded.tools[0]?.state).toBe('uncertain')
  expect(loaded.conversation.lastRun?.state).toBe('interrupted')
  expect(await (await repo.read<AssetRecord>(asset.id))?.blob.text()).toBe('png')
  await repo.remove(loaded.conversation)
  expect(await repo.read(asset.id)).toBeUndefined()
  expect(await repo.read(message.id)).toBeUndefined()
  expect(await repo.read(tool.id)).toBeUndefined()
  expect(await repo.load('scheme', conversation.id)).toBeNull()
})

it('does not rewrite old messages during checkpoints and rolls back a failed batch', async () => {
  const repo = repository(),
    conversation = await repo.create('scheme', 'House')
  const { conversation: next, message } = await repo.append(conversation, {
    role: 'user',
    content: 'original',
    state: 'complete',
    toolIds: [],
    runId: 'r',
  })
  const mutable = { ...message, content: 'changed' }
  const saving = repo.save(next, [mutable])
  mutable.content = 'later mutation'
  await saving
  expect((await repo.read<MessageRecord>(message.id))?.content).toBe('changed')
  await repo.save({ ...next, title: 'new title' })
  expect((await repo.read<MessageRecord>(message.id))?.content).toBe('changed')
  await expect(
    repo.save(next, [{ ...message, content: 'bad', cannotClone: () => {} } as MessageRecord])
  ).rejects.toBeDefined()
  expect((await repo.read<MessageRecord>(message.id))?.content).toBe('changed')
})

it('rolls back records and metadata together when an IndexedDB write fails mid-transaction', async () => {
  const store = createStore(`atomic-${crypto.randomUUID()}`, 'records')
  let fail = false
  const repo = createConversationRepository((mode, callback) =>
    store(mode, (db) => {
      if (fail && mode === 'readwrite') {
        const put = db.put.bind(db)
        let count = 0
        db.put = ((...args: Parameters<IDBObjectStore['put']>) => {
          if (++count === 2) throw new DOMException('Quota full', 'QuotaExceededError')
          return put(...args)
        }) as IDBObjectStore['put']
      }
      return callback(db)
    })
  )
  const conversation = await repo.create('s', 'Before')
  const asset: AssetRecord = {
    id: `asset:${conversation.id}:png`,
    conversationId: conversation.id,
    blob: new Blob(['png']),
    bytes: 3,
    width: 1,
    height: 1,
  }
  fail = true
  await expect(repo.save({ ...conversation, title: 'After' }, [asset])).rejects.toMatchObject({
    code: 'storage',
  })
  fail = false
  expect((await repo.list('s'))[0]?.title).toBe('Before')
  expect(await repo.read(asset.id)).toBeUndefined()
})

it('commits selection reference and message together; restores metadata without eager payloads and deletes both', async () => {
  const repo = repository(),
    conversation = await repo.create('scheme', 'References')
  const records: ConversationRecords = { conversation, messages: [], tools: [], artifacts: [] }
  const store = createArtifacts(records, repo)
  const a = await store.add(
    { kind: 'set', schemeId: 'scheme', label: 'Selected', revision: 'v1', count: 2 },
    ['b', 'a']
  )
  const next = await repo.append(
    conversation,
    {
      role: 'user',
      content: 'This selection',
      state: 'complete',
      toolIds: [],
      references: [a.ref],
      runId: 'r',
    },
    store.staged
  )
  const loaded = (await repo.load('scheme', conversation.id))!
  expect(loaded.messages[0]?.references).toEqual(['R1'])
  expect(loaded.artifacts[0]).toEqual(a)
  expect(JSON.stringify(loaded)).not.toContain('["a","b"]')
  expect((await repo.read<PayloadRecord>(a.payloadId!))?.data).toEqual(['a', 'b'])
  expect(
    await createArtifacts(loaded, repo).add(
      { kind: 'set', schemeId: 'scheme', label: 'Selected', revision: 'v1', count: 2 },
      ['a', 'b']
    )
  ).toEqual(a)
  await repo.remove(next.conversation)
  expect(await repo.read(a.id)).toBeUndefined()
  expect(await repo.read(a.payloadId!)).toBeUndefined()
})

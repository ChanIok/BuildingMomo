import 'fake-indexeddb/auto'
import { createStore } from 'idb-keyval'
import { expect, it } from 'vitest'
import { createConversationRepository } from '@/lib/ai/repository'
import type { AssetRecord, MessageRecord, ToolRecord } from '@/lib/ai/types'

export function repository() {
  return createConversationRepository(createStore(`ai-test-${crypto.randomUUID()}`, 'records'))
}

it('allocates ordered messages transactionally, lists global conversations and loads ordered records without assets', async () => {
  const repo = repository()
  const conversation = await repo.create('House')
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
  expect((await repo.load(conversation.id))?.conversation.nextSequence).toBe(2)
  expect((await repo.load(conversation.id))?.messages.map((m) => m.content)).toEqual([
    input.content,
    'Continue',
  ])
  expect((await repo.list())[0]?.id).toBe(conversation.id)
})

it('atomically stores outcome and Blob, recovers prepared edits as uncertain without replaying', async () => {
  const repo = repository(),
    conversation = await repo.create('House')
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
    name: 'execute_js',
    input: {},
    state: 'requested',
    assets: [],
    edits: [{ id: 'edit-1', schemeId: 'scheme', state: 'prepared', input: {} }],
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
  const loaded = (await repo.load(conversation.id))!
  expect(loaded.messages[0]?.state).toBe('interrupted')
  expect(loaded.tools[0]?.state).toBe('uncertain')
  expect(loaded.conversation.lastRun?.state).toBe('interrupted')
  expect(await (await repo.read<AssetRecord>(asset.id))?.blob.text()).toBe('png')
  await repo.remove(loaded.conversation)
  expect(await repo.read(asset.id)).toBeUndefined()
  expect(await repo.read(message.id)).toBeUndefined()
  expect(await repo.read(tool.id)).toBeUndefined()
  expect(await repo.load(conversation.id)).toBeNull()
})

it('does not rewrite old messages during checkpoints and rolls back a failed batch', async () => {
  const repo = repository(),
    conversation = await repo.create('House')
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
  const conversation = await repo.create('Before')
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
  expect((await repo.list())[0]?.title).toBe('Before')
  expect(await repo.read(asset.id)).toBeUndefined()
})

it('restores variables and short references without executing code, and deletes them with the conversation', async () => {
  const repo = repository(),
    conversation = await repo.create('Shared')
  const variables = {
    id: `vars:${conversation.id}`,
    conversationId: conversation.id,
    values: { selected: [{ ref: 1, instanceId: 1000 }], count: 1 },
    references: [{ schemeId: 'scheme-a', internalId: 'private-uuid', revision: 'r1' }],
  }
  await repo.save(conversation, [variables])
  const restored = await repo.load(conversation.id)
  expect(restored?.variables).toEqual(variables)
  expect(restored?.messages).toEqual([])
  expect(restored?.tools).toEqual([])
  await repo.remove(conversation)
  expect(await repo.read(variables.id)).toBeUndefined()
  expect(await repo.load(conversation.id)).toBeNull()
})

it('upgrades the fixed database name in place, discarding the unreleased artifact schema', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('buildingmomo-ai', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve) => {
    const tx = old.transaction('records', 'readwrite')
    tx.objectStore('records').put({ ref: 'R1' }, 'artifact:old')
    tx.oncomplete = () => resolve()
  })
  old.close()
  const repo = createConversationRepository()
  expect(await repo.read('artifact:old')).toBeUndefined()
  const conversation = await repo.create('New schema')
  expect((await repo.load(conversation.id))?.variables.values).toEqual({})
  const opened = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('buildingmomo-ai')
    request.onsuccess = () => resolve(request.result)
  })
  expect(opened.version).toBe(2)
  expect([...opened.objectStoreNames]).toEqual(['records'])
  opened.close()
})

import { createStore, promisifyRequest, type UseStore } from 'idb-keyval'
import {
  AiError,
  type ArtifactRecord,
  type PayloadRecord,
  type AssetRecord,
  type ContextCheckpoint,
  type Conversation,
  type ConversationRecords,
  type MessageRecord,
  type RequestRecord,
  type ToolRecord,
} from './types'

const database = 'buildingmomo-ai-workbench-v3'
const conversationKey = (schemeId: string, id: string) => `conversation:${schemeId}:${id}`
const range = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}\uffff`)

export function createConversationRepository(store: UseStore = createStore(database, 'records')) {
  async function transaction<T>(
    mode: IDBTransactionMode,
    execute: (db: IDBObjectStore) => Promise<T>
  ): Promise<T> {
    try {
      return await store(mode, async (db) => {
        const committed = promisifyRequest(db.transaction)
        try {
          const result = await execute(db)
          await committed
          return result
        } catch (error) {
          try {
            db.transaction.abort()
          } catch {
            /* Already settled. */
          }
          await committed.catch(() => {})
          throw error
        }
      })
    } catch (error) {
      if (error instanceof AiError) throw error
      throw new AiError('storage')
    }
  }
  const read = <T>(key: string) =>
    transaction('readonly', async (db) => (await promisifyRequest(db.get(key))) as T | undefined)
  const list = <T>(prefix: string) =>
    transaction('readonly', async (db) => (await promisifyRequest(db.getAll(range(prefix)))) as T[])
  function clone<T>(value: T): T {
    try {
      return structuredClone(value)
    } catch {
      throw new AiError('storage')
    }
  }

  async function save(
    conversation: Conversation,
    records: (
      | MessageRecord
      | ToolRecord
      | AssetRecord
      | ArtifactRecord
      | PayloadRecord
      | ContextCheckpoint
      | RequestRecord
    )[] = []
  ) {
    // Snapshot at admission: an older streaming save must not serialize a later mutable draft.
    const values = clone(records)
    const meta = clone({ ...conversation, updatedAt: Date.now() })
    await transaction('readwrite', async (db) => {
      db.put(meta, conversationKey(meta.schemeId, meta.id))
      for (const value of values) db.put(value, value.id)
    })
    return meta
  }
  async function create(schemeId: string, title: string) {
    const time = Date.now()
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      schemeId,
      title,
      createdAt: time,
      updatedAt: time,
      nextSequence: 0,
    }
    await save(conversation)
    return conversation
  }
  async function append(
    conversation: Conversation,
    message: Omit<MessageRecord, 'id' | 'sequence' | 'conversationId'>,
    attachments: (ArtifactRecord | PayloadRecord)[] = []
  ) {
    return transaction('readwrite', async (db) => {
      const key = conversationKey(conversation.schemeId, conversation.id)
      const current = (await promisifyRequest(db.get(key))) as Conversation | undefined
      if (!current) throw new AiError('storage')
      const sequence = current.nextSequence
      const record: MessageRecord = {
        ...structuredClone(message),
        conversationId: current.id,
        sequence,
        id: `message:${current.id}:${String(sequence).padStart(12, '0')}`,
      }
      const next = { ...conversation, nextSequence: sequence + 1, updatedAt: Date.now() }
      for (const value of attachments) db.put(clone(value), value.id)
      db.put(record, record.id)
      db.put(next, key)
      return { conversation: next, message: record }
    })
  }
  async function load(schemeId: string, id: string): Promise<ConversationRecords | null> {
    const conversation = await read<Conversation>(conversationKey(schemeId, id))
    if (!conversation) return null
    const [messages, tools, artifacts, checkpoint] = await Promise.all([
      list<MessageRecord>(`message:${id}:`),
      list<ToolRecord>(`tool:${id}:`),
      list<ArtifactRecord>(`artifact:${id}:`),
      conversation.checkpointId ? read<ContextCheckpoint>(conversation.checkpointId) : undefined,
    ])
    artifacts.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)))
    if (conversation.checkpointId && !checkpoint) throw new AiError('storage')
    if (
      conversation.lastRun?.state === 'running' ||
      messages.some((m) => m.state === 'streaming') ||
      tools.some((t) => t.state === 'prepared' || t.state === 'requested')
    ) {
      const repairedMessages = messages.map((m) =>
        m.state === 'streaming' ? { ...m, state: 'interrupted' as const } : m
      )
      const repairedTools = tools.map((t): ToolRecord => {
        if (t.state !== 'prepared' && t.state !== 'requested') return t
        return {
          ...t,
          state: t.state === 'prepared' ? 'uncertain' : 'interrupted',
          result: {
            ok: false,
            error: {
              code: t.state === 'prepared' ? 'uncertain_edit' : 'interrupted',
              message:
                'Previous process stopped before recording an outcome. Do not replay this call.',
            },
          },
        }
      })
      const next = {
        ...conversation,
        lastRun: conversation.lastRun
          ? { ...conversation.lastRun, state: 'interrupted' as const }
          : undefined,
      }
      await save(next, [
        ...repairedMessages.filter((m, i) => m !== messages[i]),
        ...repairedTools.filter((t, i) => t !== tools[i]),
      ])
      return {
        conversation: next,
        messages: repairedMessages,
        tools: repairedTools,
        artifacts,
        checkpoint,
      }
    }
    return { conversation, messages, tools, artifacts, checkpoint }
  }
  async function remove(conversation: Conversation) {
    await transaction('readwrite', async (db) => {
      const prefixes = ['message', 'tool', 'asset', 'artifact', 'payload', 'checkpoint', 'request']
      const keys = await Promise.all(
        prefixes.map((type) =>
          promisifyRequest(db.getAllKeys(range(`${type}:${conversation.id}:`)))
        )
      )
      for (const key of keys.flat()) db.delete(key)
      db.delete(conversationKey(conversation.schemeId, conversation.id))
    })
  }
  return {
    create,
    save,
    append,
    load,
    remove,
    read,
    list: async (schemeId: string) =>
      (await list<Conversation>(`conversation:${schemeId}:`)).sort(
        (a, b) => b.updatedAt - a.updatedAt
      ),
    requests: (id: string) => list<RequestRecord>(`request:${id}:`),
  }
}
export type ConversationRepository = ReturnType<typeof createConversationRepository>

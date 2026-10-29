import { promisifyRequest, type UseStore } from 'idb-keyval'
import {
  AiError,
  type VariablesRecord,
  type AssetRecord,
  type ContextCheckpoint,
  type Conversation,
  type ConversationRecords,
  type MessageRecord,
  type RequestRecord,
  type ToolRecord,
} from './types'

const database = 'buildingmomo-ai'
const conversationKey = (id: string) => `conversation:${id}`
const range = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}\uffff`)

// The unreleased artifact schema is discarded in-place; the database name stays stable.
const defaultStore: UseStore = (() => {
  let opened: Promise<IDBDatabase> | undefined
  return async (mode, callback) => {
    opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(database, 2)
      let blocked = false
      request.onupgradeneeded = () => {
        const db = request.result
        if (db.objectStoreNames.contains('records')) db.deleteObjectStore('records')
        db.createObjectStore('records')
      }
      request.onsuccess = () => {
        if (blocked) {
          request.result.close()
          return
        }
        request.result.onversionchange = () => {
          request.result.close()
          opened = undefined
        }
        resolve(request.result)
      }
      request.onerror = () => {
        opened = undefined
        reject(request.error)
      }
      request.onblocked = () => {
        blocked = true
        opened = undefined
        reject(new AiError('storage'))
      }
    })
    const db = await opened
    return callback(db.transaction('records', mode).objectStore('records'))
  }
})()
export function createConversationRepository(store: UseStore = defaultStore) {
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
      MessageRecord | ToolRecord | AssetRecord | VariablesRecord | ContextCheckpoint | RequestRecord
    )[] = []
  ) {
    // Snapshot at admission: an older streaming save must not serialize a later mutable draft.
    const values = clone(records)
    const meta = clone({ ...conversation, updatedAt: Date.now() })
    await transaction('readwrite', async (db) => {
      db.put(meta, conversationKey(meta.id))
      for (const value of values) db.put(value, value.id)
    })
    return meta
  }
  async function create(title: string, external?: Conversation['external']) {
    const time = Date.now()
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title,
      createdAt: time,
      updatedAt: time,
      nextSequence: 0,
      ...(external ? { external } : {}),
    }
    await save(conversation)
    return conversation
  }
  async function append(
    conversation: Conversation,
    message: Omit<MessageRecord, 'id' | 'sequence' | 'conversationId'>
  ) {
    return transaction('readwrite', async (db) => {
      const key = conversationKey(conversation.id)
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
      db.put(record, record.id)
      db.put(next, key)
      return { conversation: next, message: record }
    })
  }
  async function load(id: string): Promise<ConversationRecords | null> {
    const conversation = await read<Conversation>(conversationKey(id))
    if (!conversation) return null
    const [messages, tools, variables, checkpoint] = await Promise.all([
      list<MessageRecord>(`message:${id}:`),
      list<ToolRecord>(`tool:${id}:`),
      read<VariablesRecord>(`vars:${id}`),
      conversation.checkpointId ? read<ContextCheckpoint>(conversation.checkpointId) : undefined,
    ])
    const vars = variables ?? { id: `vars:${id}`, conversationId: id, values: {}, references: [] }
    if (conversation.checkpointId && !checkpoint) throw new AiError('storage')
    if (
      conversation.lastRun?.state === 'running' ||
      messages.some((m) => m.state === 'streaming') ||
      tools.some(
        (t) =>
          t.state === 'prepared' ||
          t.state === 'requested' ||
          t.edits.some((e) => e.state === 'prepared')
      )
    ) {
      const repairedMessages = messages.map((m) =>
        m.state === 'streaming' ? { ...m, state: 'interrupted' as const } : m
      )
      const repairedTools = tools.map((t): ToolRecord => {
        if (
          t.state !== 'prepared' &&
          t.state !== 'requested' &&
          !t.edits.some((e) => e.state === 'prepared')
        )
          return t
        return {
          ...t,
          state: t.edits.some((e) => e.state === 'prepared') ? 'uncertain' : 'interrupted',
          edits: t.edits.map((e) =>
            e.state === 'prepared' ? { ...e, state: 'uncertain' as const } : e
          ),
          result: {
            ok: false,
            error: {
              code: t.edits.some((e) => e.state === 'prepared') ? 'uncertain_edit' : 'interrupted',
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
        variables: vars,
        checkpoint,
      }
    }
    return { conversation, messages, tools, variables: vars, checkpoint }
  }
  async function remove(conversation: Conversation) {
    await transaction('readwrite', async (db) => {
      const prefixes = ['message', 'tool', 'asset', 'checkpoint', 'request']
      const keys = await Promise.all(
        prefixes.map((type) =>
          promisifyRequest(db.getAllKeys(range(`${type}:${conversation.id}:`)))
        )
      )
      for (const key of keys.flat()) db.delete(key)
      db.delete(`vars:${conversation.id}`)
      db.delete(conversationKey(conversation.id))
    })
  }
  return {
    create,
    save,
    append,
    load,
    remove,
    read,
    list: async () =>
      (await list<Conversation>(`conversation:`)).sort((a, b) => b.updatedAt - a.updatedAt),
    requests: (id: string) => list<RequestRecord>(`request:${id}:`),
  }
}
export type ConversationRepository = ReturnType<typeof createConversationRepository>

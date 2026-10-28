import 'fake-indexeddb/auto'
import { promisifyRequest } from 'idb-keyval'
import { expect, it } from 'vitest'
import { createConversationRepository } from '@/lib/ai/repository'
import { removeLegacyDatabases } from '@/lib/legacyIdbCleanup'

it('removes obsolete databases while preserving current AI records and workspace snapshots', async () => {
  const obsolete = [
    'building-momo-db',
    'buildingmomo-ai-sessions',
    'buildingmomo-ai-v1',
    'buildingmomo-ai-workbench-v2',
    'buildingmomo-ai-workbench-v3',
  ]
  const workspaces = ['building-momo-workspace', 'building-momo-workspace-fallback']
  await Promise.all(
    [...obsolete, ...workspaces].map(async (name) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots')
      const db = await promisifyRequest(request)
      const transaction = db.transaction('snapshots', 'readwrite')
      transaction.objectStore('snapshots').put({ title: name }, 'latest')
      await promisifyRequest(transaction)
      db.close()
    })
  )
  const repository = createConversationRepository()
  const conversation = await repository.create('Keep this conversation')

  await removeLegacyDatabases()

  const remaining = (await indexedDB.databases()).map((db) => db.name)
  for (const name of obsolete) expect(remaining).not.toContain(name)
  expect(remaining).toContain('buildingmomo-ai')
  expect((await repository.load(conversation.id))?.conversation.title).toBe(
    'Keep this conversation'
  )
  for (const name of workspaces) {
    expect(remaining).toContain(name)
    const db = await promisifyRequest(indexedDB.open(name))
    const transaction = db.transaction('snapshots', 'readonly')
    const committed = promisifyRequest(transaction)
    expect(await promisifyRequest(transaction.objectStore('snapshots').get('latest'))).toEqual({
      title: name,
    })
    await committed
    db.close()
  }
})

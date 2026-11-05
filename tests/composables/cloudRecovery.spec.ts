import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick } from 'vue'
import { useCloudSchemeSync } from '@/composables/useCloudSchemeSync'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorStore } from '@/stores/editorStore'
import { makeAppItem } from '../fixtures/item'
import { emptyCollectionTree } from '@/lib/collectionTree'
import type { EditorTransaction } from '@/types/editor'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useNotification', () => ({
  useNotification: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  sent: string[] = []
  closeCode?: number
  constructor(public url: string) {
    super()
    Socket.instances.push(this)
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }
  send(raw: string) {
    this.sent.push(raw)
  }
  close(code = 1000) {
    this.readyState = 3
    this.closeCode = code
    const event = new Event('close')
    Object.defineProperty(event, 'code', { value: code })
    this.dispatchEvent(event)
  }
  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }
}
let cleanup: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  Socket.instances = []
  setActivePinia(createPinia())
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'local' } })
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function setup() {
  const document = {
    roomCode: 'room',
    collectionTreeVersion: 3,
    revision: 1,
    updatedAt: 0,
    scheme: {
      name: 'Cloud',
      items: [makeAppItem({ internalId: 'a', groupId: 0 })],
      groupOrigins: [],
      collectionTree: emptyCollectionTree(),
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ document })))
  )
  const scope = effectScope(),
    sync = scope.run(() => useCloudSchemeSync())!
  cleanup = () => {
    sync.disconnect(false)
    scope.stop()
  }
  expect(await sync.joinRoom({ roomCode: 'room', displayName: 'Tester' })).toBe('room')
  const socket = Socket.instances[0]!,
    store = useEditorStore(),
    cloud = useCloudSchemeStore()
  socket.receive({
    type: 'hello',
    roomCode: 'room',
    collectionTreeVersion: 3,
    recoveryVersion: 1,
    revision: 1,
  })
  return { document, sync, socket, store, cloud }
}
function edit(store: ReturnType<typeof useEditorStore>, x = 42) {
  const scheme = store.activeScheme!,
    before = scheme.items.value[0]!,
    after = { ...before, x }
  const transaction: EditorTransaction = {
    id: crypto.randomUUID(),
    schemeId: scheme.id,
    createdAt: 1,
    intent: 'move',
    ops: [{ type: 'patch_items', changes: [{ itemId: before.internalId, before, after }] }],
  }
  scheme.items.value = [after]
  store.triggerSceneUpdate()
  store.enqueuePendingTransaction(transaction)
  return transaction
}
it('waits for snapshot, not hello, before uploading', async () => {
  const { document, socket, store, cloud } = await setup()
  edit(store)
  await nextTick()
  expect(cloud.status).toBe('connecting')
  expect(socket.sent).toHaveLength(0)
  socket.receive({ type: 'snapshot', document })
  expect(store.schemes.some((s) => s.source.value === 'local' && s.items.value[0]?.x === 42)).toBe(
    true
  )
  expect(store.pendingTransactions).toHaveLength(0)
})
it.each([0, 42])(
  'manually loads a full snapshot at x=%s without retrying unconfirmed edits',
  async (remoteX) => {
    const { document, sync, socket, store, cloud } = await setup()
    socket.receive({ type: 'snapshot', document })
    edit(store)
    await nextTick()
    expect(socket.sent).toHaveLength(1)
    const schemeId = store.activeSchemeId
    socket.close(1006)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(Socket.instances).toHaveLength(1)
    expect(cloud.status).toBe('disconnected')
    expect(store.pendingTransactions).toHaveLength(1)

    expect(await sync.reconnectActiveCloudScheme()).toBe(true)
    const next = Socket.instances[1]!
    expect(next.url).not.toContain('resumeRevision=')
    next.receive({ type: 'hello', collectionTreeVersion: 3, recoveryVersion: 1, revision: 2 })
    await nextTick()
    expect(cloud.revision).toBe(1)
    expect(next.sent).toHaveLength(0)
    // A replaced socket must not reset the new connection's state.
    socket.receive({ type: 'snapshot', document: { ...document, revision: 99 } })
    socket.close(1006)
    expect(cloud.status).toBe('connecting')
    next.receive({
      type: 'snapshot',
      document: {
        ...document,
        revision: 2,
        scheme: { ...document.scheme, items: [{ ...document.scheme.items[0]!, x: remoteX }] },
      },
    })
    await nextTick()
    expect(store.activeSchemeId).toBe(schemeId)
    expect(store.activeScheme!.items.value[0]!.x).toBe(remoteX)
    const copies = store.schemes.filter((s) => s.source.value === 'local')
    expect(copies).toHaveLength(1)
    expect(copies[0]!.items.value[0]!.x).toBe(42)
    expect(copies[0]!.filePath.value).toBeUndefined()
    expect(store.pendingTransactions).toHaveLength(0)
    expect(next.sent).toHaveLength(0)
    expect(cloud.revision).toBe(2)
    expect(cloud.status).toBe('connected')
    edit(store, 50)
    await nextTick()
    expect(JSON.parse(next.sent[0]!)).toMatchObject({
      baseRevision: 2,
      transaction: { ops: [{ changes: [{ after: { x: 50 } }] }] },
    })
  }
)
it('preserves overlapping local edits and waits for manual snapshot recovery', async () => {
  const { document, sync, socket, store, cloud } = await setup()
  socket.receive({ type: 'snapshot', document })
  edit(store)
  await nextTick()
  const before = document.scheme.items[0]!
  socket.receive({
    type: 'tx_committed',
    revision: 2,
    authorClientId: 'other',
    transaction: {
      id: 'remote',
      schemeId: 'room',
      createdAt: 1,
      intent: 'move',
      ops: [
        { type: 'patch_items', changes: [{ itemId: 'a', before, after: { ...before, x: 7 } }] },
      ],
    },
  })
  expect(socket.closeCode).toBe(1012)
  expect(cloud.status).toBe('disconnected')
  expect(cloud.revision).toBe(1)
  expect(store.schemes.find((s) => s.source.value === 'local')!.items.value[0]!.x).toBe(42)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(Socket.instances).toHaveLength(1)
  expect(await sync.reconnectActiveCloudScheme()).toBe(true)
  const next = Socket.instances[1]!
  next.receive({
    type: 'snapshot',
    document: {
      ...document,
      revision: 2,
      scheme: { ...document.scheme, items: [{ ...before, x: 7 }] },
    },
  })
  expect(store.schemes.filter((s) => s.source.value === 'local')).toHaveLength(1)
  expect(store.activeScheme!.items.value[0]!.x).toBe(7)
  expect(next.sent).toHaveLength(0)
})
it('ignores duplicate revisions and disconnects on a revision gap', async () => {
  const { document, socket, store, cloud } = await setup()
  socket.receive({ type: 'snapshot', document })
  const transaction = edit(store)
  await nextTick()
  socket.receive({ type: 'tx_committed', revision: 2, authorClientId: cloud.clientId, transaction })
  socket.receive({ type: 'tx_committed', revision: 2, authorClientId: cloud.clientId, transaction })
  expect(store.pendingTransactions).toHaveLength(0)
  expect(cloud.revision).toBe(2)
  socket.receive({ type: 'tx_committed', revision: 4, authorClientId: 'other', transaction })
  expect(socket.closeCode).toBe(1012)
  expect(cloud.revision).toBe(2)
  expect(cloud.status).toBe('disconnected')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(Socket.instances).toHaveLength(1)
})
it('reconstructs queued intent in a recovery copy even after an earlier own acknowledgment', async () => {
  const { document, socket, store, cloud } = await setup()
  socket.receive({ type: 'snapshot', document })
  const first = edit(store, 10)
  await nextTick()
  edit(store, 42)
  socket.receive({
    type: 'tx_committed',
    revision: 2,
    authorClientId: cloud.clientId,
    transaction: first,
  })
  expect(store.activeScheme!.items.value[0]!.x).toBe(10)
  socket.receive({
    type: 'reset',
    reason: 'version_mismatch',
    document: { ...document, revision: 3 },
  })
  expect(store.schemes.find((s) => s.source.value === 'local')!.items.value[0]!.x).toBe(42)
  expect(cloud.status).toBe('conflict')
})
it('does not create recovery copies for JSON property order, administrator renames or file metadata', async () => {
  const { document, sync, socket, store } = await setup()
  socket.receive({ type: 'snapshot', document })
  sync.disconnect(false)
  const scheme = store.activeScheme!,
    item = scheme.items.value[0]!
  scheme.items.value = [
    {
      ...(Object.fromEntries(Object.entries(item).reverse()) as typeof item),
      extra: { ...item.extra, Scale: { Z: 1, Y: 1, X: 1 } },
    },
  ]
  scheme.name.value = 'Before administrator rename'
  scheme.filePath.value = 'old-local-file.json'
  expect(await sync.reconnectActiveCloudScheme()).toBe(true)
  expect(store.schemes.filter((s) => s.source.value === 'local')).toHaveLength(0)
  expect(scheme.name.value).toBe('Cloud')
})
it.each(['position', 'extra'])(
  'preserves restored workspace %s changes without a pending queue',
  async (field) => {
    const { document, sync, socket, store } = await setup()
    socket.receive({ type: 'snapshot', document })
    sync.disconnect(false)
    const scheme = store.activeScheme!,
      before = scheme.items.value[0]!
    scheme.items.value = [
      field === 'position'
        ? { ...before, x: 42 }
        : { ...before, extra: { ...before.extra, CustomField: { value: 42 } } },
    ]
    const localItem = structuredClone(scheme.items.value[0]!)
    expect(store.pendingTransactions).toHaveLength(0)
    expect(await sync.reconnectActiveCloudScheme()).toBe(true)
    const copies = store.schemes.filter((s) => s.source.value === 'local')
    expect(copies).toHaveLength(1)
    expect(copies[0]!.items.value[0]).toEqual(localItem)
    expect(store.activeScheme!.id).toBe(scheme.id)
    expect(scheme.items.value).toEqual(document.scheme.items)
  }
)
it.each(['disconnect', 'rejection'])('retains pending work on %s', async (action) => {
  const { document, sync, socket, store, cloud } = await setup()
  socket.receive({ type: 'snapshot', document })
  edit(store)
  await nextTick()
  if (action === 'disconnect') sync.disconnect(false)
  else socket.close(1008)
  expect(store.schemes.find((s) => s.source.value === 'local')!.items.value[0]!.x).toBe(42)
  expect(store.pendingTransactions).toHaveLength(0)
  expect(cloud.status).toBe(action === 'disconnect' ? 'idle' : 'error')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(Socket.instances).toHaveLength(1)
})

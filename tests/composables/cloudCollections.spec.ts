import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'
import { useCloudSchemeSync } from '@/composables/useCloudSchemeSync'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useCollectionPanel } from '@/composables/editor/useCollectionPanel'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { emptyCollectionTree } from '@/lib/collectionTree'
import { makeAppItem } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useNotification', () => ({
  useNotification: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
afterEach(() => vi.unstubAllGlobals())

it('preserves queued tree edits across acknowledgments, syncs undo, and resets conflicts without losing personal state', async () => {
  const sockets: FakeSocket[] = []
  class FakeSocket extends EventTarget {
    static OPEN = 1
    readyState = 1
    sent: any[] = []
    constructor(public url: string) {
      super()
      sockets.push(this)
      queueMicrotask(() => this.dispatchEvent(new Event('open')))
    }
    send(raw: string) {
      this.sent.push(JSON.parse(raw))
    }
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
    receive(message: unknown) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
    }
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'local' } })
  const document = {
    roomCode: 'room',
    collectionTreeVersion: 3,
    revision: 1,
    updatedAt: 0,
    scheme: {
      name: 'Cloud',
      items: [makeAppItem({ groupId: 7 })],
      groupOrigins: [],
      collectionTree: emptyCollectionTree(),
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ document })))
  )
  setActivePinia(createPinia())
  const scope = effectScope()
  const sync = scope.run(() => useCloudSchemeSync())!
  try {
    expect(await sync.joinRoom({ roomCode: 'room', displayName: 'Tester' })).toBe('room')
    const socket = sockets[0]!
    expect(socket.url).toContain('collectionTreeVersion=3')
    socket.receive({ type: 'hello', roomCode: 'room', revision: 1, collectionTreeVersion: 3 })
    socket.receive({ type: 'snapshot', document })
    const store = useEditorStore(),
      cloud = useCloudSchemeStore()
    const scheme = store.activeScheme!
    const panel = useCollectionPanel(ref(''))
    expect(panel.canEdit.value).toBe(true)
    const id = panel.createCollection()!
    panel.renameCollection(id, 'House')
    await nextTick()
    expect(socket.sent).toHaveLength(1)
    const first = socket.sent[0].transaction
    socket.receive({
      type: 'tx_committed',
      revision: 2,
      authorClientId: cloud.clientId,
      transaction: first,
    })
    expect(scheme.collectionTree.value.nodes[0]?.name).toBe('House')
    expect(socket.sent).toHaveLength(2)
    const second = socket.sent[1].transaction
    expect(socket.sent[1].baseRevision).toBe(2)
    socket.receive({
      type: 'tx_committed',
      revision: 3,
      authorClientId: cloud.clientId,
      transaction: second,
    })
    expect(store.pendingTransactions).toHaveLength(0)
    useEditorHistory().undo()
    await nextTick()
    const inverse = socket.sent[2].transaction
    expect(inverse.ops[0].before.nodes[0].name).toBe('House')
    expect(inverse.ops[0].after.nodes[0].name).toBe('groups.newCollection')
    socket.receive({
      type: 'tx_committed',
      revision: 4,
      authorClientId: cloud.clientId,
      transaction: inverse,
    })
    scheme.collapsedCollectionIds.value = new Set([id])
    store.setCollectionRestriction(id, 'hidden', true)
    const remote = structuredClone(scheme.collectionTree.value)
    remote.nodes[0]!.name = 'Remote'
    socket.receive({
      type: 'tx_committed',
      revision: 5,
      authorClientId: 'other',
      transaction: {
        id: 'remote',
        schemeId: scheme.id,
        createdAt: 0,
        intent: 'collection.rename',
        ops: [{ type: 'set_collection_tree', before: scheme.collectionTree.value, after: remote }],
      },
    })
    expect(scheme.collectionTree.value.nodes[0]?.name).toBe('Remote')
    expect(scheme.history.value!.transactionUndoStack.every((entry) => entry.stale)).toBe(true)
    panel.renameCollection(id, 'Conflicting')
    await nextTick()
    socket.receive({
      type: 'reset',
      reason: 'version_mismatch',
      document: {
        ...document,
        revision: 5,
        scheme: { ...document.scheme, collectionTree: remote },
      },
    })
    expect(scheme.collectionTree.value.nodes[0]?.name).toBe('Remote')
    expect(store.pendingTransactions).toHaveLength(0)
    expect(scheme.collapsedCollectionIds.value.has(id)).toBe(true)
    expect(scheme.hiddenCollectionIds.value.has(id)).toBe(true)
    expect(cloud.status).toBe('conflict')
    // 较早的服务端确认也应保留之后排队的名称字段修改。
    socket.receive({ type: 'hello', roomCode: 'room', revision: 5, collectionTreeVersion: 3 })
    const sent = socket.sent.length
    const version = store.sceneVersion
    useEditorGroups().renameGroup(7, 'First name')
    useEditorGroups().renameGroup(7, 'Latest name')
    await nextTick()
    expect(socket.sent).toHaveLength(sent + 1)
    expect(socket.sent[sent].transaction.ops.map((op: any) => op.type)).toEqual(['set_group_names'])
    socket.receive({
      type: 'tx_committed',
      revision: 6,
      authorClientId: cloud.clientId,
      transaction: socket.sent[sent].transaction,
    })
    expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)?.name).toBe(
      'Latest name'
    )
    expect(socket.sent).toHaveLength(sent + 2)
    socket.receive({
      type: 'tx_committed',
      revision: 7,
      authorClientId: cloud.clientId,
      transaction: socket.sent[sent + 1].transaction,
    })
    expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)?.name).toBe(
      'Latest name'
    )
    expect(store.pendingTransactions).toHaveLength(0)
    socket.receive({
      type: 'tx_committed',
      revision: 8,
      authorClientId: 'other',
      transaction: {
        id: 'remote-name',
        schemeId: scheme.id,
        createdAt: 0,
        intent: 'group.rename',
        ops: [
          { type: 'set_group_names', before: [[7, 'Latest name']], after: [[7, 'Remote name']] },
        ],
      },
    })
    expect(scheme.collectionTree.value.groups.find((group) => group.groupId === 7)?.name).toBe(
      'Remote name'
    )
    expect(store.sceneVersion).toBe(version)
    socket.receive({ type: 'hello', roomCode: 'room', revision: 5 })
    expect(panel.canEdit.value).toBe(false)
  } finally {
    sync.disconnect(false)
    scope.stop()
  }
})

it.each([1, 2])('rejects cloud schema %s before replacing or opening a scheme', async (version) => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  const store = useEditorStore()
  store.createScheme('Keep local')
  const original = store.activeScheme!
  original.items.value = [makeAppItem({ groupId: 7 })]
  const items = original.items.value
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            document: {
              collectionTreeVersion: version,
              revision: 1,
              scheme: { name: 'Old server', items: [], groupOrigins: [] },
            },
          })
        )
    )
  )
  const scope = effectScope()
  const sync = scope.run(() => useCloudSchemeSync())!
  try {
    expect(await sync.joinRoom({ roomCode: 'room', displayName: 'Tester' })).toBeNull()
    expect(store.schemes).toHaveLength(1)
    expect(store.activeScheme).toBe(original)
    expect(store.activeScheme!.items.value).toBe(items)
  } finally {
    sync.disconnect(false)
    scope.stop()
  }
})

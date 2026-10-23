import { computed, ref, triggerRef, watch } from 'vue'
import {
  applyEditorTransactionToScheme,
  cloudHistoryCountsFromItemBuckets,
  collectTransactionItemBuckets,
  collectTransactionTouchedItemIds,
  collectTransactionTouchedGroupIds,
  transactionAffectsScene,
} from '@/lib/editorTransactions'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useNotification } from '@/composables/useNotification'
import { useI18n } from '@/composables/useI18n'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import {
  getGroupChanges,
  reconcileCollectionGroups,
  applyCollectionStructure,
  patchGroupNames,
} from '@/lib/collectionTree'
import type {
  CloudSchemeDocument,
  CloudSnapshotResponse,
  CloudWsIncomingMessage,
  CreateCloudSchemeResponse,
} from '@/types/cloudScheme'
import type { EditorTransaction } from '@/types/editor'

const DISPLAY_NAME_STORAGE_KEY = 'cloud_scheme_display_name'

// 单个云协同连接在前端的“唯一会话对象”。
// 整个文件围绕它运作：谁是 currentSession，谁才有资格收发消息。
interface CloudSession {
  roomCode: string
  displayName: string
  clientId: string
  schemeId: string | null
  socket: WebSocket | null
  inFlightTransactionId: string | null
}

// 当前仍然有效的云协同会话。
// 只允许存在一个；新会话开始时，旧会话会被立即作废。
let currentSession: CloudSession | null = null
let stopTransactionWatch: (() => void) | null = null
const isApplyingRemoteUpdate = ref(false)

// presence 对比用快照（模块级，避免多处 useCloudSchemeSync() 时 disconnect 清不到正确 ref）
const previousPresenceUsers = ref<{ clientId: string; displayName: string }[]>([])
const pendingConnectedEventType = ref<'connected' | 'reconnected' | null>(null)

// createRoom / joinRoom 中会改动 activeSchemeId，需暂时抑制「按标签切换重连」以免打断当前入房
let suppressActiveTabCloudSync = 0

// 保证只注册一次：激活方案变化时维持「单连接 ↔ 当前云方案 tab」
let activeSchemeCloudWatchRegistered = false

function createClientId() {
  return crypto.randomUUID()
}

function normalizeDisplayName(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRoomCode(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

// 创建一个新的前端会话对象。
// 注意：这里还没有真正连接服务器，只是先把本地状态容器准备好。
function createSession(displayName: string, roomCode = ''): CloudSession {
  return {
    roomCode,
    displayName,
    clientId: createClientId(),
    schemeId: null,
    socket: null,
    inFlightTransactionId: null,
  }
}

// 判断某个异步回调对应的 session 是否仍然是“当前会话”。
// 如果不是，就说明它已经过期，必须忽略它，避免旧连接污染当前状态。
function isActiveSession(session: CloudSession | null) {
  return !!session && currentSession === session
}

// 关闭某个会话持有的 WebSocket。
// 这里不直接管全局状态，只负责把这个 session 自己的 socket 关掉。
function closeSessionSocket(session: CloudSession | null) {
  if (!session?.socket) return

  const socket = session.socket
  session.socket = null

  if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
    socket.close()
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }
  return data as T
}

export function useCloudSchemeSync() {
  const editorStore = useEditorStore()
  const cloudStore = useCloudSchemeStore()
  const { markTransactionCommitted, markTransactionsStale } = useEditorHistory()
  const notification = useNotification()
  const { t } = useI18n()

  function notifyCloudApiError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'Room not found') {
      notification.error(t('cloudScheme.error.roomNotFound'))
      return
    }
    if (message === 'Room already exists') {
      notification.error(t('cloudScheme.error.roomAlreadyExists'))
      return
    }
    if (message === 'Authentication required') {
      notification.error(t('cloudScheme.error.authRequired'))
      return
    }
    if (!message || message === 'Request failed') {
      notification.error(t('cloudScheme.error.connectFailed'))
      return
    }
    notification.error(t('cloudScheme.error.requestFailed', { reason: message }))
  }

  const currentCloudScheme = computed(() => {
    const scheme = editorStore.activeScheme
    if (!scheme || scheme.source.value !== 'cloud') {
      return null
    }

    return {
      schemeId: scheme.id,
      roomCode: scheme.cloudRoomCode.value || cloudStore.roomCode,
      status: cloudStore.schemeId === scheme.id ? cloudStore.status : 'disconnected',
      users: cloudStore.schemeId === scheme.id ? cloudStore.users : [],
    }
  })

  const shareCode = computed(() => currentCloudScheme.value?.roomCode || '')

  function getStoredDisplayName() {
    return localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || ''
  }

  function setStoredDisplayName(name: string) {
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name)
  }

  function createHistoryEventId() {
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cloud_evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }

  /** 写入云方案 Pinia 历史列表；remote_tx 可带 itemBuckets 供 UI 按物品去重合并 */
  function appendHistoryEvent(
    event: Omit<
      Parameters<typeof cloudStore.appendHistoryEvent>[0],
      'id' | 'createdAt' | 'actorDisplayName'
    > & {
      actorDisplayName?: string
    }
  ) {
    let actorDisplayName = event.actorDisplayName

    if (!actorDisplayName && event.actorClientId) {
      actorDisplayName = cloudStore.users.find(
        (user) => user.clientId === event.actorClientId
      )?.displayName
    }

    cloudStore.appendHistoryEvent({
      id: createHistoryEventId(),
      type: event.type,
      createdAt: Date.now(),
      actorClientId: event.actorClientId,
      actorDisplayName,
      itemCount: event.itemCount,
      addedCount: event.addedCount,
      removedCount: event.removedCount,
      updatedCount: event.updatedCount,
      itemBuckets: event.itemBuckets,
      collectionTreeChanged: event.collectionTreeChanged,
    })
  }

  function appendPresenceHistory(users: { clientId: string; displayName: string }[]) {
    const previousUsersById = new Map(
      previousPresenceUsers.value.map((user) => [user.clientId, user])
    )
    const nextUsersById = new Map(users.map((user) => [user.clientId, user]))

    for (const user of users) {
      if (!previousUsersById.has(user.clientId)) {
        appendHistoryEvent({
          type: 'user_joined',
          actorClientId: user.clientId,
          actorDisplayName: user.displayName,
        })
      }
    }

    for (const user of previousPresenceUsers.value) {
      if (!nextUsersById.has(user.clientId)) {
        appendHistoryEvent({
          type: 'user_left',
          actorClientId: user.clientId,
          actorDisplayName: user.displayName,
        })
      }
    }

    previousPresenceUsers.value = users.map((user) => ({
      clientId: user.clientId,
      displayName: user.displayName,
    }))
  }

  // 监听本地编辑事务队列。
  // 只要事务版本、云端修订号、连接状态等发生变化，就尝试把待发送事务推给服务器。
  function ensureTransactionWatcher() {
    if (stopTransactionWatch) return

    stopTransactionWatch = watch(
      [
        () => editorStore.transactionVersion,
        () => cloudStore.revision,
        () => cloudStore.status,
        () => cloudStore.schemeId,
      ],
      () => {
        void flushPendingTransactions()
      },
      { immediate: true }
    )
  }

  function stopTransactionWatcher() {
    stopTransactionWatch?.()
    stopTransactionWatch = null
  }

  // 用云端发回来的完整文档替换本地方案内容。
  // 它既用于首次加入房间，也用于冲突重置、整份快照覆盖等场景。
  function applyRemoteDocument(document: CloudSchemeDocument, session?: CloudSession | null) {
    if (session && !isActiveSession(session)) {
      return
    }
    if (document.collectionTreeVersion !== 2) {
      if (session) abortSessionAttempt(session)
      notification.error(t('groups.syncUnavailable'))
      return
    }

    isApplyingRemoteUpdate.value = true

    try {
      let schemeId = session?.schemeId || cloudStore.schemeId
      if (!schemeId) {
        schemeId = editorStore.openCloudSchemeSnapshot(document.scheme, document.roomCode)
      } else {
        const replaced = editorStore.replaceSchemeSnapshot(schemeId, document.scheme, {
          preserveViewState: true,
        })
        if (!replaced) {
          schemeId = editorStore.openCloudSchemeSnapshot(document.scheme, document.roomCode)
        }
      }

      const restoredScheme = editorStore.getSchemeById(schemeId)
      if (restoredScheme)
        restoredScheme.collectionsSupported.value = document.collectionTreeVersion === 2
      editorStore.clearPendingTransactions(schemeId)
      editorStore.setSchemeCloudMeta(schemeId, {
        source: 'cloud',
        cloudRoomCode: document.roomCode,
      })

      if (session && isActiveSession(session)) {
        session.schemeId = schemeId
        session.roomCode = document.roomCode
        session.inFlightTransactionId = null
      }

      cloudStore.schemeId = schemeId
      cloudStore.revision = document.revision
      cloudStore.status = 'connected'
    } finally {
      isApplyingRemoteUpdate.value = false
    }
  }

  function applyCommittedTransaction(transaction: EditorTransaction) {
    const renderVersion = editorStore.sceneVersion
    const scheme = editorStore.getSchemeById(transaction.schemeId)
    if (!scheme) return

    const previousItems = scheme.items.value
    const queuedMetadata = editorStore.pendingTransactions
      .filter((pending) => pending.schemeId === scheme.id && pending.id !== transaction.id)
      .flatMap((pending) =>
        pending.ops.filter(
          (op) => op.type === 'set_collection_tree' || op.type === 'set_group_names'
        )
      )

    isApplyingRemoteUpdate.value = true
    try {
      applyEditorTransactionToScheme(scheme, transaction)
      const changes = getGroupChanges(previousItems, scheme.items.value)
      // 较早的服务端确认不能回退之后排队的改名或移动操作。
      for (const operation of queuedMetadata) {
        if (operation.type === 'set_collection_tree') {
          const structure = reconcileCollectionGroups(operation.after, changes)
          scheme.collectionTree.value = applyCollectionStructure(
            scheme.collectionTree.value,
            structure
          )
        } else {
          scheme.collectionTree.value = patchGroupNames(
            scheme.collectionTree.value,
            operation.before,
            operation.after
          )
        }
      }
      triggerRef(scheme.groupOrigins)
      if (transactionAffectsScene(transaction)) editorStore.triggerSceneUpdate()
      else if (editorStore.constrainSelectionToEditable()) editorStore.triggerSelectionUpdate()
      editorStore.recordRenderTransaction(transaction, renderVersion)
    } finally {
      isApplyingRemoteUpdate.value = false
    }
  }

  // 把当前方案里“排队等待上传”的下一条事务发给服务端。
  // 这里故意一次只允许飞一条，避免前后顺序乱掉。
  async function flushPendingTransactions() {
    const session = currentSession
    if (!session) return
    if (isApplyingRemoteUpdate.value) return
    if (!session.socket || session.socket.readyState !== WebSocket.OPEN) return
    if (!cloudStore.isConnected || !session.schemeId) return
    if (cloudStore.schemeId !== session.schemeId) return
    if (session.inFlightTransactionId) return

    const transaction = editorStore.peekPendingTransaction(session.schemeId)
    if (!transaction) return

    if (
      transaction.ops.some((op) => op.type === 'set_collection_tree') &&
      !editorStore.getSchemeById(session.schemeId)?.collectionsSupported.value
    ) {
      cloudStore.setError(t('groups.syncUnavailable'))
      return
    }
    session.inFlightTransactionId = transaction.id
    cloudStore.status = 'syncing'
    session.socket.send(
      JSON.stringify({
        type: 'push_tx',
        clientId: session.clientId,
        baseRevision: cloudStore.revision,
        transaction,
      })
    )
  }

  // WebSocket 消息总入口。
  // 先确认消息来自当前有效 session，再根据消息类型分别处理。
  function handleIncomingMessage(session: CloudSession, raw: string) {
    if (!isActiveSession(session)) {
      return
    }

    const message = JSON.parse(raw) as CloudWsIncomingMessage

    switch (message.type) {
      case 'hello':
        if (session.schemeId) {
          const scheme = editorStore.getSchemeById(session.schemeId)
          if (scheme) scheme.collectionsSupported.value = message.collectionTreeVersion === 2
        }
        if (message.collectionTreeVersion !== 2) {
          abortSessionAttempt(session)
          notification.error(t('groups.syncUnavailable'))
          return
        }
        cloudStore.revision = message.revision
        cloudStore.status = 'connected'
        if (pendingConnectedEventType.value) {
          appendHistoryEvent({
            type: pendingConnectedEventType.value,
            actorClientId: session.clientId,
            actorDisplayName: session.displayName,
          })
          pendingConnectedEventType.value = null
        }
        void flushPendingTransactions()
        return
      case 'presence':
        appendPresenceHistory(message.users)
        cloudStore.users = message.users
        return
      case 'error':
        cloudStore.setError(message.message)
        notification.error(message.message)
        return
      case 'reset':
        if (session.schemeId) {
          editorStore.clearPendingTransactions(session.schemeId)
        }
        session.inFlightTransactionId = null
        applyRemoteDocument(message.document, session)
        cloudStore.status = 'conflict'
        appendHistoryEvent({
          type: 'conflict_reload',
          actorClientId: session.clientId,
          actorDisplayName: session.displayName,
        })
        notification.warning(t('cloudScheme.toast.conflict'))
        return
      case 'snapshot':
        applyRemoteDocument(message.document, session)
        return
      case 'tx_committed': {
        cloudStore.revision = message.revision
        cloudStore.status = 'connected'
        applyCommittedTransaction(message.transaction)

        const isOwn = message.authorClientId === session.clientId
        // 撤销栈是否标脏：看谁 touch 了哪些 id（与历史展示的 buckets 正交）
        const touchedItemIds = collectTransactionTouchedItemIds(
          message.transaction,
          editorStore.getSchemeById(message.transaction.schemeId)?.items.value
        )
        // 历史列表：按物品 id 分桶 + 派生 count，避免「8 次移动同一物」显示成 8 个更新
        const itemBuckets = collectTransactionItemBuckets(message.transaction)
        const counts = cloudHistoryCountsFromItemBuckets(itemBuckets)

        if (isOwn) {
          editorStore.acknowledgePendingTransaction(message.transaction.id)
          markTransactionCommitted(
            message.transaction.schemeId,
            message.transaction.id,
            message.transaction
          )
          session.inFlightTransactionId = null
        } else {
          markTransactionsStale(
            message.transaction.schemeId,
            touchedItemIds,
            collectTransactionTouchedGroupIds(message.transaction),
            message.transaction.ops.some((op) => op.type === 'set_collection_tree')
          )
        }

        appendHistoryEvent({
          type: 'remote_tx',
          actorClientId: message.authorClientId,
          itemCount: counts.itemCount,
          addedCount: counts.addedCount,
          removedCount: counts.removedCount,
          updatedCount: counts.updatedCount,
          itemBuckets,
          collectionTreeChanged: message.transaction.ops.some(
            (op) => op.type === 'set_collection_tree'
          ),
        })

        void flushPendingTransactions()
        return
      }
    }
  }

  // 建立当前 session 的 WebSocket 连接。
  // 即使旧 socket 晚到 open / close，也会因为 session 身份不匹配而被忽略。
  async function connectSocket(session: CloudSession) {
    closeSessionSocket(session)

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/cloud-schemes/ws?code=${encodeURIComponent(session.roomCode)}&clientId=${encodeURIComponent(session.clientId)}&displayName=${encodeURIComponent(session.displayName)}&collectionTreeVersion=2`

    return new Promise<boolean>((resolve, reject) => {
      const nextSocket = new WebSocket(wsUrl)
      session.socket = nextSocket
      let settled = false

      const resolveOnce = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }

      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      nextSocket.addEventListener('open', () => {
        if (!isActiveSession(session) || session.socket !== nextSocket) {
          nextSocket.close()
          resolveOnce(false)
          return
        }

        resolveOnce(true)
      })

      nextSocket.addEventListener('message', (event) => {
        if (!isActiveSession(session) || session.socket !== nextSocket) {
          return
        }

        handleIncomingMessage(session, event.data)
      })

      nextSocket.addEventListener('close', () => {
        if (session.socket === nextSocket) {
          session.socket = null
        }

        if (isActiveSession(session)) {
          session.inFlightTransactionId = null
          if (cloudStore.roomCode) {
            cloudStore.status = 'disconnected'
          }
        }

        resolveOnce(false)
      })

      nextSocket.addEventListener('error', () => {
        if (!isActiveSession(session) || session.socket !== nextSocket) {
          resolveOnce(false)
          return
        }

        rejectOnce(new Error('WebSocket connection failed'))
        cloudStore.setError(t('cloudScheme.error.connectFailed'))
      })
    })
  }

  // 把一个已经创建好的 session 正式提升为“已入房会话”。
  // 这里会把 roomCode / schemeId / revision 写入 store，并开始真正连接 WebSocket。
  async function startSession(
    session: CloudSession,
    params: {
      roomCode: string
      schemeId: string
      revision: number
      connectedEventType: 'connected' | 'reconnected'
    }
  ) {
    if (!isActiveSession(session)) {
      return false
    }

    session.roomCode = params.roomCode
    session.schemeId = params.schemeId
    session.inFlightTransactionId = null

    cloudStore.startSession({
      roomCode: params.roomCode,
      schemeId: params.schemeId,
      clientId: session.clientId,
      revision: params.revision,
    })
    cloudStore.clearHistoryEvents()
    previousPresenceUsers.value = []
    pendingConnectedEventType.value = params.connectedEventType

    ensureTransactionWatcher()
    const connected = await connectSocket(session)
    return connected && isActiveSession(session)
  }

  // 开启一次新的“入房尝试”。
  // 最关键的一步是先 disconnect(false)：它会让旧会话彻底失效，保证前端同时只认一个连接。
  function beginSessionAttempt(displayName: string, roomCode = '') {
    disconnect(false)
    const session = createSession(displayName, roomCode)
    currentSession = session
    return session
  }

  // 如果本次尝试中途失败，就把它干净地收掉。
  function abortSessionAttempt(session: CloudSession) {
    if (!isActiveSession(session)) {
      return
    }

    disconnect(false)
  }

  // 创建一个新的云方案房间，并把当前本地方案切换成这个云房间对应的方案。
  async function createRoom(options: { roomCode?: string; displayName: string }) {
    const activeScheme = editorStore.activeScheme
    if (!activeScheme) {
      notification.warning(t('cloudScheme.error.noActiveScheme'))
      return null
    }

    const roomCode = normalizeRoomCode(options.roomCode)
    const displayName = normalizeDisplayName(options.displayName)
    if (!displayName) {
      notification.error(t('cloudScheme.error.invalidDisplayName'))
      return null
    }

    suppressActiveTabCloudSync++
    const sourceSchemeId = activeScheme.id
    const snapshot = buildSharedSchemeSnapshot(activeScheme)
    const session = beginSessionAttempt(displayName, roomCode)
    setStoredDisplayName(displayName)

    try {
      const data = await requestJson<CreateCloudSchemeResponse>('/api/cloud-schemes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomCode: roomCode || undefined,
          snapshot,
        }),
      })

      if (!isActiveSession(session)) {
        return null
      }

      if (data.document.collectionTreeVersion !== 2) {
        throw new Error(t('groups.syncUnavailable'))
      }
      const schemeId = editorStore.normalizeSchemeAsCloudRoom(sourceSchemeId, data.roomCode, {
        resetHistory: true,
      })
      if (!schemeId) {
        throw new Error('Failed to normalize cloud scheme identity')
      }
      editorStore.getSchemeById(schemeId)!.collectionsSupported.value =
        data.document.collectionTreeVersion === 2

      const started = await startSession(session, {
        roomCode: data.roomCode,
        schemeId,
        revision: data.document.revision,
        connectedEventType: 'connected',
      })

      if (!started) {
        abortSessionAttempt(session)
        return null
      }

      notification.success(t('cloudScheme.toast.created'))
      return data.roomCode
    } catch (error) {
      abortSessionAttempt(session)
      notifyCloudApiError(error)
      return null
    } finally {
      suppressActiveTabCloudSync--
    }
  }

  // 加入一个已经存在的云方案房间。
  async function joinRoom(options: { roomCode: string; displayName: string }) {
    const roomCode = normalizeRoomCode(options.roomCode)
    const displayName = normalizeDisplayName(options.displayName)

    if (!roomCode) {
      notification.error(t('cloudScheme.error.invalidRoomCode'))
      return null
    }

    if (!displayName) {
      notification.error(t('cloudScheme.error.invalidDisplayName'))
      return null
    }

    suppressActiveTabCloudSync++
    const session = beginSessionAttempt(displayName, roomCode)
    setStoredDisplayName(displayName)

    try {
      const data = await requestJson<CloudSnapshotResponse>('/api/cloud-schemes/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode }),
      })

      if (!isActiveSession(session)) {
        return null
      }

      if (data.document.collectionTreeVersion !== 2) throw new Error(t('groups.syncUnavailable'))
      const schemeId = editorStore.openCloudSchemeSnapshot(data.document.scheme, roomCode)
      editorStore.setSchemeCloudMeta(schemeId, {
        source: 'cloud',
        cloudRoomCode: roomCode,
      })

      const started = await startSession(session, {
        roomCode,
        schemeId,
        revision: data.document.revision,
        connectedEventType: 'connected',
      })

      if (!started) {
        abortSessionAttempt(session)
        return null
      }

      notification.success(t('cloudScheme.toast.joined'))
      return roomCode
    } catch (error) {
      abortSessionAttempt(session)
      notifyCloudApiError(error)
      return null
    } finally {
      suppressActiveTabCloudSync--
    }
  }

  async function copyShareCode() {
    if (!shareCode.value) return false
    await navigator.clipboard.writeText(shareCode.value)
    notification.success(t('cloudScheme.toast.codeCopied'))
    return true
  }

  // 启动时如果发现当前激活方案本来就是云方案，就尝试静默重连。
  async function reconnectActiveCloudScheme() {
    const scheme = editorStore.activeScheme
    if (!scheme || scheme.source.value !== 'cloud') {
      return false
    }

    const roomCode = normalizeRoomCode(scheme.cloudRoomCode.value)
    const displayName = normalizeDisplayName(getStoredDisplayName())
    if (!roomCode || !displayName) {
      return false
    }

    const session = beginSessionAttempt(displayName, roomCode)

    try {
      const data = await requestJson<CloudSnapshotResponse>('/api/cloud-schemes/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode }),
      })

      if (!isActiveSession(session)) {
        return false
      }

      if (data.document.collectionTreeVersion !== 2) throw new Error(t('groups.syncUnavailable'))
      const schemeId = editorStore.openCloudSchemeSnapshot(data.document.scheme, roomCode)
      editorStore.setSchemeCloudMeta(schemeId, {
        source: 'cloud',
        cloudRoomCode: roomCode,
      })

      const started = await startSession(session, {
        roomCode,
        schemeId,
        revision: data.document.revision,
        connectedEventType: 'reconnected',
      })

      if (!started) {
        abortSessionAttempt(session)
        return false
      }

      return true
    } catch (error) {
      abortSessionAttempt(session)
      console.warn('[CloudScheme] Auto reconnect failed:', error)
      return false
    }
  }

  // 主动断开当前云会话。
  // 会关闭 socket、清理挂起事务、停止 watcher，并把 cloudStore 重置回空状态。
  function disconnect(showToast = true) {
    const hadSession = !!cloudStore.roomCode
    const schemeId = cloudStore.schemeId
    const session = currentSession

    currentSession = null
    closeSessionSocket(session)

    if (schemeId) {
      editorStore.clearPendingTransactions(schemeId)
    }

    stopTransactionWatcher()
    previousPresenceUsers.value = []
    pendingConnectedEventType.value = null
    cloudStore.clearSession()

    if (hadSession && showToast) {
      notification.info(t('cloudScheme.toast.disconnected'))
    }
  }

  /**
   * 当前激活 tab 为云方案且与已连接房间一致 → 不动；否则断掉旧连接并按当前 tab 静默重连。
   * 非云方案 / 无方案（如文档 tab）→ 断开 WS。
   */
  async function syncCloudConnectionToActiveScheme() {
    if (suppressActiveTabCloudSync > 0) return

    const scheme = editorStore.activeScheme
    if (!scheme || scheme.source.value !== 'cloud') {
      disconnect(false)
      return
    }

    if (cloudStore.schemeId === scheme.id && cloudStore.isConnected) {
      return
    }

    await reconnectActiveCloudScheme()
  }

  if (!activeSchemeCloudWatchRegistered) {
    activeSchemeCloudWatchRegistered = true
    watch(
      () => editorStore.activeSchemeId,
      () => {
        void syncCloudConnectionToActiveScheme()
      },
      { flush: 'post' }
    )
  }

  return {
    currentCloudScheme,
    shareCode,
    isApplyingRemoteUpdate: computed(() => isApplyingRemoteUpdate.value),
    createRoom,
    joinRoom,
    copyShareCode,
    reconnectActiveCloudScheme,
    syncCloudConnectionToActiveScheme,
    disconnect,
    getStoredDisplayName,
  }
}

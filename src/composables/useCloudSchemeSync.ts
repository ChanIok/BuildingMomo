import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useNotification } from '@/composables/useNotification'
import { useI18n } from '@/composables/useI18n'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import type {
  CloudSchemeDocument,
  CloudSnapshotResponse,
  CloudWsIncomingMessage,
  CreateCloudSchemeResponse,
} from '@/types/cloudScheme'

const DISPLAY_NAME_STORAGE_KEY = 'cloud_scheme_display_name'

let socket: WebSocket | null = null
let stopSyncWatch: (() => void) | null = null
const isApplyingRemoteUpdate = ref(false)
const pendingRemoteSyncSkips = ref(0)

function createClientId() {
  return crypto.randomUUID()
}

function normalizeDisplayName(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRoomCode(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }
  return data as T
}

export function useCloudSchemeSync() {
  const editorStore = useEditorStore()
  const cloudStore = useCloudSchemeStore()
  const notification = useNotification()
  const { t } = useI18n()

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

  const debouncedPushSnapshot = useDebounceFn(() => {
    pushCurrentSnapshot()
  }, 500)

  function getStoredDisplayName() {
    return localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || ''
  }

  function setStoredDisplayName(name: string) {
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name)
  }

  function ensureSceneWatcher() {
    if (stopSyncWatch) return

    stopSyncWatch = watch(
      [
        () => editorStore.sceneVersion,
        () => editorStore.activeSchemeId,
        () =>
          cloudStore.schemeId
            ? editorStore.getSchemeById(cloudStore.schemeId)?.name.value || ''
            : '',
        () =>
          cloudStore.schemeId
            ? editorStore.getSchemeById(cloudStore.schemeId)?.filePath.value || ''
            : '',
      ],
      () => {
        if (pendingRemoteSyncSkips.value > 0) {
          pendingRemoteSyncSkips.value--
          return
        }
        if (isApplyingRemoteUpdate.value) return
        if (!cloudStore.isConnected) return
        if (!cloudStore.schemeId || editorStore.activeSchemeId !== cloudStore.schemeId) return
        debouncedPushSnapshot()
      }
    )
  }

  function stopSceneWatcher() {
    stopSyncWatch?.()
    stopSyncWatch = null
  }

  async function applyRemoteDocument(document: CloudSchemeDocument) {
    pendingRemoteSyncSkips.value++
    isApplyingRemoteUpdate.value = true
    try {
      let schemeId = cloudStore.schemeId
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

      editorStore.setSchemeCloudMeta(schemeId, {
        source: 'cloud',
        cloudRoomCode: document.roomCode,
      })
      cloudStore.schemeId = schemeId
      cloudStore.revision = document.revision
      cloudStore.status = 'connected'
    } finally {
      isApplyingRemoteUpdate.value = false
    }
  }

  function handleIncomingMessage(raw: string) {
    const message = JSON.parse(raw) as CloudWsIncomingMessage

    switch (message.type) {
      case 'hello':
        cloudStore.revision = message.revision
        cloudStore.status = 'connected'
        return
      case 'ack':
        cloudStore.revision = message.revision
        cloudStore.status = 'connected'
        return
      case 'presence':
        cloudStore.users = message.users
        return
      case 'error':
        cloudStore.setError(message.message)
        notification.error(message.message)
        return
      case 'reset':
        void applyRemoteDocument(message.document)
        cloudStore.status = 'conflict'
        notification.warning(t('cloudScheme.toast.conflict'))
        return
      case 'snapshot':
        if (message.authorClientId === cloudStore.clientId) {
          cloudStore.revision = message.document.revision
          cloudStore.status = 'connected'
          return
        }

        void applyRemoteDocument(message.document)
        notification.info(t('cloudScheme.toast.remoteUpdated'))
        return
    }
  }

  async function connectSocket(params: {
    roomCode: string
    clientId: string
    displayName: string
  }) {
    if (socket) {
      socket.close()
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/api/cloud-schemes/ws?code=${encodeURIComponent(params.roomCode)}&clientId=${encodeURIComponent(params.clientId)}&displayName=${encodeURIComponent(params.displayName)}`

    await new Promise<void>((resolve, reject) => {
      const nextSocket = new WebSocket(wsUrl)
      let settled = false

      nextSocket.addEventListener('open', () => {
        socket = nextSocket
        if (!settled) {
          settled = true
          resolve()
        }
      })

      nextSocket.addEventListener('message', (event) => {
        handleIncomingMessage(event.data)
      })

      nextSocket.addEventListener('close', () => {
        if (socket === nextSocket) {
          socket = null
          if (cloudStore.roomCode) {
            cloudStore.status = 'disconnected'
          }
        }
      })

      nextSocket.addEventListener('error', () => {
        if (!settled) {
          settled = true
          reject(new Error('WebSocket connection failed'))
        }
        cloudStore.setError(t('cloudScheme.error.connectFailed'))
      })
    })
  }

  async function startSession(params: {
    roomCode: string
    schemeId: string
    revision: number
    displayName: string
  }) {
    const clientId = createClientId()
    cloudStore.startSession({
      roomCode: params.roomCode,
      schemeId: params.schemeId,
      clientId,
      revision: params.revision,
    })
    ensureSceneWatcher()
    await connectSocket({
      roomCode: params.roomCode,
      clientId,
      displayName: params.displayName,
    })
  }

  function pushCurrentSnapshot() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (!cloudStore.schemeId) return

    const scheme = editorStore.getSchemeById(cloudStore.schemeId)
    if (!scheme) return

    cloudStore.status = 'syncing'
    socket.send(
      JSON.stringify({
        type: 'push_snapshot',
        clientId: cloudStore.clientId,
        baseRevision: cloudStore.revision,
        snapshot: buildSharedSchemeSnapshot(scheme),
      })
    )
  }

  async function createRoom(options: { roomCode?: string; displayName: string }) {
    if (!editorStore.activeScheme) {
      notification.warning(t('cloudScheme.error.noActiveScheme'))
      return null
    }

    const roomCode = normalizeRoomCode(options.roomCode)
    const displayName = normalizeDisplayName(options.displayName)
    if (!displayName) {
      notification.error(t('cloudScheme.error.invalidDisplayName'))
      return null
    }

    setStoredDisplayName(displayName)

    const data = await requestJson<CreateCloudSchemeResponse>('/api/cloud-schemes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomCode: roomCode || undefined,
        snapshot: buildSharedSchemeSnapshot(editorStore.activeScheme),
      }),
    })

    disconnect(false)
    editorStore.setSchemeCloudMeta(editorStore.activeScheme.id, {
      source: 'cloud',
      cloudRoomCode: data.roomCode,
    })

    await startSession({
      roomCode: data.roomCode,
      schemeId: editorStore.activeScheme.id,
      revision: data.document.revision,
      displayName,
    })

    notification.success(t('cloudScheme.toast.created'))
    return data.roomCode
  }

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

    setStoredDisplayName(displayName)

    const data = await requestJson<CloudSnapshotResponse>('/api/cloud-schemes/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomCode }),
    })

    disconnect(false)
    const schemeId = editorStore.openCloudSchemeSnapshot(data.document.scheme, roomCode)
    editorStore.setSchemeCloudMeta(schemeId, {
      source: 'cloud',
      cloudRoomCode: roomCode,
    })

    await startSession({
      roomCode,
      schemeId,
      revision: data.document.revision,
      displayName,
    })

    notification.success(t('cloudScheme.toast.joined'))
    return roomCode
  }

  async function copyShareCode() {
    if (!shareCode.value) return false
    await navigator.clipboard.writeText(shareCode.value)
    notification.success(t('cloudScheme.toast.codeCopied'))
    return true
  }

  function disconnect(showToast = true) {
    if (socket) {
      socket.close()
      socket = null
    }

    stopSceneWatcher()
    const hadSession = !!cloudStore.roomCode
    cloudStore.clearSession()

    if (hadSession && showToast) {
      notification.info(t('cloudScheme.toast.disconnected'))
    }
  }

  return {
    currentCloudScheme,
    shareCode,
    isApplyingRemoteUpdate: computed(() => isApplyingRemoteUpdate.value),
    createRoom,
    joinRoom,
    copyShareCode,
    disconnect,
    getStoredDisplayName,
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markRaw } from 'vue'
import { createWatchModeOps } from '@/composables/fileOps/watchMode'
import { WatchHandleStore } from '@/lib/watchHandleStore'

vi.mock('@/lib/watchHandleStore', () => ({
  WatchHandleStore: {
    getRootHandle: vi.fn(),
    saveRootHandle: vi.fn(),
    clearRootHandle: vi.fn(),
  },
}))

function directory(name: string, children: Record<string, FileSystemDirectoryHandle> = {}) {
  const handle = {
    kind: 'directory' as const,
    name,
    queryPermission: vi.fn(
      async (_options: { mode: string }): Promise<PermissionState> => 'prompt'
    ),
    requestPermission: vi.fn(
      async (_options: { mode: string }): Promise<PermissionState> => 'granted'
    ),
    getDirectoryHandle: vi.fn(async (child: string) => {
      if (children[child]) return children[child]
      throw new DOMException('Directory not found', 'NotFoundError')
    }),
    values: vi.fn(async function* () {}),
  }
  // 原生目录句柄不会被 Vue 代理；测试替身也保持相同的引用语义。
  return markRaw(handle) as typeof handle & FileSystemDirectoryHandle
}

function setup() {
  const buildData = directory('BuildData')
  const savedData = directory('SavedData', { BuildData: buildData })
  const saved = directory('Saved', { SavedData: savedData })
  const root = directory('X6Game', { Saved: saved })
  const picker = vi.fn(async () => root)
  vi.stubGlobal('window', { showDirectoryPicker: picker, setTimeout })
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.mocked(WatchHandleStore.getRootHandle).mockResolvedValue(root)
  const notification = {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    confirm: vi.fn(),
  }
  const params = {
    editorStore: {},
    settingsStore: { settings: {} },
    notification,
    t: (key: string) => key,
    ensureResourcesReady: vi.fn(),
    preloadActiveSchemeResources: vi.fn(),
    prepareDataForSave: vi.fn(),
  } as unknown as Parameters<typeof createWatchModeOps>[0]
  return { root, buildData, picker, notification, params, ops: createWatchModeOps(params) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('watch mode directory permission restore', () => {
  it.each(['prompt', 'denied'] as const)(
    'only queries permission on startup when %s, keeping the restore entry without prompting',
    async (permission) => {
      const { ops, root, picker, notification } = setup()
      root.queryPermission.mockResolvedValue(permission)

      expect(await ops.restoreWatchModeSilently()).toBe(false)
      expect(root.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
      expect(root.requestPermission).not.toHaveBeenCalled()
      expect(root.getDirectoryHandle).not.toHaveBeenCalled()
      expect(picker).not.toHaveBeenCalled()
      expect(WatchHandleStore.clearRootHandle).not.toHaveBeenCalled()
      expect(notification.warning).not.toHaveBeenCalled()
      expect(ops.canRestoreWatchMode.value).toBe(true)
      expect(ops.watchState.value.isActive).toBe(false)
      expect(ops.isWatchModeBusy.value).toBe(false)
    }
  )

  it('silently restores watch mode when already authorized, without requesting permission or prompting import', async () => {
    const { ops, root, buildData, picker, notification } = setup()
    root.queryPermission.mockResolvedValue('granted')

    expect(await ops.restoreWatchModeSilently()).toBe(true)
    expect(root.requestPermission).not.toHaveBeenCalled()
    expect(picker).not.toHaveBeenCalled()
    expect(ops.watchState.value.isActive).toBe(true)
    expect(ops.watchState.value.dirHandle).toBe(buildData)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    expect(notification.confirm).not.toHaveBeenCalled()
    expect(notification.success).not.toHaveBeenCalled()
    ops.cleanup()
  })

  it('requests permission on the preloaded handle immediately on restore click, reusing the directory scan and watcher', async () => {
    const { ops, root, buildData, picker, notification } = setup()
    await ops.restoreWatchModeSilently()

    const restoring = ops.restoreWatchMode()
    // 必须在第一次异步让出之前调用，才能保留浏览器的用户手势。
    expect(root.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(ops.isWatchModeBusy.value).toBe(true)
    expect(await restoring).toBe(true)
    expect(WatchHandleStore.getRootHandle).toHaveBeenCalledOnce()
    expect(picker).not.toHaveBeenCalled()
    expect(ops.watchState.value.isActive).toBe(true)
    expect(ops.watchState.value.dirHandle).toBe(buildData)
    expect(ops.getRootDirHandle()).toBe(root)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    expect(notification.success).toHaveBeenCalledWith('fileOps.watch.started')
    ops.cleanup()
  })

  it.each(['prompt', 'denied'] as const)(
    'keeps the old handle when permission resolves to %s so it can be retried, without switching directory automatically',
    async (permission) => {
      const { ops, root, picker, notification } = setup()
      await ops.restoreWatchModeSilently()
      root.requestPermission.mockResolvedValueOnce(permission)

      expect(await ops.restoreWatchMode()).toBe(false)
      expect(ops.canRestoreWatchMode.value).toBe(true)
      expect(ops.watchState.value.isActive).toBe(false)
      expect(ops.isWatchModeBusy.value).toBe(false)
      expect(notification.warning).toHaveBeenCalledWith('fileOps.watch.permissionRequired')
      expect(WatchHandleStore.clearRootHandle).not.toHaveBeenCalled()
      expect(picker).not.toHaveBeenCalled()

      expect(await ops.restoreWatchMode()).toBe(true)
      ops.cleanup()
    }
  )

  it('keeps the old handle and clears the busy flag when the permission request throws', async () => {
    const { ops, root, notification } = setup()
    await ops.restoreWatchModeSilently()
    root.requestPermission.mockRejectedValueOnce(new DOMException('No gesture', 'SecurityError'))

    expect(await ops.restoreWatchMode()).toBe(false)
    expect(ops.canRestoreWatchMode.value).toBe(true)
    expect(ops.isWatchModeBusy.value).toBe(false)
    expect(WatchHandleStore.clearRootHandle).not.toHaveBeenCalled()
    expect(notification.error).toHaveBeenCalledWith('fileOps.watch.startFailed')
  })

  it('keeps the pick-directory entry and requests no permission when no cached handle exists', async () => {
    const { ops, root } = setup()
    vi.mocked(WatchHandleStore.getRootHandle).mockResolvedValue(undefined)

    expect(await ops.restoreWatchModeSilently()).toBe(false)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    expect(await ops.restoreWatchMode()).toBe(false)
    expect(root.requestPermission).not.toHaveBeenCalled()
  })

  it('ignores repeated restore and picker calls while authorization is pending, avoiding concurrent starts', async () => {
    const { ops, root, picker } = setup()
    await ops.restoreWatchModeSilently()
    let resolve!: (permission: PermissionState) => void
    root.requestPermission.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )

    const restoring = ops.restoreWatchMode()
    expect(await ops.restoreWatchMode()).toBe(false)
    expect(await ops.restoreWatchModeSilently()).toBe(false)
    await ops.startWatchMode()
    expect(picker).not.toHaveBeenCalled()
    expect(root.requestPermission).toHaveBeenCalledOnce()
    resolve('granted')
    expect(await restoring).toBe(true)
    ops.cleanup()
  })

  it('still opens the picker when re-selecting a directory, keeping the pending directory after cancellation', async () => {
    const { ops, root, picker, notification } = setup()
    await ops.restoreWatchModeSilently()
    picker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))

    await ops.startWatchMode()
    expect(picker).toHaveBeenCalledOnce()
    expect(root.requestPermission).not.toHaveBeenCalled()
    expect(WatchHandleStore.clearRootHandle).not.toHaveBeenCalled()
    expect(ops.canRestoreWatchMode.value).toBe(true)
    expect(ops.isWatchModeBusy.value).toBe(false)
    expect(notification.error).not.toHaveBeenCalled()
  })

  it('saves and starts watching after re-selecting a valid directory', async () => {
    const { ops, picker } = setup()
    await ops.restoreWatchModeSilently()
    const other = directory('X6Game', { BuildData: directory('BuildData') })
    picker.mockResolvedValueOnce(other)

    await ops.startWatchMode()
    expect(WatchHandleStore.saveRootHandle).toHaveBeenCalledWith(other)
    expect(ops.getRootDirHandle()).toBe(other)
    expect(ops.watchState.value.isActive).toBe(true)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    ops.cleanup()
  })

  it('clears the invalid handle and asks to re-select when the original directory no longer contains BuildData', async () => {
    const { ops, root, notification } = setup()
    await ops.restoreWatchModeSilently()
    root.getDirectoryHandle.mockRejectedValue(new DOMException('Gone', 'NotFoundError'))

    expect(await ops.restoreWatchMode()).toBe(false)
    expect(WatchHandleStore.clearRootHandle).toHaveBeenCalledOnce()
    expect(ops.canRestoreWatchMode.value).toBe(false)
    expect(notification.warning).toHaveBeenCalledWith('fileOps.watch.directoryUnavailable')
  })

  it('clears the cache and restore entry when watch mode stops', async () => {
    const { ops, root } = setup()
    await ops.restoreWatchModeSilently()
    await ops.restoreWatchMode()
    await ops.stopWatchMode()

    expect(WatchHandleStore.clearRootHandle).toHaveBeenCalledOnce()
    expect(ops.getRootDirHandle()).toBeNull()
    expect(ops.watchState.value.isActive).toBe(false)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    expect(await ops.restoreWatchMode()).toBe(false)
    expect(root.requestPermission).toHaveBeenCalledOnce()
  })
})

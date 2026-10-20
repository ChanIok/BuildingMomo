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
  const queryPermission = vi.fn(
    async (_options: { mode: string }): Promise<PermissionState> => 'prompt'
  )
  const handle = {
    kind: 'directory' as const,
    name,
    queryPermission,
    requestPermission: vi.fn(async (_options: { mode: string }): Promise<PermissionState> => {
      // 模拟恢复提示一并恢复原有读写权限，而非只更新所请求的 mode。
      queryPermission.mockResolvedValue('granted')
      return 'granted'
    }),
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
  return { root, buildData, picker, notification, ops: createWatchModeOps(params) }
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
  it.each(['granted', 'prompt', 'denied'] as const)(
    'silently restores only when startup permission is granted: %s',
    async (permission) => {
      const { ops, root, picker, notification } = setup()
      root.queryPermission.mockResolvedValue(permission)

      const authorized = permission === 'granted'
      expect(await ops.restoreWatchModeSilently()).toBe(authorized)
      expect(root.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
      expect(root.requestPermission).not.toHaveBeenCalled()
      expect(picker).not.toHaveBeenCalled()
      expect(notification.warning).not.toHaveBeenCalled()
      expect(notification.confirm).not.toHaveBeenCalled()
      expect(ops.canRestoreWatchMode.value).toBe(!authorized)
      expect(ops.watchState.value.isActive).toBe(authorized)
      ops.cleanup()
    }
  )

  it('immediately requests read on the cached handle, then checks write access without another request', async () => {
    const { ops, root, buildData, picker } = setup()
    await ops.restoreWatchModeSilently()

    const restoring = ops.restoreWatchMode()
    // 必须在第一次异步让出之前调用，才能保留浏览器的用户手势。
    expect(root.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(await restoring).toBe(true)
    expect(root.requestPermission).toHaveBeenCalledOnce()
    expect(root.queryPermission).toHaveBeenLastCalledWith({ mode: 'readwrite' })
    expect(WatchHandleStore.getRootHandle).toHaveBeenCalledOnce()
    expect(picker).not.toHaveBeenCalled()
    expect(ops.watchState.value.isActive).toBe(true)
    expect(ops.watchState.value.dirHandle).toBe(buildData)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    ops.cleanup()
  })

  it.each(['granted', 'prompt', 'denied'] as const)(
    'requests missing write access and activates only if granted: %s',
    async (permission) => {
      const { ops, root } = setup()
      await ops.restoreWatchModeSilently()
      root.requestPermission.mockResolvedValueOnce('granted').mockResolvedValueOnce(permission)

      const authorized = permission === 'granted'
      expect(await ops.restoreWatchMode()).toBe(authorized)
      expect(root.requestPermission.mock.calls).toEqual([
        [{ mode: 'read' }],
        [{ mode: 'readwrite' }],
      ])
      expect(ops.watchState.value.isActive).toBe(authorized)
      expect(ops.getRootDirHandle()).toBe(authorized ? root : null)
      ops.cleanup()
    }
  )

  it.each(['prompt', 'denied', 'error'] as const)(
    'preserves the handle and allows retry after an unsuccessful read request: %s',
    async (permission) => {
      const { ops, root, picker, notification } = setup()
      await ops.restoreWatchModeSilently()
      if (permission === 'error') {
        root.requestPermission.mockRejectedValueOnce(
          new DOMException('No gesture', 'SecurityError')
        )
      } else {
        root.requestPermission.mockResolvedValueOnce(permission)
      }

      expect(await ops.restoreWatchMode()).toBe(false)
      expect(root.requestPermission).toHaveBeenCalledOnce()
      expect(ops.canRestoreWatchMode.value).toBe(true)
      expect(ops.watchState.value.isActive).toBe(false)
      expect(ops.isWatchModeBusy.value).toBe(false)
      expect(permission === 'error' ? notification.error : notification.warning).toHaveBeenCalled()
      expect(WatchHandleStore.clearRootHandle).not.toHaveBeenCalled()
      expect(picker).not.toHaveBeenCalled()

      expect(await ops.restoreWatchMode()).toBe(true)
      ops.cleanup()
    }
  )

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
    root.queryPermission.mockResolvedValue('granted')
    resolve('granted')
    expect(await restoring).toBe(true)
    expect(root.requestPermission).toHaveBeenCalledOnce()
    ops.cleanup()
  })

  it('still opens the picker when re-selecting a directory, keeping the pending directory after cancellation', async () => {
    const { ops, picker } = setup()
    await ops.restoreWatchModeSilently()
    picker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))

    await ops.startWatchMode()
    expect(picker).toHaveBeenCalledOnce()
    expect(WatchHandleStore.clearRootHandle).not.toHaveBeenCalled()
    expect(ops.canRestoreWatchMode.value).toBe(true)
    expect(ops.isWatchModeBusy.value).toBe(false)
  })

  it('clears the cache and restore entry when watch mode stops', async () => {
    const { ops } = setup()
    await ops.restoreWatchModeSilently()
    expect(await ops.restoreWatchMode()).toBe(true)
    await ops.stopWatchMode()

    expect(WatchHandleStore.clearRootHandle).toHaveBeenCalledOnce()
    expect(ops.getRootDirHandle()).toBeNull()
    expect(ops.watchState.value.isActive).toBe(false)
    expect(ops.canRestoreWatchMode.value).toBe(false)
    expect(await ops.restoreWatchMode()).toBe(false)
  })
})

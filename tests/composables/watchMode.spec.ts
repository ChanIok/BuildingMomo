import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markRaw } from 'vue'
import { createWatchModeOps } from '@/composables/fileOps/watchMode'
import { WatchHandleStore } from '@/lib/watchHandleStore'
import { makeScheme, makeAppItem } from '../fixtures/item'

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
    onSchemeImported: vi.fn(),
  } as unknown as Parameters<typeof createWatchModeOps>[0]
  return {
    root,
    buildData,
    savedData,
    picker,
    notification,
    params,
    ops: createWatchModeOps(params),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})

function saveSetup() {
  const context = setup()
  const scheme = makeScheme([makeAppItem({ groupId: 7 })])
  scheme.filePath.value = 'BUILD_SAVEDATA_123.json'
  Object.assign(context.params.editorStore, { activeScheme: scheme })
  context.params.settingsStore.settings.lastSavedToGameSchemeId = 'previous'
  context.params.settingsStore.settings.autoInheritGroupMetadata = false
  const writable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const file = markRaw({
    kind: 'file',
    name: scheme.filePath.value,
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('denied'),
    createWritable: vi.fn().mockResolvedValue(writable),
    getFile: vi.fn().mockResolvedValue({ lastModified: 100 }),
  })
  const getFileHandle = vi.fn().mockResolvedValue(file)
  Object.assign(context.buildData, { getFileHandle })
  context.ops.watchState.value.isActive = true
  context.ops.watchState.value.dirHandle = context.buildData
  vi.mocked(context.params.prepareDataForSave).mockResolvedValue([])
  return { ...context, scheme, writable, file, getFileHandle }
}

it('records the actually saved scheme even when switching tabs during validation and auto inheritance is off', async () => {
  const { ops, params, scheme, getFileHandle, writable, notification } = saveSetup()
  vi.mocked(params.prepareDataForSave).mockImplementation(async (saving) => {
    expect(saving).toBe(scheme)
    Object.assign(params.editorStore, {
      activeScheme: { ...scheme, id: 'other', filePath: { value: 'BUILD_SAVEDATA_999.json' } },
    })
    return []
  })
  await ops.saveToGame()
  expect(getFileHandle).toHaveBeenCalledWith('BUILD_SAVEDATA_123.json', { create: true })
  expect(writable.close).toHaveBeenCalledOnce()
  expect(params.settingsStore.settings.lastSavedToGameSchemeId).toBe(scheme.id)
  expect(notification.success).toHaveBeenCalledWith('fileOps.saveToGame.success')
  ops.cleanup()
})

it.each(['cancel', 'permission', 'write', 'close'])(
  'does not replace the saved source after %s',
  async (failure) => {
    const { ops, params, writable, file, notification } = saveSetup()
    if (failure === 'cancel') vi.mocked(params.prepareDataForSave).mockResolvedValue(null)
    if (failure === 'permission') file.queryPermission.mockResolvedValue('denied')
    if (failure === 'write') writable.write.mockRejectedValue(new Error('write failed'))
    if (failure === 'close') writable.close.mockRejectedValue(new Error('close failed'))
    await ops.saveToGame()
    expect(params.settingsStore.settings.lastSavedToGameSchemeId).toBe('previous')
    expect(notification.success).not.toHaveBeenCalled()
    ops.cleanup()
  }
)

it('retains the saved source after a successful write even if the subsequent file-cache read fails', async () => {
  const { ops, params, scheme, file } = saveSetup()
  file.getFile.mockRejectedValue(new Error('cache read failed'))
  await ops.saveToGame()
  expect(params.settingsStore.settings.lastSavedToGameSchemeId).toBe(scheme.id)
  ops.cleanup()
})

it.each(['build-data', 'record'])(
  'routes %s imports through automatic inheritance before the imported-history callback',
  async (mode) => {
    const { ops, params, buildData, savedData, root, notification } = setup()
    params.settingsStore.settings.autoInheritGroupMetadata = true
    params.settingsStore.settings.lastSavedToGameSchemeId = 'saved-source'
    const importJSONAsScheme = vi
      .fn()
      .mockResolvedValue({ success: true, schemeId: 'new', inheritedGroupCount: 2 })
    Object.assign(params.editorStore, { importJSONAsScheme })
    ops.watchState.value.isActive = true
    ops.watchState.value.dirHandle = buildData
    if (mode === 'record') {
      const file = {
        kind: 'file',
        name: '123.record',
        getFile: async () => ({ name: '123.record', lastModified: 1, text: async () => '[]' }),
      }
      const record = directory('BuildRecord')
      record.values = vi.fn(async function* () {
        yield file
      }) as typeof record.values
      savedData.getDirectoryHandle.mockImplementation(async (child) => {
        if (child === 'BuildRecord') return record
        if (child === 'BuildData') return buildData
        throw new DOMException('Directory not found', 'NotFoundError')
      })
      // 恢复入口设置真实的根目录上下文，随后从 BuildRecord 读取。
      root.queryPermission.mockResolvedValue('granted')
      ops.watchState.value.isActive = false
      await ops.restoreWatchModeSilently()
    } else {
      const file = {
        kind: 'file',
        name: 'BUILD_SAVEDATA_123.json',
        getFile: async () => ({
          name: 'BUILD_SAVEDATA_123.json',
          lastModified: 1,
          text: async () => '{"Snapshots":[]}',
        }),
      }
      buildData.values = vi.fn(async function* () {
        yield file
      }) as typeof buildData.values
    }
    await ops.importFromWatchedFile()
    expect(importJSONAsScheme).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1, {
      inheritGroupsFromSchemeId: 'saved-source',
    })
    expect(notification.success).toHaveBeenLastCalledWith('fileOps.import.groupsInherited')
    expect(params.onSchemeImported).toHaveBeenCalledWith('new')
    ops.cleanup()
  }
)

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

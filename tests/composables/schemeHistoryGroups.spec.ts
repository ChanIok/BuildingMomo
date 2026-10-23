import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { useCollectionPanel } from '@/composables/editor/useCollectionPanel'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorGroups } from '@/composables/editor/useEditorGroups'
import { createSchemeHistoryOps } from '@/composables/fileOps/schemeHistory'
import { makeAppItem } from '../fixtures/item'

vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('writes a group-only rename even when items and the scheme name are unchanged', async () => {
  vi.useFakeTimers()
  const events = new EventTarget()
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setInterval: globalThis.setInterval,
  })
  vi.stubGlobal('document', events)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  setActivePinia(createPinia())
  const store = useEditorStore()
  store.createScheme('test')
  const scheme = store.activeScheme!
  scheme.items.value = [makeAppItem({ groupId: 7 })]
  const write = vi.fn().mockResolvedValue(undefined)
  const directory = {
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn(),
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi
      .fn()
      .mockResolvedValue({ createWritable: async () => ({ write, close: async () => {} }) }),
    values: async function* () {},
  }
  directory.getDirectoryHandle.mockResolvedValue(directory)
  const ops = createSchemeHistoryOps({
    editorStore: store,
    settingsStore: useSettingsStore(),
    notification: {} as never,
    t: (key) => key,
    getRootDirHandle: () => directory as never,
  })
  ops.start()
  try {
    ops.markDirty(scheme.id)
    await ops.flushNow(true)
    expect(write).toHaveBeenCalledTimes(1)
    const items = scheme.items.value
    useEditorGroups().renameGroup(7, 'Walls')
    expect(scheme.items.value).toBe(items)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenCalledTimes(2)
    expect(JSON.parse(write.mock.calls[1]![0]).collectionTree.groups).toEqual([
      { groupId: 7, name: 'Walls', collectionId: null, order: 7 },
    ])
    useCollectionPanel(ref('')).createCollection()
    expect(scheme.items.value).toBe(items)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenCalledTimes(3)
    expect(JSON.parse(write.mock.calls[2]![0]).collectionTree.nodes).toHaveLength(1)
    expect(directory.requestPermission).not.toHaveBeenCalled()
  } finally {
    ops.stop()
  }
})

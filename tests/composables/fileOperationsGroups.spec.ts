import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { HomeScheme } from '@/types/editor'
import type { ValidationResult } from '@/types/persistence'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useValidationStore } from '@/stores/validationStore'
import { makeAppItem, setGroupNames } from '../fixtures/item'

const state = vi.hoisted(() => ({
  prepare: null as null | ((scheme?: HomeScheme | null) => Promise<unknown>),
  validate: vi.fn(),
  initialize: vi.fn(),
  imported: vi.fn(),
  notification: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmWithCheckbox: vi.fn(),
  },
}))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onUnmounted: () => {},
}))
vi.mock('@/composables/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/workers/client', () => ({
  workerApi: { validate: state.validate, updateFurnitureConstraints: vi.fn() },
}))
vi.mock('@/composables/useNotification', () => ({ useNotification: () => state.notification }))
vi.mock('@/stores/gameDataStore', () => ({
  useGameDataStore: () => ({
    initialize: state.initialize,
    getFurnitureConstraintsMap: () => new Map(),
    getFurniture: () => undefined,
  }),
}))
vi.mock('@/composables/useIconLoader', () => ({ getIconLoader: () => ({ preloadIcons: vi.fn() }) }))
vi.mock('@/composables/fileOps/schemeHistory', () => ({
  createSchemeHistoryOps: () => ({
    start: () => {},
    stop: () => {},
    markImported: state.imported,
  }),
}))
vi.mock('@/composables/fileOps/archive', () => ({ createArchiveOps: () => ({}) }))
vi.mock('@/composables/fileOps/watchMode', () => ({
  createWatchModeOps: (params: { prepareDataForSave: typeof state.prepare }) => {
    state.prepare = params.prepareDataForSave
    return { getRootDirHandle: () => null, cleanup: () => {} }
  },
}))

function validation(): ValidationResult {
  return {
    duplicateGroups: [],
    limitIssues: {
      outOfBoundsItemIds: [],
      oversizedGroups: [],
      invalidScaleItemIds: [],
      invalidRotationItemIds: [],
      invalidColorItemIds: [],
      conflictingColorItemIds: [],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('window', {})
  setActivePinia(createPinia())
  state.initialize.mockResolvedValue(undefined)
  state.validate.mockResolvedValue(validation())
  state.notification.confirmWithCheckbox.mockResolvedValue({ confirmed: true, checked: false })
})
afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const store = useEditorStore()
  store.createScheme('saving')
  const scheme = store.activeScheme!
  scheme.items.value = [makeAppItem({ groupId: 7 })]
  scheme.filePath.value = 'BUILD_SAVEDATA_123.json'
  const { useFileOperations } = await import('@/composables/useFileOperations')
  const ops = useFileOperations(store)
  return { store, scheme, ops, settings: useSettingsStore() }
}

it('binds validation and serialization to the original items before asynchronous resource initialization', async () => {
  const { store, scheme } = await setup()
  const items = scheme.items.value
  state.initialize.mockImplementationOnce(async () => {
    scheme.items.value = [makeAppItem({ instanceId: 9999 })]
    store.createScheme('other')
    store.activeScheme!.items.value = [makeAppItem({ gameId: 999 })]
  })
  const gameItems = await state.prepare!(scheme)
  expect(state.validate).toHaveBeenCalledWith(items, expect.any(Object), 'BUILD_SAVEDATA_123.json')
  expect(gameItems).toMatchObject([{ ItemID: items[0]!.gameId, InstanceID: 1000, GroupID: 7 }])
})

it('keeps the validation used for save filtering even if tab switching clears the global validation during confirmation', async () => {
  const { store, scheme, settings } = await setup()
  settings.settings.enableLimitDetection = false
  const invalid = validation()
  invalid.limitIssues.oversizedGroups = [7]
  state.validate.mockResolvedValueOnce(invalid)
  state.notification.confirmWithCheckbox.mockImplementationOnce(async () => {
    store.createScheme('other')
    useValidationStore().clearResults()
    return { confirmed: true, checked: false }
  })
  expect(await state.prepare!(scheme)).toMatchObject([{ GroupID: 0, InstanceID: 1000 }])
})

it('applies automatic group information before backing up manually imported JSON, and emits one result toast', async () => {
  const { store, scheme, settings, ops } = await setup()
  settings.settings.autoInheritGroupMetadata = true
  settings.settings.lastSavedToGameSchemeId = scheme.id
  settings.settings.threeDisplayMode = 'simple-box'
  setGroupNames(scheme, [[7, 'Walls']])
  scheme.groupOrigins.value = new Map([[7, scheme.items.value[0]!.internalId]])
  const content = JSON.stringify({
    PlaceInfo: [
      {
        ItemID: scheme.items.value[0]!.gameId,
        InstanceID: 1000,
        GroupID: 7,
        Location: {},
        Rotation: {},
        Scale: {},
      },
    ],
  })
  const input: {
    type?: string
    accept?: string
    onchange?: (event: unknown) => void
    click: () => void
  } = {
    click: () => input.onchange!({ target: { files: [{ name: 'game.json', lastModified: 1 }] } }),
  }
  vi.stubGlobal('document', { createElement: () => input })
  vi.stubGlobal(
    'Image',
    class {
      src = ''
    }
  )
  vi.stubGlobal(
    'FileReader',
    class {
      onload?: (event: unknown) => void
      readAsText() {
        this.onload!({ target: { result: content } })
      }
    }
  )
  state.imported.mockImplementation((id: string) => {
    const target = store.getSchemeById(id)!
    expect(target.collectionTree.value.groups[0]?.name).toBe('Walls')
    expect(target.groupOrigins.value.get(7)).toBe(target.items.value[0]?.internalId)
  })
  await ops.importJSON()
  expect(state.imported).toHaveBeenCalledOnce()
  expect(state.notification.success).toHaveBeenCalledExactlyOnceWith(
    'fileOps.import.groupsInherited'
  )
  expect(settings.settings.lastSavedToGameSchemeId).toBe(scheme.id)
})

import { ref, toRaw } from 'vue'
import type { useEditorStore } from '@/stores/editorStore'
import type { useNotification } from '@/composables/useNotification'
import type {
  ArchiveEntry,
  ArchiveGroup,
  ArchiveIndexFile,
  ArchiveState,
  ArchivedSchemeFile,
  ArchivedSchemeSnapshot,
} from '@/types/archive'
import {
  ARCHIVE_DEFAULT_GROUP_ID,
  ARCHIVE_INDEX_FILE_NAME,
  ARCHIVE_INDEX_VERSION,
  ARCHIVE_SCHEMES_DIR_NAME,
} from '@/types/archive'

type TranslateFn = (key: string, params?: Record<string, string | number>) => string

interface CreateArchiveOpsParams {
  editorStore: ReturnType<typeof useEditorStore>
  notification: ReturnType<typeof useNotification>
  t: TranslateFn
  isWatchActive: () => boolean
  getRootDirHandle: () => FileSystemDirectoryHandle | null
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function createDefaultArchiveIndex(defaultGroupName: string): ArchiveIndexFile {
  const now = Date.now()
  return {
    version: ARCHIVE_INDEX_VERSION,
    updatedAt: now,
    groups: [
      {
        id: ARCHIVE_DEFAULT_GROUP_ID,
        name: defaultGroupName,
        order: 0,
        createdAt: now,
      },
    ],
    entries: [],
  }
}

function compareByOrder<T extends { order: number; createdAt: number }>(left: T, right: T) {
  if (left.order !== right.order) {
    return left.order - right.order
  }
  return left.createdAt - right.createdAt
}

function normalizeArchiveIndex(raw: unknown, defaultGroupName: string): ArchiveIndexFile {
  const fallback = createDefaultArchiveIndex(defaultGroupName)
  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const source = raw as Partial<ArchiveIndexFile>
  const groups = Array.isArray(source.groups)
    ? source.groups
        .filter((group): group is ArchiveGroup => !!group && typeof group === 'object')
        .map((group, index) => ({
          id: typeof group.id === 'string' && group.id ? group.id : generateUUID(),
          name:
            typeof group.name === 'string' && group.name.trim()
              ? group.name.trim()
              : `${defaultGroupName} ${index + 1}`,
          order: typeof group.order === 'number' ? group.order : index,
          createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now(),
        }))
    : []

  if (!groups.some((group) => group.id === ARCHIVE_DEFAULT_GROUP_ID)) {
    groups.unshift(fallback.groups[0]!)
  }

  const groupIds = new Set(groups.map((group) => group.id))
  const entries = Array.isArray(source.entries)
    ? source.entries
        .filter((entry): entry is ArchiveEntry => !!entry && typeof entry === 'object')
        .map((entry, index) => ({
          id: typeof entry.id === 'string' && entry.id ? entry.id : generateUUID(),
          name:
            typeof entry.name === 'string' && entry.name.trim()
              ? entry.name.trim()
              : `Archive ${index + 1}`,
          groupId:
            typeof entry.groupId === 'string' && groupIds.has(entry.groupId)
              ? entry.groupId
              : ARCHIVE_DEFAULT_GROUP_ID,
          schemeFile:
            typeof entry.schemeFile === 'string' && entry.schemeFile
              ? entry.schemeFile
              : `${generateUUID()}.json`,
          order: typeof entry.order === 'number' ? entry.order : index,
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
          sourceFileName:
            typeof entry.sourceFileName === 'string' && entry.sourceFileName
              ? entry.sourceFileName
              : undefined,
          itemCount: typeof entry.itemCount === 'number' ? entry.itemCount : 0,
        }))
    : []

  groups.sort(compareByOrder)
  entries.sort(compareByOrder)

  return {
    version: ARCHIVE_INDEX_VERSION,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : Date.now(),
    groups,
    entries,
  }
}

function buildArchivedSchemeSnapshot(
  scheme: ReturnType<typeof useEditorStore>['schemes'][number]
): ArchivedSchemeSnapshot {
  // 方案集保存的是工作区快照，而不是游戏导出 JSON。
  // 这样重新打开时才能恢复组原点、视图状态等编辑信息。
  return {
    name: scheme.name.value,
    filePath: scheme.filePath.value,
    lastModified: scheme.lastModified.value,
    items: toRaw(scheme.items.value),
    currentViewConfig: toRaw(scheme.currentViewConfig.value),
    viewState: toRaw(scheme.viewState.value),
    groupOrigins: Array.from(toRaw(scheme.groupOrigins.value).entries()),
  }
}

function ensureName(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed || fallback
}

async function queryPermissionState(handle: FileSystemHandle): Promise<PermissionState> {
  const options = { mode: 'readwrite' as const }
  return (await (handle as any).queryPermission(options)) as PermissionState
}

async function verifyPermission(handle: FileSystemHandle): Promise<boolean> {
  const options = { mode: 'readwrite' as const }
  if ((await queryPermissionState(handle)) === 'granted') return true
  if ((await (handle as any).requestPermission(options)) === 'granted') return true
  return false
}

export function createArchiveOps(params: CreateArchiveOpsParams) {
  const { editorStore, notification, t, isWatchActive, getRootDirHandle } = params
  let isOperating = false

  const archiveState = ref<ArchiveState>({
    index: createDefaultArchiveIndex(t('archive.defaultGroup')),
    hasLoaded: false,
    isLoading: false,
    selectedGroupId: ARCHIVE_DEFAULT_GROUP_ID,
  })

  async function getArchiveHandles() {
    if (!isWatchActive()) {
      notification.warning(t('fileOps.archive.notReady'))
      return null
    }

    const rootDirHandle = getRootDirHandle()
    if (!rootDirHandle) {
      notification.warning(t('fileOps.archive.notReady'))
      return null
    }

    const hasPermission = await verifyPermission(rootDirHandle)
    if (!hasPermission) {
      notification.error(t('fileOps.archive.noPermission'))
      return null
    }

    const archiveDirHandle = await rootDirHandle.getDirectoryHandle('BuildingMomo', {
      create: true,
    })
    const schemesDirHandle = await archiveDirHandle.getDirectoryHandle(ARCHIVE_SCHEMES_DIR_NAME, {
      create: true,
    })

    return {
      archiveDirHandle,
      schemesDirHandle,
    }
  }

  async function readIndexFromDisk(): Promise<ArchiveIndexFile | null> {
    const handles = await getArchiveHandles()
    if (!handles) return null

    try {
      const fileHandle = await handles.archiveDirHandle.getFileHandle(ARCHIVE_INDEX_FILE_NAME)
      const file = await fileHandle.getFile()
      const content = await file.text()
      if (!content.trim()) {
        return createDefaultArchiveIndex(t('archive.defaultGroup'))
      }
      return normalizeArchiveIndex(JSON.parse(content), t('archive.defaultGroup'))
    } catch (error) {
      return createDefaultArchiveIndex(t('archive.defaultGroup'))
    }
  }

  async function writeIndexToDisk(index: ArchiveIndexFile) {
    const handles = await getArchiveHandles()
    if (!handles) return false

    const fileHandle = await handles.archiveDirHandle.getFileHandle(ARCHIVE_INDEX_FILE_NAME, {
      create: true,
    })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(index, null, 2))
    await writable.close()
    return true
  }

  async function readArchivedSchemeFile(entry: ArchiveEntry): Promise<ArchivedSchemeFile | null> {
    const handles = await getArchiveHandles()
    if (!handles) return null

    const schemeFileHandle = await handles.schemesDirHandle.getFileHandle(entry.schemeFile)
    const file = await schemeFileHandle.getFile()
    const content = await file.text()
    return JSON.parse(content) as ArchivedSchemeFile
  }

  async function runExclusive(task: () => Promise<boolean>) {
    if (isOperating) {
      return false
    }

    isOperating = true
    try {
      return await task()
    } finally {
      isOperating = false
    }
  }

  function syncState(index: ArchiveIndexFile) {
    const groups = [...index.groups].sort(compareByOrder)
    const entries = [...index.entries].sort(compareByOrder)
    const nextSelectedGroupId = groups.some(
      (group) => group.id === archiveState.value.selectedGroupId
    )
      ? archiveState.value.selectedGroupId
      : ARCHIVE_DEFAULT_GROUP_ID

    // 尽量保留 archiveState 外层对象引用，减少整个 Popover 的联动刷新。
    archiveState.value.index = {
      ...index,
      groups,
      entries,
    }

    if (archiveState.value.selectedGroupId !== nextSelectedGroupId) {
      archiveState.value.selectedGroupId = nextSelectedGroupId
    }
  }

  async function loadArchiveIndex(force: boolean = false) {
    if (!force && archiveState.value.hasLoaded && !archiveState.value.isLoading) {
      return true
    }

    archiveState.value.isLoading = true
    try {
      const index = await readIndexFromDisk()
      if (!index) return false

      syncState(index)
      archiveState.value.hasLoaded = true
      await writeIndexToDisk({
        ...archiveState.value.index,
        updatedAt: Date.now(),
      })
      return true
    } catch (error) {
      console.error('[Archive] Failed to load archive index:', error)
      notification.error(t('fileOps.archive.loadFailed'))
      return false
    } finally {
      archiveState.value.isLoading = false
    }
  }

  async function ensureArchiveIndexLoaded() {
    if (archiveState.value.hasLoaded) {
      return true
    }

    return loadArchiveIndex()
  }

  function setSelectedGroup(groupId: string) {
    if (archiveState.value.index.groups.some((group) => group.id === groupId)) {
      archiveState.value.selectedGroupId = groupId
    }
  }

  function getArchiveEntries(groupId: string = archiveState.value.selectedGroupId) {
    return archiveState.value.index.entries
      .filter((entry) => entry.groupId === groupId)
      .sort(compareByOrder)
  }

  async function createGroup(name: string) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const nextName = ensureName(name, t('archive.newGroup'))
      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        groups: [
          ...archiveState.value.index.groups,
          {
            id: generateUUID(),
            name: nextName,
            order: archiveState.value.index.groups.length,
            createdAt: Date.now(),
          },
        ],
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      archiveState.value.selectedGroupId = nextIndex.groups[nextIndex.groups.length - 1]!.id
      return true
    })
  }

  async function renameGroup(groupId: string, name: string) {
    return runExclusive(async () => {
      if (groupId === ARCHIVE_DEFAULT_GROUP_ID) return false
      if (!(await ensureArchiveIndexLoaded())) return false

      const nextName = ensureName(name, t('archive.newGroup'))
      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        groups: archiveState.value.index.groups.map((group) =>
          group.id === groupId ? { ...group, name: nextName } : group
        ),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      return true
    })
  }

  async function deleteGroup(groupId: string) {
    return runExclusive(async () => {
      if (groupId === ARCHIVE_DEFAULT_GROUP_ID) {
        notification.warning(t('archive.defaultGroupLocked'))
        return false
      }
      if (!(await ensureArchiveIndexLoaded())) return false

      const handles = await getArchiveHandles()
      if (!handles) return false

      const groupEntries = archiveState.value.index.entries.filter(
        (entry) => entry.groupId === groupId
      )
      for (const entry of groupEntries) {
        try {
          await (handles.schemesDirHandle as any).removeEntry(entry.schemeFile)
        } catch (error) {
          const exceptionName =
            error && typeof error === 'object' && 'name' in error
              ? String((error as { name?: unknown }).name)
              : ''
          // 条目文件可能已被外部删除；这类情况继续清理索引即可。
          if (exceptionName !== 'NotFoundError') {
            throw error
          }
        }
      }

      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        groups: archiveState.value.index.groups
          .filter((group) => group.id !== groupId)
          .map((group, index) => ({ ...group, order: index })),
        entries: archiveState.value.index.entries
          .filter((entry) => entry.groupId !== groupId)
          .map((item, _, list) => {
            const before = list.filter((entryItem) => entryItem.groupId === item.groupId)
            const order = before.findIndex((entryItem) => entryItem.id === item.id)
            return { ...item, order }
          }),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      archiveState.value.selectedGroupId = ARCHIVE_DEFAULT_GROUP_ID
      notification.success(t('archive.toast.groupDeleted'))
      return true
    })
  }

  async function moveGroup(groupId: string, direction: 'up' | 'down' | 'top') {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const groups = [...archiveState.value.index.groups].sort(compareByOrder)
      const index = groups.findIndex((group) => group.id === groupId)
      if (index === -1) return false

      let targetIndex: number
      if (direction === 'top') {
        targetIndex = groups[0]?.id === ARCHIVE_DEFAULT_GROUP_ID ? 1 : 0
        if (index <= targetIndex) return false
      } else {
        targetIndex = direction === 'up' ? index - 1 : index + 1
      }

      if (targetIndex < 0 || targetIndex >= groups.length) return false

      const [group] = groups.splice(index, 1)
      groups.splice(targetIndex, 0, group!)

      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        groups: groups.map((item, order) => ({ ...item, order })),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      return true
    })
  }

  async function archiveScheme(schemeId: string, groupId: string = ARCHIVE_DEFAULT_GROUP_ID) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const scheme = editorStore.schemes.find((item) => item.id === schemeId)
      if (!scheme) return false

      const handles = await getArchiveHandles()
      if (!handles) return false

      const entryId = generateUUID()
      const schemeFile = `${entryId}.json`
      const snapshot = buildArchivedSchemeSnapshot(scheme)
      const archivedSchemeFile: ArchivedSchemeFile = {
        version: ARCHIVE_INDEX_VERSION,
        archivedAt: Date.now(),
        scheme: snapshot,
      }

      const schemeFileHandle = await handles.schemesDirHandle.getFileHandle(schemeFile, {
        create: true,
      })
      const schemeWritable = await schemeFileHandle.createWritable()
      await schemeWritable.write(JSON.stringify(archivedSchemeFile, null, 2))
      await schemeWritable.close()

      const now = Date.now()
      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: now,
        entries: [
          {
            id: entryId,
            name: scheme.name.value,
            groupId,
            schemeFile,
            order: 0,
            createdAt: now,
            updatedAt: now,
            sourceFileName: scheme.filePath.value,
            itemCount: scheme.items.value.length,
          },
          ...archiveState.value.index.entries.map((entry) =>
            entry.groupId === groupId ? { ...entry, order: entry.order + 1 } : entry
          ),
        ],
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      archiveState.value.selectedGroupId = groupId
      notification.success(t('archive.toast.saved'))
      return true
    })
  }

  async function openArchiveEntry(entryId: string) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const entry = archiveState.value.index.entries.find((item) => item.id === entryId)
      if (!entry) return false

      const archivedScheme = await readArchivedSchemeFile(entry)
      if (!archivedScheme) return false
      const snapshot = archivedScheme.scheme
      if (!snapshot) return false

      editorStore.openArchivedSchemeSnapshot(snapshot, {
        archiveEntryId: entry.id,
        archiveName: entry.name,
      })
      return true
    })
  }

  // 用当前工作区方案更新某个已存在的方案集条目。
  // 这里只覆盖快照正文与元信息，不改变条目的名称、分组和排序。
  async function updateArchiveEntryFromScheme(
    entryId: string,
    schemeId: string = editorStore.activeSchemeId || ''
  ) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false
      if (!schemeId) return false

      const entry = archiveState.value.index.entries.find((item) => item.id === entryId)
      if (!entry) return false

      const scheme = editorStore.schemes.find((item) => item.id === schemeId)
      if (!scheme) return false

      const handles = await getArchiveHandles()
      if (!handles) return false

      const snapshot = buildArchivedSchemeSnapshot(scheme)
      const archivedSchemeFile: ArchivedSchemeFile = {
        version: ARCHIVE_INDEX_VERSION,
        archivedAt: Date.now(),
        scheme: snapshot,
      }

      const schemeFileHandle = await handles.schemesDirHandle.getFileHandle(entry.schemeFile, {
        create: true,
      })
      const writable = await schemeFileHandle.createWritable()
      await writable.write(JSON.stringify(archivedSchemeFile, null, 2))
      await writable.close()

      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        entries: archiveState.value.index.entries.map((item) =>
          item.id === entryId
            ? {
                ...item,
                name: ensureName(scheme.name.value, t('scheme.unnamed')),
                updatedAt: Date.now(),
                itemCount: scheme.items.value.length,
                sourceFileName: scheme.filePath.value,
              }
            : item
        ),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      notification.success(t('archive.toast.updated'))
      return true
    })
  }

  async function renameEntry(entryId: string, name: string) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const nextName = ensureName(name, t('scheme.unnamed'))
      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        entries: archiveState.value.index.entries.map((entry) =>
          entry.id === entryId ? { ...entry, name: nextName, updatedAt: Date.now() } : entry
        ),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      return true
    })
  }

  async function deleteEntry(entryId: string) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const entry = archiveState.value.index.entries.find((item) => item.id === entryId)
      if (!entry) return false

      const handles = await getArchiveHandles()
      if (!handles) return false

      await (handles.schemesDirHandle as any).removeEntry(entry.schemeFile)

      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        entries: archiveState.value.index.entries
          .filter((item) => item.id !== entryId)
          .map((item, _, list) => {
            const before = list.filter((entryItem) => entryItem.groupId === item.groupId)
            const order = before.findIndex((entryItem) => entryItem.id === item.id)
            return { ...item, order }
          }),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      return true
    })
  }

  async function moveEntry(entryId: string, direction: 'up' | 'down' | 'top') {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const entry = archiveState.value.index.entries.find((item) => item.id === entryId)
      if (!entry) return false

      const groupEntries = getArchiveEntries(entry.groupId)
      const index = groupEntries.findIndex((item) => item.id === entryId)
      if (index === -1) return false

      let targetIndex: number
      if (direction === 'top') {
        targetIndex = 0
        if (index === 0) return false
      } else {
        targetIndex = direction === 'up' ? index - 1 : index + 1
      }

      if (targetIndex < 0 || targetIndex >= groupEntries.length) return false

      const reordered = [...groupEntries]
      const [item] = reordered.splice(index, 1)
      reordered.splice(targetIndex, 0, item!)

      const orderMap = new Map(reordered.map((itemValue, order) => [itemValue.id, order]))
      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: Date.now(),
        entries: archiveState.value.index.entries.map((itemValue) =>
          itemValue.groupId === entry.groupId
            ? { ...itemValue, order: orderMap.get(itemValue.id) ?? itemValue.order }
            : itemValue
        ),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      return true
    })
  }

  async function moveEntryToGroup(entryId: string, targetGroupId: string) {
    return runExclusive(async () => {
      if (!(await ensureArchiveIndexLoaded())) return false

      const entry = archiveState.value.index.entries.find((item) => item.id === entryId)
      if (!entry) return false
      if (entry.groupId === targetGroupId) return false

      const targetGroup = archiveState.value.index.groups.find(
        (group) => group.id === targetGroupId
      )
      if (!targetGroup) return false

      const sourceGroupId = entry.groupId
      const now = Date.now()
      const nextEntries = archiveState.value.index.entries.map((item) => {
        if (item.id === entryId) {
          return {
            ...item,
            groupId: targetGroupId,
            order: 0,
            updatedAt: now,
          }
        }
        if (item.groupId === targetGroupId) {
          return { ...item, order: item.order + 1 }
        }
        return item
      })

      const nextIndex: ArchiveIndexFile = {
        ...archiveState.value.index,
        updatedAt: now,
        entries: nextEntries.sort(compareByOrder).map((item, _, list) => {
          const groupItems = list.filter((entryItem) => entryItem.groupId === item.groupId)
          const order = groupItems.findIndex((entryItem) => entryItem.id === item.id)
          // 对来源组和目标组做组内重排，其他分组保持原顺序。
          if (item.groupId === sourceGroupId || item.groupId === targetGroupId) {
            return { ...item, order }
          }
          return item
        }),
      }

      if (!(await writeIndexToDisk(nextIndex))) return false
      syncState(nextIndex)
      notification.success(t('archive.toast.moved', { group: targetGroup.name }))
      return true
    })
  }

  return {
    archiveState,
    loadArchiveIndex,
    setSelectedGroup,
    getArchiveEntries,
    createGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    archiveScheme,
    openArchiveEntry,
    updateArchiveEntryFromScheme,
    renameEntry,
    deleteEntry,
    moveEntry,
    moveEntryToGroup,
  }
}

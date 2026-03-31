import type { AppItem, ThreeViewState } from './editor'

export const ARCHIVE_INDEX_VERSION = 1
export const ARCHIVE_DEFAULT_GROUP_ID = 'default'
export const ARCHIVE_INDEX_FILE_NAME = 'archive-index.json'
export const ARCHIVE_SCHEMES_DIR_NAME = 'schemes'

export interface ArchiveGroup {
  id: string
  name: string
  order: number
  createdAt: number
}

export interface ArchiveEntry {
  id: string
  name: string
  groupId: string
  schemeFile: string
  order: number
  createdAt: number
  updatedAt: number
  sourceFileName?: string
  itemCount: number
}

export interface ArchiveIndexFile {
  version: number
  updatedAt: number
  groups: ArchiveGroup[]
  entries: ArchiveEntry[]
}

export interface ArchivedSchemeSnapshot {
  name: string
  filePath?: string
  lastModified?: number
  items: AppItem[]
  currentViewConfig?: { scale: number; x: number; y: number }
  viewState?: ThreeViewState
  groupOrigins: Array<[number, string]>
}

export interface ArchivedSchemeFile {
  version: number
  archivedAt: number
  scheme: ArchivedSchemeSnapshot
}

export interface ArchiveState {
  index: ArchiveIndexFile
  hasLoaded: boolean
  isLoading: boolean
  selectedGroupId: string
}

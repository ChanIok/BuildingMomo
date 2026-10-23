import type { CollectionTree } from '@/lib/collectionTree'
import type { AppItem, SchemeSource, ThreeViewState } from './editor'
import type { Tab } from './tab'

export interface HomeSchemeSnapshot {
  id: string
  name: string
  filePath?: string
  lastModified?: number
  source?: SchemeSource
  cloudRoomCode?: string
  items: AppItem[] // Plain data array
  selectedItemIds: Set<string> // IDB supports Set
  currentViewConfig?: { scale: number; x: number; y: number }
  viewState?: ThreeViewState
  collectionTree?: CollectionTree
  collapsedCollectionIds?: ReadonlySet<string>
  hiddenCollectionIds?: ReadonlySet<string>
  lockedCollectionIds?: ReadonlySet<string>
  hiddenGroupIds?: ReadonlySet<number>
  lockedGroupIds?: ReadonlySet<number>
  groupOrigins: Map<number, string> // IDB supports Map: groupId -> originItemId
}

export interface WorkspaceSnapshot {
  version: number
  updatedAt: number
  editor: {
    schemes: HomeSchemeSnapshot[]
  }
  tab: {
    tabs: Tab[]
    activeTabId: string | null
  }
}

/** 个人目录视图状态，不携带家具数据，也不触发家具数据失效。 */
export interface WorkspaceCollectionViewState {
  id: string
  collapsedCollectionIds: ReadonlySet<string>
}

export interface ValidationResult {
  duplicateGroups: string[][]
  limitIssues: {
    outOfBoundsItemIds: string[]
    oversizedGroups: number[]
    invalidScaleItemIds: string[]
    invalidRotationItemIds: string[]
    invalidColorItemIds: string[]
    conflictingColorItemIds: string[]
  }
}

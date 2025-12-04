import type { AppItem, ThreeViewState } from './editor'
import type { Tab } from './tab'

export interface HomeSchemeSnapshot {
  id: string
  name: string
  filePath?: string
  lastModified?: number
  items: AppItem[] // Plain data array
  selectedItemIds: Set<string> // IDB supports Set
  currentViewConfig?: { scale: number; x: number; y: number }
  viewState?: ThreeViewState
}

export interface WorkspaceSnapshot {
  version: number
  updatedAt: number
  editor: {
    schemes: HomeSchemeSnapshot[]
    activeSchemeId: string | null
  }
  tab: {
    tabs: Tab[]
    activeTabId: string | null
  }
}

export interface ValidationResult {
  duplicateGroups: string[][]
  limitIssues: {
    outOfBoundsItemIds: string[]
    oversizedGroups: number[]
  }
}

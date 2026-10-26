import type { AppItem } from '@/types/editor'
import type { CollectionTree, SchemeCollection } from '@/lib/collectionTree'

export interface AnalysisVector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface AnalysisBox {
  readonly min: AnalysisVector3
  readonly max: AnalysisVector3
}

export interface AnalysisBounds extends AnalysisBox {
  /** Conservative bounds, never a proof of triangle contact or attachment. */
  readonly source: 'model-aabb' | 'furniture-box' | 'slide-path'
}

export interface AnalysisFurniture {
  readonly gameId: number
  readonly nameZh: string | null
  readonly nameEn: string | null
  readonly category: {
    readonly id: number
    readonly nameZh: string
    readonly nameEn: string
    readonly parentId: number | null
  } | null
  readonly sizeCm: readonly [number, number, number] | null
  /** Local asset URL, not an image attachment sent to a model. */
  readonly iconUrl: string | null
}

export interface AnalysisItem {
  readonly id: string
  readonly instanceId: number
  readonly gameId: number
  readonly groupId: number
  readonly position: AnalysisVector3
  readonly rotation: AnalysisVector3
  readonly scale: AnalysisVector3
  readonly bounds: AnalysisBounds | null
}

export interface AnalysisGroup {
  readonly groupId: number
  readonly name: string | null
  readonly collectionId: string | null
  readonly totalMemberCount: number
  readonly scopedMemberCount: number
  readonly hasOrigin: boolean
  /** An origin outside the authorized scope is not exposed as an item ID. */
  readonly originItemId: string | null
}

export interface AnalysisSnapshot {
  readonly version: 1
  readonly id: string
  readonly schemeId: string
  readonly coordinateSystem: {
    readonly position: 'world-z-up'
    readonly lengthUnit: 'cm'
    readonly rotation: 'visual-degrees'
    readonly scale: 'visual-axes'
  }
  readonly items: readonly AnalysisItem[]
  readonly furniture: readonly (AnalysisFurniture & { readonly instanceCount: number })[]
  readonly groups: readonly AnalysisGroup[]
  readonly collections: readonly Readonly<SchemeCollection>[]
}

export interface AnalysisSnapshotInput {
  id: string
  schemeId: string
  items: readonly AppItem[]
  itemIds: readonly string[]
  collectionTree: CollectionTree
  groupOrigins: ReadonlyMap<number, string>
  getFurniture: (gameId: number) => AnalysisFurniture | null
  getBounds: (item: AppItem) => AnalysisBounds | null
}

export interface AnalysisPageRequest {
  offset?: number
  limit?: number
}

export interface AnalysisPage<T> {
  readonly total: number
  readonly offset: number
  readonly nextOffset: number | null
  readonly items: readonly T[]
}

export interface AnalysisCatalogQuery extends AnalysisPageRequest {
  gameIds?: readonly number[]
}

export interface OrganizeItemsCommand {
  readonly collections: readonly Readonly<SchemeCollection>[]
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly collectionId: string | null
    readonly itemIds: readonly string[]
    readonly order: number
  }[]
}

export interface OrganizationChanges {
  readonly transactionId?: string
  readonly collections: readonly { readonly id: string; readonly collectionId: string }[]
  readonly groups: readonly {
    readonly id: string
    readonly groupId: number
    readonly itemCount: number
  }[]
  readonly regroupedItemCount: number
  readonly affectedGroups: readonly {
    readonly groupId: number
    readonly movedItemCount: number
    readonly remainingMemberCount: number
    readonly originCleared: boolean
  }[]
}

export type AnalysisErrorCode =
  'invalid_input' | 'out_of_scope' | 'unavailable' | 'stale_snapshot' | 'cancelled'

export class SceneAnalysisError extends Error {
  readonly code: AnalysisErrorCode

  constructor(code: AnalysisErrorCode, message: string) {
    super(message)
    this.name = 'SceneAnalysisError'
    this.code = code
  }
}

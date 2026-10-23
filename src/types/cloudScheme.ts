import type { CollectionTree } from '@/lib/collectionTree'
import type { AppItem, EditorTransaction } from './editor'

export interface SharedSchemeSnapshot {
  name: string
  filePath?: string
  lastModified?: number
  items: AppItem[]
  collectionTree?: CollectionTree
  groupOrigins: Array<[number, string]>
}

export interface CloudSchemeDocument {
  roomCode: string
  collectionTreeVersion?: number
  revision: number
  updatedAt: number
  scheme: SharedSchemeSnapshot
}

export interface CloudPresenceUser {
  clientId: string
  displayName: string
  connectedAt: number
}

export type CloudHistoryEventType =
  'remote_tx' | 'user_joined' | 'user_left' | 'connected' | 'reconnected' | 'conflict_reload'

/**
 * 云同步历史里一笔「远程事务」涉及的物品 id，按操作语义分三类（云 Popover 里按「几个物品」展示、合并时做并集去重）。
 * - added：add_items 里的 internalId
 * - removed：remove_items
 * - patched：patch_items 里的 itemId（同一物品多次 patch 只保留一个 id）
 */
export interface CloudHistoryItemBuckets {
  added: string[]
  removed: string[]
  patched: string[]
}

export interface CloudHistoryEvent {
  id: string
  type: CloudHistoryEventType
  createdAt: number
  actorClientId?: string
  actorDisplayName?: string
  /** 展示/混合统计用数字；有 itemBuckets 时应与 buckets 派生值一致 */
  collectionTreeChanged?: boolean
  itemCount?: number
  addedCount?: number
  removedCount?: number
  updatedCount?: number
  /**
   * 仅 remote_tx 使用。存在时 Popover 合并相邻记录会按 id 并集去重；
   * 旧会话无此字段时合并回退为「数字相加」。
   */
  itemBuckets?: CloudHistoryItemBuckets
}

export interface CreateCloudSchemeResponse {
  roomCode: string
  document: CloudSchemeDocument
}

export interface CloudSnapshotResponse {
  document: CloudSchemeDocument
}

export interface CloudWsHelloMessage {
  type: 'hello'
  collectionTreeVersion?: number
  roomCode: string
  revision: number
}

export interface CloudWsSnapshotMessage {
  type: 'snapshot'
  document: CloudSchemeDocument
}

export interface CloudWsCommittedTransactionMessage {
  type: 'tx_committed'
  revision: number
  authorClientId: string
  transaction: EditorTransaction
}

export interface CloudWsResetMessage {
  type: 'reset'
  document: CloudSchemeDocument
  reason: 'version_mismatch'
}

export interface CloudWsPresenceMessage {
  type: 'presence'
  users: CloudPresenceUser[]
}

export interface CloudWsErrorMessage {
  type: 'error'
  message: string
}

export interface CloudWsPushTransactionMessage {
  type: 'push_tx'
  clientId: string
  baseRevision: number
  transaction: EditorTransaction
}

export type CloudWsIncomingMessage =
  | CloudWsHelloMessage
  | CloudWsSnapshotMessage
  | CloudWsCommittedTransactionMessage
  | CloudWsResetMessage
  | CloudWsPresenceMessage
  | CloudWsErrorMessage

export type CloudWsOutgoingMessage = CloudWsPushTransactionMessage

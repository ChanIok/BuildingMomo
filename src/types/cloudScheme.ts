import type { AppItem } from './editor'

export interface SharedSchemeSnapshot {
  name: string
  filePath?: string
  lastModified?: number
  items: AppItem[]
  groupOrigins: Array<[number, string]>
}

export interface CloudSchemeDocument {
  roomCode: string
  revision: number
  updatedAt: number
  scheme: SharedSchemeSnapshot
}

export interface CloudPresenceUser {
  clientId: string
  displayName: string
  connectedAt: number
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
  roomCode: string
  revision: number
}

export interface CloudWsSnapshotMessage {
  type: 'snapshot'
  document: CloudSchemeDocument
  authorClientId?: string
}

export interface CloudWsAckMessage {
  type: 'ack'
  revision: number
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

export interface CloudWsPushSnapshotMessage {
  type: 'push_snapshot'
  clientId: string
  baseRevision: number
  snapshot: SharedSchemeSnapshot
}

export type CloudWsIncomingMessage =
  | CloudWsHelloMessage
  | CloudWsSnapshotMessage
  | CloudWsAckMessage
  | CloudWsResetMessage
  | CloudWsPresenceMessage
  | CloudWsErrorMessage

export type CloudWsOutgoingMessage = CloudWsPushSnapshotMessage

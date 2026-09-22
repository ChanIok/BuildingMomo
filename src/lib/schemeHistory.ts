import type { AppItem, SchemeSource, ThreeViewState } from '@/types/editor'
import { SCHEME_HISTORY_VERSION } from '@/types/schemeHistory'
import type { SchemeHistoryFile } from '@/types/schemeHistory'

/** 文件名主干长度上限，为完整路径留出余量 */
const MAX_FILE_NAME_STEM_LENGTH = 64

/**
 * 方案 id → 历史文件名。
 *
 * 必须是纯函数且对同一 id 恒定：从历史文件恢复方案时会复用文件里记录的 id，
 * 只有映射恒定才能保证再次写入仍命中同一个文件。
 * 方案 id 目前都是 uuid，转义只是保险：万一将来 id 形态变了（例如引入了带分隔符的
 * 外部标识），也不会写出 Windows 非法文件名。
 */
export function schemeHistoryFileName(schemeId: string): string {
  const stem = schemeId
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, MAX_FILE_NAME_STEM_LENGTH)

  return `${stem.length > 0 ? stem : 'scheme'}.json`
}

export interface SchemeHistorySnapshotInput {
  schemeId: string
  source: SchemeSource
  name: string
  filePath?: string
  lastModified?: number
  items: AppItem[]
  currentViewConfig?: { scale: number; x: number; y: number }
  viewState?: ThreeViewState
  groupOrigins: Map<number, string>
}

export function buildSchemeHistoryFile(
  input: SchemeHistorySnapshotInput,
  updatedAt: number = Date.now()
): SchemeHistoryFile {
  return {
    version: SCHEME_HISTORY_VERSION,
    schemeId: input.schemeId,
    source: input.source,
    updatedAt,
    name: input.name,
    filePath: input.filePath,
    lastModified: input.lastModified,
    items: input.items,
    currentViewConfig: input.currentViewConfig,
    viewState: input.viewState,
    groupOrigins: Array.from(input.groupOrigins.entries()),
  }
}

/** 解析历史文件；结构不合法时返回 null。 */
export function parseSchemeHistoryFile(raw: unknown): SchemeHistoryFile | null {
  if (!raw || typeof raw !== 'object') return null

  const candidate = raw as Partial<SchemeHistoryFile>
  if (candidate.version !== SCHEME_HISTORY_VERSION) return null
  if (typeof candidate.schemeId !== 'string' || candidate.schemeId.length === 0) return null
  if (!Array.isArray(candidate.items) || !Array.isArray(candidate.groupOrigins)) return null

  return {
    version: SCHEME_HISTORY_VERSION,
    schemeId: candidate.schemeId,
    source: candidate.source === 'cloud' ? 'cloud' : 'local',
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    filePath: candidate.filePath,
    lastModified: candidate.lastModified,
    items: candidate.items,
    currentViewConfig: candidate.currentViewConfig,
    viewState: candidate.viewState,
    groupOrigins: candidate.groupOrigins,
  }
}

export interface SchemeHistoryPruneCandidate {
  fileName: string
  updatedAt: number
}

/**
 * 挑选需要淘汰的历史文件：超出条数上限，或早于保留期限。
 * 传入的 updatedAt 用文件系统 mtime，避免为了淘汰去读取文件内容。
 */
export function selectSchemeHistoryToPrune(
  candidates: SchemeHistoryPruneCandidate[],
  now: number,
  limits: { maxCount: number; maxAgeMs: number }
): string[] {
  return [...candidates]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter(
      (candidate, index) => index >= limits.maxCount || candidate.updatedAt < now - limits.maxAgeMs
    )
    .map((candidate) => candidate.fileName)
}

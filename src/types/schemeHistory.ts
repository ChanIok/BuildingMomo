import type { ArchivedSchemeSnapshot } from './archive'
import type { SchemeSource } from './editor'

export const SCHEME_HISTORY_VERSION = 1
/** 方案历史目录名，位于游戏目录下的 BuildingMomo 文件夹内 */
export const SCHEME_HISTORY_DIR_NAME = 'history'
/** 备份根目录名，与方案集共用同一个 BuildingMomo 文件夹 */
export const SCHEME_HISTORY_ROOT_DIR_NAME = 'BuildingMomo'

/**
 * 单个方案的历史文件。
 *
 * `schemeId` 是稳定的文件名来源：从历史打开时用文件里记录的 schemeId 重建方案，
 * 保证再次写入仍然命中同一个文件（见 lib/schemeHistory.ts 的 schemeHistoryFileName）。
 */
export interface SchemeHistoryFile extends ArchivedSchemeSnapshot {
  version: number
  schemeId: string
  source: SchemeSource
  updatedAt: number
}

/** 面板展示用的一条历史记录。 */
export interface SchemeHistoryEntry {
  fileName: string
  schemeId: string
  name: string
  itemCount: number
  updatedAt: number
  size: number
}

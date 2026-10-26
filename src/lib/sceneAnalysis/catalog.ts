import type { AnalysisCatalogQuery, AnalysisSnapshot } from './types'
import { analysisPage, assertScopedIds } from './queries'
import { readIntegers } from './validation'

/** Reads the captured dictionary only, never the live/global furniture database. */
export function queryAnalysisCatalog(snapshot: AnalysisSnapshot, query: AnalysisCatalogQuery = {}) {
  const ids = query.gameIds === undefined ? null : new Set(readIntegers(query.gameIds, 'game IDs'))
  if (ids) assertScopedIds([...ids], new Set(snapshot.furniture.map((item) => item.gameId)))
  return analysisPage(
    snapshot.furniture.filter((item) => !ids || ids.has(item.gameId)),
    query
  )
}

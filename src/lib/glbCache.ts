/**
 * GLB IndexedDB 缓存
 *
 * key  = `${profile}:${path}`（按资源档位隔离）
 * value = { hash, buffer }
 *
 * 加载流程：
 *   1. 用 profile + path 查缓存，命中且 hash 一致 → 直接返回 buffer
 *   2. hash 不一致（文件已更新） → 下载新 buffer，覆写同一条记录
 *   3. 无缓存 → 下载，写入新记录
 */

import { createStore, del, get, keys, set } from 'idb-keyval'
import type { ModelAssetProfile } from '@/types/furniture'

interface GLBCacheEntry {
  hash: string
  buffer: ArrayBuffer
}

const glbStore = createStore('glb-cache', 'glbs')

function buildGLBCacheKey(profile: ModelAssetProfile, path: string): string {
  return `${profile}:${path}`
}

/** 构造当前资源清单允许存在的缓存 key */
export function createGLBCacheKey(profile: ModelAssetProfile, path: string): string {
  return buildGLBCacheKey(profile, path)
}

/** 按 profile + path 查缓存条目，未命中或出错返回 null */
export async function getGLBCacheEntry(
  profile: ModelAssetProfile,
  path: string
): Promise<GLBCacheEntry | null> {
  try {
    return (await get<GLBCacheEntry>(buildGLBCacheKey(profile, path), glbStore)) ?? null
  } catch {
    return null
  }
}

/** 将条目写入缓存（相同 profile + path 覆盖旧记录），失败静默忽略 */
export async function putGLBCacheEntry(
  profile: ModelAssetProfile,
  path: string,
  hash: string,
  buffer: ArrayBuffer
): Promise<void> {
  try {
    await set(buildGLBCacheKey(profile, path), { hash, buffer } satisfies GLBCacheEntry, glbStore)
  } catch (err) {
    console.warn('[GLBCache] Failed to write cache entry:', err)
  }
}

/** 列出当前 GLB 缓存中的全部 key，出错时返回空数组 */
export async function listGLBCacheKeys(): Promise<string[]> {
  try {
    return await keys<string>(glbStore)
  } catch (err) {
    console.warn('[GLBCache] Failed to list cache keys:', err)
    return []
  }
}

/** 删除单个 GLB 缓存条目，失败静默记录 */
export async function deleteGLBCacheEntry(key: string): Promise<void> {
  try {
    await del(key, glbStore)
  } catch (err) {
    console.warn('[GLBCache] Failed to delete cache entry:', err)
  }
}

/**
 * 清理不再出现在当前家具数据库中的孤儿 GLB 缓存。
 *
 * 只删除 key 不在 validKeys 中的条目；仍在资源清单中的条目保持不动。
 */
export async function sweepGLBCache(validKeys: Set<string>): Promise<number> {
  const cachedKeys = await listGLBCacheKeys()
  const staleKeys = cachedKeys.filter((key) => !validKeys.has(key))

  if (staleKeys.length === 0) return 0

  await Promise.all(staleKeys.map((key) => deleteGLBCacheEntry(key)))
  console.log(`[GLBCache] Removed ${staleKeys.length} stale entries`)
  return staleKeys.length
}

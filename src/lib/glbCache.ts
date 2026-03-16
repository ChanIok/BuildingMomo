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

import { createStore, get, set } from 'idb-keyval'
import type { ModelAssetProfile } from '@/types/furniture'

interface GLBCacheEntry {
  hash: string
  buffer: ArrayBuffer
}

const glbStore = createStore('glb-cache', 'glbs')

function buildGLBCacheKey(profile: ModelAssetProfile, path: string): string {
  return `${profile}:${path}`
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

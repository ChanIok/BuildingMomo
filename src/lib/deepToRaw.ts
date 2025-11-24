import { toRaw, isRef } from 'vue'

/**
 * 深度递归解包 Vue Proxy
 * 替代 JSON.parse(JSON.stringify()) 的高性能方案
 * 配合 structuredClone 使用可避免 DataCloneError
 */
export function deepToRaw<T>(value: T): T {
  // 处理 Ref
  if (isRef(value)) {
    return deepToRaw(value.value) as T
  }

  const raw = toRaw(value)

  // 处理数组
  if (Array.isArray(raw)) {
    return raw.map((item) => deepToRaw(item)) as any
  }

  // 处理普通对象 (排除 null 和非普通对象如 Date/RegExp 等，它们由 structuredClone 处理)
  if (raw !== null && typeof raw === 'object' && raw.constructor === Object) {
    const result: any = {}
    for (const key in raw) {
      result[key] = deepToRaw(raw[key])
    }
    return result
  }

  // 基本类型或保留类型直接返回
  return raw
}

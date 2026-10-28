import { scriptMath } from './math'
import type { JsonValue } from './types'

export type HostCall = (method: string, args: JsonValue[]) => Promise<JsonValue>
export interface ScriptResult {
  ok: boolean
  values?: Record<string, JsonValue>
  result?: JsonValue
  logs: JsonValue[][]
  error?: { code: string; message: string }
}

/** Restrict persisted vars to data. Never silently lose functions, NaN, cycles or prototypes. */
export function serializeData(
  value: unknown,
  path = 'vars',
  parents = new Set<object>()
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object') throw new Error(`${path}: only finite JSON data can be saved`)
  if (parents.has(value)) throw new Error(`${path}: circular data cannot be saved`)
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error(`${path}: only arrays and plain objects can be saved`)
  parents.add(value)
  try {
    if (Array.isArray(value))
      return Array.from(value, (v, i) => serializeData(v, `${path}[${i}]`, parents))
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, serializeData(v, `${path}.${key}`, parents)])
    )
  } finally {
    parents.delete(value)
  }
}

/** Disposable execution; only vars survives. Worker isolation is not a hostile-code sandbox. */
export async function evaluateScript(
  code: string,
  values: Record<string, JsonValue>,
  call: HostCall,
  onLog?: (values: JsonValue[]) => void
): Promise<ScriptResult> {
  const pending: Promise<unknown>[] = []
  const invoke: HostCall = (method, args) => {
    const promise = call(method, args)
    pending.push(promise)
    promise.catch(() => {})
    return promise
  }
  const vars = structuredClone(values)
  const logs: JsonValue[][] = []
  const print = (...args: unknown[]) => {
    const row = args.map((arg) => (arg === undefined ? 'undefined' : serializeData(arg, 'output')))
    logs.push(row)
    onLog?.(row)
  }
  const api: Record<string, unknown> = Object.fromEntries(
    [
      'schemes',
      'items',
      'selection',
      'structure',
      'refresh',
      'render',
      'organize',
      'help',
      'history',
      'showImage',
    ].map((name) => [
      name,
      (...args: unknown[]) =>
        invoke(
          name,
          args.map((v) => serializeData(v, 'argument'))
        ),
    ])
  )
  api.math = scriptMath
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const result = await new AsyncFunction('vars', 'api', 'console', `"use strict";\n${code}`)(
      vars,
      Object.freeze(api),
      Object.freeze({ log: print, info: print, warn: print, error: print })
    )
    // Drain calls before admitting vars. Awaited errors follow normal JS try/catch semantics.
    await Promise.allSettled(pending)
    return {
      ok: true,
      values: serializeData(vars) as Record<string, JsonValue>,
      ...(result === undefined ? {} : { result: serializeData(result, 'return') }),
      logs,
    }
  } catch (error) {
    return {
      ok: false,
      logs,
      error: {
        code:
          typeof error === 'object' && error && 'code' in error ? String(error.code) : 'compute',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

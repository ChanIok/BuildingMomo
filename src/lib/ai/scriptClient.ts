import { AiError, failure, type JsonValue } from './types'
import type { HostCall, ScriptResult } from './scriptRuntime'

export type ScriptExecutor = (
  code: string,
  values: Record<string, JsonValue>,
  call: HostCall,
  signal: AbortSignal
) => Promise<ScriptResult>

export function createScriptExecutor(
  factory = () =>
    new Worker(new URL('../../workers/aiScript.worker.ts', import.meta.url), { type: 'module' }),
  timeoutMs = 30_000
): ScriptExecutor {
  return (code, values, call, signal) =>
    new Promise((resolve) => {
      const logs: JsonValue[][] = []
      let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (result: ScriptResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        worker?.terminate()
        resolve(result)
      }
      const fail = (code: string, message: string) =>
        finish({ ok: false, logs, error: { code, message } })
      const abort = () => fail('cancelled', 'Execution stopped; completed edits remain recorded.')
      if (signal.aborted) {
        abort()
        return
      }
      try {
        worker = factory()
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(
          () =>
            fail(
              'compute_timeout',
              'Script exceeded its time limit; check recorded edits before retrying.'
            ),
          timeoutMs
        )
        worker.onmessage = async ({ data }) => {
          if (settled) return
          if (data.type === 'log') logs.push(data.values)
          else if (data.type === 'result') finish(data.result)
          else if (data.type === 'call') {
            try {
              const value = await call(data.method, data.args)
              if (!settled) worker!.postMessage({ type: 'reply', id: data.id, value })
            } catch (error) {
              if (!settled)
                worker!.postMessage({
                  type: 'reply',
                  id: data.id,
                  error: {
                    code:
                      typeof error === 'object' &&
                      error &&
                      'code' in error &&
                      typeof error.code === 'string'
                        ? error.code
                        : failure(error).code,
                    message: error instanceof Error ? error.message : String(error),
                  },
                })
            }
          }
        }
        worker.onerror = (event) => {
          event.preventDefault()
          fail('compute', event.message)
        }
        worker.postMessage({ type: 'execute', code, values })
      } catch (error) {
        const cause =
          error instanceof AiError ? error : new AiError('compute', 'Cannot start script Worker')
        fail(cause.code, cause.message)
      }
    })
}
export const runScript = createScriptExecutor()

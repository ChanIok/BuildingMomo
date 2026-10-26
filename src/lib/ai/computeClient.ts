import { AiError, assertNotAborted } from './types'
import type { Publication } from './computation'
export type ComputeExecutor = (
  code: string,
  input: Record<string, unknown>,
  signal: AbortSignal
) => Promise<Publication[]>

/** A new Worker for each execution; no persistent kernel or access to app objects. */
export function createComputeExecutor(
  factory = () =>
    new Worker(new URL('../../workers/aiCompute.worker.ts', import.meta.url), { type: 'module' }),
  timeoutMs = 5000
): ComputeExecutor {
  return (code, input, signal) => {
    assertNotAborted(signal)
    return new Promise((resolve, reject) => {
      let worker: Worker
      try {
        worker = factory()
      } catch {
        reject(
          new AiError(
            'compute',
            'Cannot start computation Worker; check worker CSP and browser support'
          )
        )
        return
      }
      let settled = false
      const settle = (error?: unknown, outputs?: Publication[]) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        worker.terminate()
        if (error) reject(error)
        else resolve(outputs!)
      }
      const abort = () => settle(new DOMException('Stopped', 'AbortError'))
      const timer = setTimeout(
        () => settle(new AiError('compute_timeout', 'Computation exceeded its time limit')),
        timeoutMs
      )
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) {
        abort()
        return
      }
      worker.onmessage = ({ data }) => {
        if (!data || typeof data.ok !== 'boolean') {
          settle(new AiError('compute', 'Invalid Worker output'))
          return
        }
        if (!data.ok) settle(new AiError('compute', String(data.error).slice(0, 2000)))
        else settle(undefined, data.outputs)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        settle(new AiError('compute', event.message || 'Worker failed; check worker CSP'))
      }
      try {
        worker.postMessage({ code, input })
      } catch (cause) {
        settle(cause)
      }
    })
  }
}
export const runComputation = createComputeExecutor()

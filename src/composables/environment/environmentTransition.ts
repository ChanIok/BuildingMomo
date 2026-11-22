interface EnvironmentTransitionOptions {
  apply(): Promise<void>
  prepare(
    stale: () => boolean,
    progress: (completed: number, total: number, phase?: 'shaders' | 'shadows') => void
  ): Promise<boolean>
  start(): void
  progress(completed: number, total: number, phase?: 'shaders' | 'shadows'): void
  finish(): void
  cancel(): void
  fail(error: unknown): void
  invalidate(): void
}

/** Hold the last canvas image while preparing new shader variants. DOM/input
 * stay live; no draw may synchronously wait on an unfinished shader program. */
export function createEnvironmentTransition(options: EnvironmentTransitionOptions) {
  let revision = 0
  let running = false
  let disposed = false

  async function request() {
    revision++
    if (running || disposed) return
    running = true
    options.start()
    try {
      // Allow the switch and progress indicator to paint before any GPU work.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      while (!disposed) {
        const version = revision
        const stale = () => disposed || version !== revision
        await options.apply()
        if (stale()) continue
        const ready = await options.prepare(stale, options.progress)
        if (stale()) continue
        if (!ready) throw new Error('Scene environment preparation was interrupted')
        options.finish()
        break
      }
    } catch (error) {
      if (!disposed) options.fail(error)
    } finally {
      running = false
      if (!disposed) options.invalidate()
    }
  }

  return {
    request,
    get pending() {
      return running
    },
    dispose() {
      disposed = true
      revision++
      if (running) options.cancel()
    },
  }
}

interface TimerExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

// Sample actual drawn frames without waiting for the GPU or forcing idle frames.
export function createGpuFrameTimer(
  gl: WebGL2RenderingContext,
  enabled: () => boolean,
  report: (milliseconds: number | null, sampledAt: number) => void
) {
  let extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
  let active: WebGLQuery | null = null
  const pending: { query: WebGLQuery; at: number }[] = []
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let lastSample = -Infinity
  let disposed = false

  function clear() {
    clearTimeout(pollTimer)
    pollTimer = undefined
    if (!gl.isContextLost()) {
      if (active && extension) gl.endQuery(extension.TIME_ELAPSED_EXT)
      if (active) gl.deleteQuery(active)
      for (const { query } of pending) gl.deleteQuery(query)
    }
    active = null
    pending.length = 0
    report(null, performance.now())
  }

  function poll() {
    pollTimer = undefined
    if (disposed) return
    if (
      !enabled() ||
      gl.isContextLost() ||
      !extension ||
      gl.getParameter(extension.GPU_DISJOINT_EXT)
    ) {
      clear()
      return
    }
    while (pending.length) {
      const sample = pending[0]!
      if (!gl.getQueryParameter(sample.query, gl.QUERY_RESULT_AVAILABLE)) break
      const nanoseconds = gl.getQueryParameter(sample.query, gl.QUERY_RESULT) as number
      gl.deleteQuery(sample.query)
      pending.shift()
      report(Number.isFinite(nanoseconds) && nanoseconds >= 0 ? nanoseconds / 1e6 : null, sample.at)
    }
    if (pending.length) pollTimer = setTimeout(poll, 100)
  }

  function contextLost() {
    clear()
    extension = null
  }

  function contextRestored() {
    extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
    lastSample = -Infinity
  }

  gl.canvas.addEventListener('webglcontextlost', contextLost)
  gl.canvas.addEventListener('webglcontextrestored', contextRestored)

  return {
    beginFrame(): (() => void) | undefined {
      if (disposed || !extension || !enabled() || gl.isContextLost()) return
      const at = performance.now()
      if (active || pending.length >= 4 || at - lastSample < 250) return
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        clear()
        return
      }
      // External profilers may already own the single elapsed-time query target.
      if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return
      const query = gl.createQuery()
      if (!query) return
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
      active = query
      lastSample = at
      return () => {
        if (disposed || active !== query || !extension) return
        if (gl.isContextLost()) {
          clear()
          return
        }
        gl.endQuery(extension.TIME_ELAPSED_EXT)
        active = null
        pending.push({ query, at })
        if (pollTimer === undefined) pollTimer = setTimeout(poll, 100)
      }
    },
    dispose() {
      disposed = true
      clear()
      gl.canvas.removeEventListener('webglcontextlost', contextLost)
      gl.canvas.removeEventListener('webglcontextrestored', contextRestored)
    },
  }
}

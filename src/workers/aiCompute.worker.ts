import { evaluateComputation } from '../lib/ai/computation'
const scope = self as unknown as {
  onmessage: (event: MessageEvent) => void
  postMessage(value: unknown): void
}
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ ok: true, outputs: evaluateComputation(data.code, data.input) })
  } catch (cause) {
    scope.postMessage({
      ok: false,
      error: cause instanceof Error ? cause.message : 'Computation failed',
    })
  }
}

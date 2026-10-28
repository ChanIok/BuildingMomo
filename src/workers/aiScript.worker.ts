import { evaluateScript, type HostCall } from '../lib/ai/scriptRuntime'
import type { JsonValue } from '../lib/ai/types'

let sequence = 0
const pending = new Map<
  number,
  { resolve: (value: JsonValue) => void; reject: (error: Error) => void }
>()
const call: HostCall = (method, args) =>
  new Promise((resolve, reject) => {
    const id = sequence++
    pending.set(id, { resolve, reject })
    self.postMessage({ type: 'call', id, method, args })
  })
self.onmessage = async ({ data }) => {
  if (data.type === 'reply') {
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.error)
      entry.reject(Object.assign(new Error(data.error.message), { code: data.error.code }))
    else entry.resolve(data.value)
  } else if (data.type === 'execute') {
    const result = await evaluateScript(data.code, data.values, call, (values) =>
      self.postMessage({ type: 'log', values })
    )
    self.postMessage({ type: 'result', result })
  }
}

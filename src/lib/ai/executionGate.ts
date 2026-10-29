import { shallowRef } from 'vue'
import { AiError } from './types'

// Both entry points borrow the same viewport and must not overlap executions.
export const aiExecutionBusy = shallowRef(false)

export function acquireAiExecution() {
  if (aiExecutionBusy.value) throw new AiError('busy')
  aiExecutionBusy.value = true
  return () => {
    aiExecutionBusy.value = false
  }
}

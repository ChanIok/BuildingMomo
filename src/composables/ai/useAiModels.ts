import { onScopeDispose, shallowRef, watch } from 'vue'
import { listConnectionModels, type AiModel, type ModelConnection } from '@/lib/ai/models'
import { AiError } from '@/lib/ai/types'

/** Query drafts without committing settings. Each result belongs to one exact draft and request. */
export function useAiModels(
  connection: () => ModelConnection | undefined,
  enabled: () => boolean,
  query: typeof listConnectionModels = listConnectionModels
) {
  const models = shallowRef<AiModel[]>([])
  const state = shallowRef<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = shallowRef<AiError>()
  let active: AbortController | undefined
  function clear() {
    active?.abort()
    active = undefined
    models.value = []
    state.value = 'idle'
    error.value = undefined
  }
  watch(() => JSON.stringify([enabled(), connection()]), clear, { flush: 'sync' })
  onScopeDispose(clear)
  async function refresh() {
    if (!enabled()) return false
    clear()
    const draft = connection()
    if (!draft) {
      state.value = 'error'
      error.value = new AiError('settings')
      return false
    }
    const controller = new AbortController()
    active = controller
    state.value = 'loading'
    try {
      const result = await query(draft, controller.signal)
      if (active !== controller || controller.signal.aborted) return false
      models.value = result
      state.value = 'ready'
      return true
    } catch (cause) {
      if (active !== controller || controller.signal.aborted) return false
      error.value = cause instanceof AiError ? cause : new AiError('models_network')
      state.value = 'error'
      return false
    } finally {
      if (active === controller) active = undefined
    }
  }
  return { models, state, error, refresh }
}

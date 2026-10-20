import { defineAsyncComponent } from 'vue'
import type { AsyncComponentLoader, Component } from 'vue'

/** Keep retries inside Vue's async wrapper, without remounting the editor or reloading the page. */
export function defineAsyncView<T extends Component>(
  loader: AsyncComponentLoader<T>,
  notifyFailure: (retry: () => void) => void
) {
  return defineAsyncComponent({
    loader,
    onError(error, retry) {
      console.error('[AsyncView] Failed to load view:', error)
      notifyFailure(retry)
    },
  })
}

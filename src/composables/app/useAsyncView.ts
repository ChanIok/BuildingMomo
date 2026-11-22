import { defineAsyncComponent, type AsyncComponentLoader, type Component } from 'vue'
import { useNotification } from './useNotification'
import { useI18n } from './useI18n'

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

export function useAsyncView<T extends Component>(loader: AsyncComponentLoader<T>) {
  const notification = useNotification()
  const { t } = useI18n()
  return defineAsyncView(loader, (retry) => {
    // Keep the retry action available while Vue's shared load request is pending.
    notification.error(t('asyncView.failed'), {
      duration: Infinity,
      dismissible: false,
      action: { label: t('asyncView.retry'), onClick: retry },
    })
  })
}

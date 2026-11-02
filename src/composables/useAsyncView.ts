import type { AsyncComponentLoader, Component } from 'vue'
import { defineAsyncView } from '@/lib/asyncView'
import { useNotification } from './useNotification'
import { useI18n } from './useI18n'

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

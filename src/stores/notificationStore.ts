import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useI18n } from '../composables/useI18n'

// 详情项接口
export interface AlertDetailItem {
  type: 'warning' | 'info' | 'error' | 'success'
  title: string
  list?: string[] // 列表项
  text?: string // 普通文本
}

// AlertDialog 配置接口
export interface AlertConfig {
  id: string
  title: string
  description?: string
  details?: AlertDetailItem[]
  confirmText?: string
  cancelText?: string
  checkboxLabel?: string // 勾选框文本
  checkboxChecked?: boolean // 勾选状态
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
}

export const useNotificationStore = defineStore('notification', () => {
  const { t } = useI18n()

  // AlertDialog 队列
  const alerts = ref<AlertConfig[]>([])

  // 当前显示的 Alert
  const currentAlert = ref<AlertConfig | null>(null)

  // 显示 Alert
  function showAlert(config: Omit<AlertConfig, 'id'>): void {
    const id = generateAlertId()
    const alert: AlertConfig = {
      id,
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      ...config,
    }

    // 如果当前没有显示的 Alert，直接显示
    if (!currentAlert.value) {
      currentAlert.value = alert
    } else {
      // 否则加入队列
      alerts.value.push(alert)
    }
  }

  // 显示 Confirm（返回 Promise）
  function confirm(config: {
    title: string
    description?: string
    details?: AlertDetailItem[]
    confirmText?: string
    cancelText?: string
  }): Promise<boolean> {
    return new Promise((resolve) => {
      showAlert({
        ...config,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
  }

  // 显示带勾选框的 Confirm（返回 Promise<{ confirmed: boolean, checked: boolean }>）
  function confirmWithCheckbox(config: {
    title: string
    description?: string
    details?: AlertDetailItem[]
    confirmText?: string
    cancelText?: string
    checkboxLabel: string
  }): Promise<{ confirmed: boolean; checked: boolean }> {
    return new Promise((resolve) => {
      showAlert({
        ...config,
        checkboxChecked: false, // 默认不勾选
        onConfirm: () => {
          // 获取当前的 checked 状态
          const checked = currentAlert.value?.checkboxChecked ?? false
          resolve({ confirmed: true, checked })
        },
        onCancel: () => {
          const checked = currentAlert.value?.checkboxChecked ?? false
          resolve({ confirmed: false, checked })
        },
      })
    })
  }
  function closeCurrentAlert(): void {
    currentAlert.value = null

    // 如果队列中还有 Alert，显示下一个
    if (alerts.value.length > 0) {
      currentAlert.value = alerts.value.shift() ?? null
    }
  }

  // 确认当前 Alert
  async function confirmCurrentAlert(): Promise<void> {
    if (!currentAlert.value) return

    const alert = currentAlert.value

    // 先执行回调（此时 currentAlert.value 还没有被清空，回调中可以读取 checkboxChecked）
    await alert.onConfirm?.()

    // 再关闭对话框
    closeCurrentAlert()
  }

  // 取消当前 Alert
  function cancelCurrentAlert(): void {
    if (!currentAlert.value) return

    const alert = currentAlert.value

    // 先执行回调（此时 currentAlert.value 还没有被清空，回调中可以读取 checkboxChecked）
    alert.onCancel?.()

    // 再关闭对话框
    closeCurrentAlert()
  }

  // 生成唯一ID
  function generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  return {
    currentAlert,
    showAlert,
    confirm,
    confirmWithCheckbox,
    confirmCurrentAlert,
    cancelCurrentAlert,
    closeCurrentAlert,
  }
})

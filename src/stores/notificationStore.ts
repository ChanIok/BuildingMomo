import { defineStore } from 'pinia'
import { ref } from 'vue'

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
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
}

export const useNotificationStore = defineStore('notification', () => {
  // AlertDialog 队列
  const alerts = ref<AlertConfig[]>([])

  // 当前显示的 Alert
  const currentAlert = ref<AlertConfig | null>(null)

  // 显示 Alert
  function showAlert(config: Omit<AlertConfig, 'id'>): void {
    const id = generateAlertId()
    const alert: AlertConfig = {
      id,
      confirmText: '确定',
      cancelText: '取消',
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

  // 关闭当前 Alert
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
    closeCurrentAlert()

    // 执行回调
    await alert.onConfirm?.()
  }

  // 取消当前 Alert
  function cancelCurrentAlert(): void {
    if (!currentAlert.value) return

    const alert = currentAlert.value
    closeCurrentAlert()

    // 执行回调
    alert.onCancel?.()
  }

  // 生成唯一ID
  function generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  return {
    currentAlert,
    showAlert,
    confirm,
    confirmCurrentAlert,
    cancelCurrentAlert,
    closeCurrentAlert,
  }
})

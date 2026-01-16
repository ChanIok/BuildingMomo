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
  category?: string // 弹窗类别（用于同类型弹窗替换策略）
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

    // 🔑 如果新弹窗有 category，执行替换策略
    if (config.category) {
      // 步骤1: 如果当前弹窗是同类型，直接替换
      if (currentAlert.value?.category === config.category) {
        console.log(`[NotificationStore] Replacing current alert of category: ${config.category}`)
        // 触发旧弹窗的 onCancel，确保旧 Promise 被正确清理
        currentAlert.value.onCancel?.()

        // 替换为新弹窗
        currentAlert.value = alert
        return // 直接返回，不加入队列
      }

      // 步骤2: 清除队列中所有同类型的弹窗
      const oldQueueLength = alerts.value.length
      alerts.value = alerts.value.filter((a) => {
        if (a.category === config.category) {
          // 触发被清除弹窗的 onCancel
          a.onCancel?.()
          return false
        }
        return true
      })

      // 记录清理日志
      const clearedCount = oldQueueLength - alerts.value.length
      if (clearedCount > 0) {
        console.log(
          `[NotificationStore] Cleared ${clearedCount} queued alert(s) of category: ${config.category}`
        )
      }
    }

    // 原有逻辑：显示或排队
    if (!currentAlert.value) {
      currentAlert.value = alert
    } else {
      // 否则加入队列
      alerts.value.push(alert)
    }
  }

  // 显示 Confirm（返回 Promise）
  function confirm(config: {
    category?: string
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
    category?: string
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

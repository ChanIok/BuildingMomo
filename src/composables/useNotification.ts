import { toast } from 'vue-sonner'
import { useNotificationStore } from '../stores/notificationStore'
import { useI18n } from './useI18n'

/**
 * 统一的通知系统 API
 * 提供简单的 toast 通知和复杂的 AlertDialog 确认框
 */
export function useNotification() {
  const notificationStore = useNotificationStore()
  const { t } = useI18n()

  return {
    // ===== Toast 通知（使用 vue-sonner）=====

    /**
     * 成功提示
     * @example notification.success('保存成功')
     */
    success: (message: string) => {
      toast.success(message)
    },

    /**
     * 错误提示
     * @example notification.error('保存失败')
     */
    error: (message: string) => {
      toast.error(message)
    },

    /**
     * 警告提示
     * @example notification.warning('文件已存在')
     */
    warning: (message: string) => {
      toast.warning(message)
    },

    /**
     * 普通提示
     * @example notification.info('数据已加载')
     */
    info: (message: string) => {
      toast.info(message)
    },

    /**
     * 加载中提示（返回关闭函数）
     * @example
     * const dismiss = notification.loading('正在保存...')
     * // 操作完成后
     * dismiss()
     */
    loading: (message: string) => {
      return toast.loading(message)
    },

    // ===== AlertDialog 确认框 =====

    /**
     * 显示确认对话框（返回 Promise<boolean>）
     * @example
     * const confirmed = await notification.confirm({
     *   title: '确认删除',
     *   description: '此操作不可撤销',
     * })
     * if (confirmed) {
     *   // 执行删除
     * }
     */
    confirm: notificationStore.confirm,

    /**
     * 显示带复选框的确认对话框
     */
    confirmWithCheckbox: notificationStore.confirmWithCheckbox,

    /**
     * 显示通知对话框（仅提示，不需要返回值）
     * @example
     * notification.alert({
     *   title: '提示',
     *   description: '操作成功',
     * })
     */
    alert: (config: {
      title: string
      description?: string
      details?: any[]
      confirmText?: string
    }) => {
      notificationStore.showAlert({
        ...config,
        cancelText: undefined, // 不显示取消按钮
      })
    },

    /**
     * 显示文件更新通知（专用）
     */
    fileUpdate: (fileName: string, lastModified: number): Promise<boolean> => {
      return notificationStore.confirm({
        title: t('notification.fileUpdate.title'),
        description: t('notification.fileUpdate.desc', {
          name: fileName,
          time: new Date(lastModified).toLocaleString(),
        }),
        confirmText: t('notification.fileUpdate.confirm'),
        cancelText: t('notification.fileUpdate.cancel'),
      })
    },
  }
}

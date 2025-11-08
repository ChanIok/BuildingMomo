import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useEditorStore } from './editorStore'
import { useClipboard } from '../composables/useClipboard'
import { useFileOperations } from '../composables/useFileOperations'

// 命令接口
export interface Command {
  id: string
  label: string
  shortcut?: string
  category: 'file' | 'edit' | 'view'
  enabled: () => boolean
  execute: () => void | Promise<void>
}

export type CommandCategory = 'file' | 'edit' | 'view'

export const useCommandStore = defineStore('command', () => {
  const editorStore = useEditorStore()

  // 缩放函数引用（需要从外部设置）
  const zoomInFn = ref<(() => void) | null>(null)
  const zoomOutFn = ref<(() => void) | null>(null)
  const resetViewFn = ref<(() => void) | null>(null)
  const fitToViewFn = ref<(() => void) | null>(null)

  // 剪贴板和文件操作
  const clipboard = useClipboard(editorStore)
  const fileOps = useFileOperations(editorStore, () => {
    // 导入成功后自动适配视图
    fitToViewFn.value?.()
  })

  // 定义所有命令
  const commands = computed<Command[]>(() => [
    // ===== 文件菜单 =====
    {
      id: 'file.startWatchMode',
      label: '监控游戏目录',
      shortcut: 'Ctrl+Shift+M',
      category: 'file',
      enabled: () => fileOps.isFileSystemAccessSupported && !fileOps.watchState.value.isActive,
      execute: async () => {
        console.log('[Command] 启动监控模式')
        await fileOps.startWatchMode()
      },
    },
    {
      id: 'file.stopWatchMode',
      label: '停止监控',
      category: 'file',
      enabled: () => fileOps.watchState.value.isActive,
      execute: () => {
        console.log('[Command] 停止监控模式')
        fileOps.stopWatchMode()
      },
    },
    {
      id: 'file.import',
      label: '导入 JSON',
      shortcut: 'Ctrl+O',
      category: 'file',
      enabled: () => true,
      execute: async () => {
        console.log('[Command] 导入 JSON')
        await fileOps.importJSON()
      },
    },
    {
      id: 'file.export',
      label: '导出 JSON',
      shortcut: 'Ctrl+S',
      category: 'file',
      enabled: () => editorStore.items.length > 0,
      execute: () => {
        console.log('[Command] 导出 JSON')
        fileOps.exportJSON()
      },
    },
    {
      id: 'file.saveToGame',
      label: '保存到游戏',
      shortcut: 'Ctrl+Shift+S',
      category: 'file',
      enabled: () =>
        editorStore.activeScheme?.sourceType === 'game' && editorStore.items.length > 0,
      execute: async () => {
        console.log('[Command] 保存到游戏')
        await fileOps.saveToGame()
      },
    },

    // ===== 编辑菜单 =====
    {
      id: 'edit.cut',
      label: '剪切',
      shortcut: 'Ctrl+X',
      category: 'edit',
      enabled: () => editorStore.selectedItemIds.size > 0,
      execute: () => {
        console.log('[Command] 剪切')
        clipboard.cut()
      },
    },
    {
      id: 'edit.copy',
      label: '复制',
      shortcut: 'Ctrl+C',
      category: 'edit',
      enabled: () => editorStore.selectedItemIds.size > 0,
      execute: () => {
        console.log('[Command] 复制')
        clipboard.copy()
      },
    },
    {
      id: 'edit.paste',
      label: '粘贴',
      shortcut: 'Ctrl+V',
      category: 'edit',
      enabled: () => clipboard.hasClipboardData.value,
      execute: () => {
        console.log('[Command] 粘贴')
        clipboard.paste()
      },
    },
    {
      id: 'edit.delete',
      label: '删除',
      shortcut: 'Delete',
      category: 'edit',
      enabled: () => editorStore.selectedItemIds.size > 0,
      execute: () => {
        console.log('[Command] 删除')
        editorStore.deleteSelected()
      },
    },
    {
      id: 'edit.selectAll',
      label: '全选',
      shortcut: 'Ctrl+A',
      category: 'edit',
      enabled: () => editorStore.visibleItems.length > 0,
      execute: () => {
        console.log('[Command] 全选')
        editorStore.selectAll()
      },
    },
    {
      id: 'edit.deselectAll',
      label: '取消选择',
      shortcut: 'Escape',
      category: 'edit',
      enabled: () => editorStore.selectedItemIds.size > 0,
      execute: () => {
        console.log('[Command] 取消选择')
        editorStore.clearSelection()
      },
    },
    {
      id: 'edit.invertSelection',
      label: '反选',
      shortcut: 'Ctrl+Shift+A',
      category: 'edit',
      enabled: () => editorStore.visibleItems.length > 0,
      execute: () => {
        console.log('[Command] 反选')
        editorStore.invertSelection()
      },
    },

    // ===== 视图菜单 =====
    {
      id: 'view.zoomIn',
      label: '放大',
      shortcut: 'Ctrl+=',
      category: 'view',
      enabled: () => editorStore.items.length > 0 && zoomInFn.value !== null,
      execute: () => {
        console.log('[Command] 放大')
        zoomInFn.value?.()
      },
    },
    {
      id: 'view.zoomOut',
      label: '缩小',
      shortcut: 'Ctrl+-',
      category: 'view',
      enabled: () => editorStore.items.length > 0 && zoomOutFn.value !== null,
      execute: () => {
        console.log('[Command] 缩小')
        zoomOutFn.value?.()
      },
    },
    {
      id: 'view.resetView',
      label: '重置视图',
      category: 'view',
      enabled: () => editorStore.items.length > 0 && resetViewFn.value !== null,
      execute: () => {
        console.log('[Command] 重置视图')
        resetViewFn.value?.()
      },
    },
  ])

  // 命令映射表
  const commandMap = computed(() => {
    const map = new Map<string, Command>()
    commands.value.forEach((cmd) => map.set(cmd.id, cmd))
    return map
  })

  // 按分类获取命令
  function getCommandsByCategory(category: CommandCategory): Command[] {
    return commands.value.filter((cmd) => cmd.category === category)
  }

  // 执行命令
  function executeCommand(commandId: string) {
    const command = commandMap.value.get(commandId)
    if (!command) {
      console.warn(`Command not found: ${commandId}`)
      return
    }

    if (!command.enabled()) {
      console.warn(`Command disabled: ${commandId}`)
      return
    }

    command.execute()
  }

  // 检查命令是否可用
  function isCommandEnabled(commandId: string): boolean {
    const command = commandMap.value.get(commandId)
    return command ? command.enabled() : false
  }

  // 设置缩放函数（由 CanvasEditor 调用）
  function setZoomFunctions(
    zoomIn: () => void,
    zoomOut: () => void,
    resetView: () => void,
    fitToView: () => void
  ) {
    zoomInFn.value = zoomIn
    zoomOutFn.value = zoomOut
    resetViewFn.value = resetView
    fitToViewFn.value = fitToView
  }

  return {
    commands,
    commandMap,
    clipboard,
    fileOps,
    getCommandsByCategory,
    executeCommand,
    isCommandEnabled,
    setZoomFunctions,
  }
})

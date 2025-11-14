import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useEditorStore } from './editorStore'
import { useUIStore } from './uiStore'
import { useClipboard } from '../composables/useClipboard'
import { useFileOperations } from '../composables/useFileOperations'
import { useTabStore } from './tabStore'

// 命令接口
export interface Command {
  id: string
  label: string
  shortcut?: string
  category: 'file' | 'edit' | 'view' | 'help'
  enabled: () => boolean
  execute: () => void | Promise<void>
}

export type CommandCategory = 'file' | 'edit' | 'view' | 'help'

export const useCommandStore = defineStore('command', () => {
  const editorStore = useEditorStore()
  const uiStore = useUIStore()

  // 缩放函数引用（需要从外部设置）
  const zoomInFn = ref<(() => void) | null>(null)
  const zoomOutFn = ref<(() => void) | null>(null)
  const fitToViewFn = ref<(() => void) | null>(null)
  const focusSelectionFn = ref<(() => void) | null>(null)

  // 移动对话框状态
  const showMoveDialog = ref(false)

  // 工作坐标系对话框状态
  const showCoordinateDialog = ref(false)

  // 剪贴板和文件操作
  const clipboard = useClipboard(editorStore)
  const fileOps = useFileOperations(editorStore)

  // 定义所有命令
  const commands = computed<Command[]>(() => [
    // ===== 文件菜单 =====
    {
      id: 'file.startWatchMode',
      label: '选择游戏目录',
      shortcut: 'Ctrl+O',
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
      label: '导入建造数据',
      shortcut: 'Ctrl+Shift+O',
      category: 'file',
      enabled: () => true,
      execute: async () => {
        console.log('[Command] 导入建造数据')
        await fileOps.importJSON()
      },
    },
    {
      id: 'file.export',
      label: '导出建造数据',
      shortcut: 'Ctrl+Shift+S',
      category: 'file',
      enabled: () => editorStore.items.length > 0,
      execute: async () => {
        console.log('[Command] 导出建造数据')
        await fileOps.exportJSON()
      },
    },
    {
      id: 'file.saveToGame',
      label: '保存到游戏',
      shortcut: 'Ctrl+S',
      category: 'file',
      enabled: () =>
        fileOps.watchState.value.isActive &&
        fileOps.watchState.value.fileHandle !== null &&
        editorStore.items.length > 0,
      execute: async () => {
        console.log('[Command] 保存到游戏')
        await fileOps.saveToGame()
      },
    },

    // ===== 编辑菜单 =====
    {
      id: 'edit.undo',
      label: '撤销',
      shortcut: 'Ctrl+Z',
      category: 'edit',
      enabled: () => editorStore.canUndo(),
      execute: () => {
        console.log('[Command] 撤销')
        editorStore.undo()
      },
    },
    {
      id: 'edit.redo',
      label: '重做',
      shortcut: 'Ctrl+Y',
      category: 'edit',
      enabled: () => editorStore.canRedo(),
      execute: () => {
        console.log('[Command] 重做')
        editorStore.redo()
      },
    },
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
      id: 'edit.move',
      label: '移动和旋转',
      shortcut: 'Ctrl+M',
      category: 'edit',
      enabled: () => editorStore.selectedItemIds.size > 0,
      execute: () => {
        console.log('[Command] 移动和旋转')
        showMoveDialog.value = true
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
    {
      id: 'edit.group',
      label: '成组',
      shortcut: 'Ctrl+G',
      category: 'edit',
      enabled: () => {
        if (editorStore.selectedItemIds.size < 2) return false

        // 获取所有选中物品的组ID
        const groupIds = new Set(editorStore.selectedItems.map((item) => item.originalData.GroupID))

        // 如果所有物品都属于同一个组（且该组ID > 0），则不允许成组
        if (groupIds.size === 1) {
          const groupId = Array.from(groupIds)[0]
          if (groupId !== undefined && groupId > 0) return false
        }

        return true
      },
      execute: () => {
        console.log('[Command] 成组')
        editorStore.groupSelected()
      },
    },
    {
      id: 'edit.ungroup',
      label: '取消组合',
      shortcut: 'Ctrl+Shift+G',
      category: 'edit',
      enabled: () => {
        // 检查选中物品是否有组
        return editorStore.selectedItems.some((item) => item.originalData.GroupID > 0)
      },
      execute: () => {
        console.log('[Command] 取消组合')
        editorStore.ungroupSelected()
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
      id: 'view.fitToView',
      label: '重置视图',
      category: 'view',
      enabled: () => editorStore.items.length > 0 && fitToViewFn.value !== null,
      execute: () => {
        console.log('[Command] 重置视图（适配到视图）')
        fitToViewFn.value?.()
      },
    },
    {
      id: 'view.focusSelection',
      label: '聚焦选中物品',
      shortcut: 'F',
      category: 'view',
      enabled: () => editorStore.selectedItemIds.size > 0 && focusSelectionFn.value !== null,
      execute: () => {
        console.log('[Command] 聚焦选中物品')
        focusSelectionFn.value?.()
      },
    },
    {
      id: 'view.toggle2D3D',
      label: '切换2D/3D视图',
      shortcut: 'V',
      category: 'view',
      enabled: () => editorStore.items.length > 0,
      execute: () => {
        console.log('[Command] 切换视图模式')
        uiStore.toggleViewMode()
      },
    },
    {
      id: 'view.coordinateSystem',
      label: '工作坐标系设置',
      category: 'view',
      enabled: () => editorStore.items.length > 0,
      execute: () => {
        console.log('[Command] 打开工作坐标系设置')
        showCoordinateDialog.value = true
      },
    },

    // ===== 帮助菜单 =====
    {
      id: 'help.openDocs',
      label: '打开帮助文档',
      shortcut: 'F1',
      category: 'help',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 打开帮助文档')
        const tabStore = useTabStore()
        tabStore.openDocTab('quickstart')
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
    zoomIn: (() => void) | null,
    zoomOut: (() => void) | null,
    fitToView: (() => void) | null,
    focusSelection?: (() => void) | null
  ) {
    zoomInFn.value = zoomIn
    zoomOutFn.value = zoomOut
    fitToViewFn.value = fitToView
    focusSelectionFn.value = focusSelection || null
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
    showMoveDialog,
    showCoordinateDialog,
  }
})

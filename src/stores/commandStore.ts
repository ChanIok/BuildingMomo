import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useEditorStore } from './editorStore'
import { useEditorHistory } from '../composables/editor/useEditorHistory'
import { useClipboard } from '../composables/useClipboard'
import { useEditorSelection } from '../composables/editor/useEditorSelection'
import { useEditorGroups } from '../composables/editor/useEditorGroups'
import { useEditorManipulation } from '../composables/editor/useEditorManipulation'
import { useUIStore } from './uiStore'
import { useSettingsStore } from './settingsStore'
import { useFileOperations } from '../composables/useFileOperations'
import { useTabStore } from './tabStore'
import { useI18n } from '../composables/useI18n'
import type { ViewPreset } from '../composables/useThreeCamera'

// 命令接口
export interface Command {
  id: string
  label: string
  shortcut?: string
  category: CommandCategory
  enabled: () => boolean
  execute: () => void | Promise<void>
}

export type CommandCategory = 'file' | 'edit' | 'view' | 'help' | 'tool'

export const useCommandStore = defineStore('command', () => {
  const editorStore = useEditorStore()
  const { undo, redo, canUndo, canRedo } = useEditorHistory()
  const { copy: copyCmd, cut: cutCmd, pasteItems, clipboard } = useClipboard()
  const { selectAll, clearSelection, invertSelection, selectSameType } = useEditorSelection()
  const { groupSelected, ungroupSelected } = useEditorGroups()
  const { deleteSelected } = useEditorManipulation()

  const uiStore = useUIStore()
  const { t } = useI18n()

  // 视图函数引用（需要从外部设置）
  const fitToViewFn = ref<(() => void) | null>(null)
  const focusSelectionFn = ref<(() => void) | null>(null)

  // 视图切换函数引用（3D视图专用）
  const setViewPresetFn = ref<((preset: ViewPreset) => void) | null>(null)

  // 相机模式切换函数引用（3D视图专用，透视模式下 orbit/flight 切换）
  const toggleCameraModeFn = ref<(() => void) | null>(null)

  // 工作坐标系对话框状态
  const showCoordinateDialog = ref(false)

  // 背包面板显示状态
  const showFurnitureLibrary = ref(false)

  // 剪贴板和文件操作
  const fileOps = useFileOperations(editorStore)

  // 定义所有命令
  const commands = computed<Command[]>(() => [
    // ===== 文件菜单 =====
    {
      id: 'file.new',
      label: t('command.file.new'),
      shortcut: 'Ctrl+N',
      category: 'file',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 新建空白方案')
        editorStore.createScheme()
      },
    },
    {
      id: 'file.startWatchMode',
      label: t('command.file.startWatchMode'),
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
      label: t('command.file.stopWatchMode'),
      category: 'file',
      enabled: () => fileOps.watchState.value.isActive,
      execute: () => {
        console.log('[Command] 停止监控模式')
        fileOps.stopWatchMode()
      },
    },
    {
      id: 'file.importFromCode',
      label: t('command.file.importFromCode'),
      category: 'file',
      enabled: () => {
        // 需要导入 settingsStore
        const settingsStore = useSettingsStore()
        return import.meta.env.VITE_ENABLE_SECURE_MODE === 'true' && settingsStore.isAuthenticated
      },
      execute: () => {
        console.log('[Command] 从方案码导入')
        // 由 Toolbar 组件处理，打开对话框
      },
    },
    {
      id: 'file.import',
      label: t('command.file.import'),
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
      label: t('command.file.export'),
      shortcut: 'Ctrl+Shift+S',
      category: 'file',
      enabled: () => (editorStore.activeScheme?.items.value.length ?? 0) > 0,
      execute: async () => {
        console.log('[Command] 导出建造数据')
        await fileOps.exportJSON()
      },
    },
    {
      id: 'file.saveToGame',
      label: t('command.file.saveToGame'),
      shortcut: 'Ctrl+S',
      category: 'file',
      enabled: () =>
        fileOps.watchState.value.isActive &&
        (editorStore.activeScheme?.items.value.length ?? 0) > 0,
      execute: async () => {
        console.log('[Command] 保存到游戏')
        await fileOps.saveToGame()
      },
    },

    // ===== 工具菜单 =====
    {
      id: 'tool.select',
      label: t('command.tool.select'),
      shortcut: 'V',
      category: 'tool',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 切换选择工具')
        editorStore.currentTool = 'select'
        editorStore.selectionMode = 'box'
      },
    },
    {
      id: 'tool.lasso',
      label: t('command.tool.lasso'),
      shortcut: 'L',
      category: 'tool',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 切换套索工具')
        editorStore.currentTool = 'select'
        editorStore.selectionMode = 'lasso'
      },
    },
    {
      id: 'tool.hand',
      label: t('command.tool.hand'),
      shortcut: 'H',
      category: 'tool',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 切换拖拽工具')
        editorStore.currentTool = 'hand'
      },
    },
    {
      id: 'tool.toggleTranslate',
      label: t('command.tool.toggleTranslate'),
      shortcut: 'G',
      category: 'tool',
      enabled: () => uiStore.viewMode === '3d',
      execute: () => {
        console.log('[Command] 切换平移模式')
        editorStore.gizmoMode = editorStore.gizmoMode === 'translate' ? null : 'translate'
      },
    },
    {
      id: 'tool.toggleRotate',
      label: t('command.tool.toggleRotate'),
      shortcut: 'R',
      category: 'tool',
      enabled: () => uiStore.viewMode === '3d',
      execute: () => {
        console.log('[Command] 切换旋转模式')
        editorStore.gizmoMode = editorStore.gizmoMode === 'rotate' ? null : 'rotate'
      },
    },
    {
      id: 'tool.toggleFurnitureLibrary',
      label: t('command.tool.toggleFurnitureLibrary'),
      shortcut: 'B',
      category: 'tool',
      enabled: () => editorStore.activeScheme !== null,
      execute: () => {
        console.log('[Command] 切换家具背包')
        showFurnitureLibrary.value = !showFurnitureLibrary.value
      },
    },

    // ===== 侧边栏菜单 =====
    {
      id: 'sidebar.showSelection',
      label: t('command.sidebar.showSelection'),
      shortcut: '1',
      category: 'view',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 切换到选中列表面板')
        uiStore.setSidebarView('structure')
      },
    },
    {
      id: 'sidebar.showTransform',
      label: t('command.sidebar.showTransform'),
      shortcut: '2',
      category: 'view',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 切换到变换面板')
        uiStore.setSidebarView('transform')
      },
    },
    {
      id: 'sidebar.showEditorSettings',
      label: t('command.sidebar.showEditorSettings'),
      shortcut: '3',
      category: 'view',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 切换到编辑器设置面板')
        uiStore.setSidebarView('editorSettings')
      },
    },

    // ===== 编辑菜单 =====
    {
      id: 'edit.undo',
      label: t('command.edit.undo'),
      shortcut: 'Ctrl+Z',
      category: 'edit',
      enabled: () => canUndo(),
      execute: () => {
        console.log('[Command] 撤销')
        undo()
      },
    },
    {
      id: 'edit.redo',
      label: t('command.edit.redo'),
      shortcut: 'Ctrl+Y',
      category: 'edit',
      enabled: () => canRedo(),
      execute: () => {
        console.log('[Command] 重做')
        redo()
      },
    },
    {
      id: 'edit.cut',
      label: t('command.edit.cut'),
      shortcut: 'Ctrl+X',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0,
      execute: () => {
        console.log('[Command] 剪切')
        cutCmd()
      },
    },
    {
      id: 'edit.copy',
      label: t('command.edit.copy'),
      shortcut: 'Ctrl+C',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0,
      execute: () => {
        console.log('[Command] 复制')
        copyCmd()
      },
    },
    {
      id: 'edit.duplicate',
      label: t('command.edit.duplicate') || '复制并粘贴',
      shortcut: 'E',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0,
      execute: () => {
        console.log('[Command] 复制并粘贴 (E)')
        // 获取当前选中的物品
        const scheme = editorStore.activeScheme
        if (!scheme || scheme.selectedItemIds.value.size === 0) return

        const selectedIds = scheme.selectedItemIds.value
        const selectedItems = scheme.items.value
          .filter((item) => selectedIds.has(item.internalId))
          .map((item) => ({ ...item }))

        // 原地粘贴（offset 0, 0），不影响剪贴板
        if (selectedItems.length > 0) {
          pasteItems(selectedItems, 0, 0)
        }
      },
    },
    {
      id: 'edit.paste',
      label: t('command.edit.paste'),
      shortcut: 'Ctrl+V',
      category: 'edit',
      enabled: () => clipboard.value.length > 0,
      execute: () => {
        console.log('[Command] 粘贴')
        pasteItems(clipboard.value, 0, 0)
      },
    },
    {
      id: 'edit.delete',
      label: t('command.edit.delete'),
      shortcut: 'Delete',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0,
      execute: () => {
        console.log('[Command] 删除')
        deleteSelected()
      },
    },
    {
      id: 'edit.selectAll',
      label: t('command.edit.selectAll'),
      shortcut: 'Ctrl+A',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.items.value.length ?? 0) > 0,
      execute: () => {
        console.log('[Command] 全选')
        selectAll()
      },
    },
    {
      id: 'edit.deselectAll',
      label: t('command.edit.deselectAll'),
      shortcut: 'Escape',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0,
      execute: () => {
        console.log('[Command] 取消选择')
        clearSelection()
      },
    },
    {
      id: 'edit.invertSelection',
      label: t('command.edit.invertSelection'),
      // 移除快捷键以避免与 selectSameType 冲突
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.items.value.length ?? 0) > 0,
      execute: () => {
        console.log('[Command] 反选')
        invertSelection()
      },
    },
    {
      id: 'edit.selectSameType',
      label: t('command.edit.selectSameType'),
      shortcut: 'Ctrl+Shift+A',
      category: 'edit',
      enabled: () => (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0,
      execute: () => {
        console.log('[Command] 选择同类')
        selectSameType()
      },
    },
    {
      id: 'edit.group',
      label: t('command.edit.group'),
      shortcut: 'Ctrl+G',
      category: 'edit',
      enabled: () => {
        const scheme = editorStore.activeScheme
        if (!scheme || scheme.selectedItemIds.value.size < 2) return false

        const ids = scheme.selectedItemIds.value
        // 获取所有选中物品的组ID
        const selectedItems = scheme.items.value.filter((item) => ids.has(item.internalId))
        const groupIds = new Set(selectedItems.map((item) => item.groupId))

        // 如果所有物品都属于同一个组（且该组ID > 0），则不允许成组
        if (groupIds.size === 1) {
          const groupId = Array.from(groupIds)[0]
          if (groupId !== undefined && groupId > 0) return false
        }

        return true
      },
      execute: () => {
        console.log('[Command] 成组')
        groupSelected()
      },
    },
    {
      id: 'edit.ungroup',
      label: t('command.edit.ungroup'),
      shortcut: 'Ctrl+Shift+G',
      category: 'edit',
      enabled: () => {
        // 检查选中物品是否有组
        const scheme = editorStore.activeScheme
        if (!scheme) return false
        const ids = scheme.selectedItemIds.value
        return scheme.items.value
          .filter((item) => ids.has(item.internalId))
          .some((item) => item.groupId > 0)
      },
      execute: () => {
        console.log('[Command] 取消组合')
        ungroupSelected()
      },
    },

    // ===== 视图菜单 =====
    {
      id: 'view.fitToView',
      label: t('command.view.fitToView'),
      category: 'view',
      enabled: () => fitToViewFn.value !== null,
      execute: () => {
        console.log('[Command] 重置视图（适配到视图）')
        fitToViewFn.value?.()
      },
    },
    {
      id: 'view.focusSelection',
      label: t('command.view.focusSelection'),
      shortcut: 'F',
      category: 'view',
      enabled: () =>
        (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0 &&
        focusSelectionFn.value !== null,
      execute: () => {
        console.log('[Command] 聚焦选中物品')
        focusSelectionFn.value?.()
      },
    },
    {
      id: 'view.coordinateSystem',
      label: t('command.view.coordinateSystem'),
      category: 'view',
      enabled: () => true,
      execute: () => {
        console.log('[Command] 打开工作坐标系设置')
        showCoordinateDialog.value = true
      },
    },
    {
      id: 'view.toggleCameraMode',
      label: t('command.view.toggleCameraMode'),
      shortcut: 'Tab',
      category: 'view',
      enabled: () => toggleCameraModeFn.value !== null,
      execute: () => {
        console.log('[Command] 切换相机模式 (Orbit/Flight)')
        toggleCameraModeFn.value?.()
      },
    },

    // ===== 3D视图预设 =====
    {
      id: 'view.setViewPerspective',
      label: t('command.view.setViewPerspective'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到透视视图')
        setViewPresetFn.value?.('perspective')
      },
    },
    {
      id: 'view.setViewTop',
      label: t('command.view.setViewTop'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到顶视图')
        setViewPresetFn.value?.('top')
      },
    },
    {
      id: 'view.setViewFront',
      label: t('command.view.setViewFront'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到前视图')
        setViewPresetFn.value?.('front')
      },
    },
    {
      id: 'view.setViewLeft',
      label: t('command.view.setViewLeft'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到左侧视图')
        setViewPresetFn.value?.('left')
      },
    },
    {
      id: 'view.setViewRight',
      label: t('command.view.setViewRight'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到右侧视图')
        setViewPresetFn.value?.('right')
      },
    },
    {
      id: 'view.setViewBack',
      label: t('command.view.setViewBack'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到后视图')
        setViewPresetFn.value?.('back')
      },
    },
    {
      id: 'view.setViewBottom',
      label: t('command.view.setViewBottom'),
      category: 'view',
      enabled: () => uiStore.viewMode === '3d' && setViewPresetFn.value !== null,
      execute: () => {
        console.log('[Command] 切换到底视图')
        setViewPresetFn.value?.('bottom')
      },
    },

    // ===== 帮助菜单 =====
    {
      id: 'help.openDocs',
      label: t('command.help.openDocs'),
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

  // 设置视图函数（由编辑器调用）
  function setZoomFunctions(fitToView: (() => void) | null, focusSelection?: (() => void) | null) {
    fitToViewFn.value = fitToView
    focusSelectionFn.value = focusSelection || null
  }

  // 设置视图切换函数（由 ThreeEditor 调用）
  function setViewPresetFunction(fn: ((preset: ViewPreset) => void) | null) {
    setViewPresetFn.value = fn
  }

  // 设置相机模式切换函数（由 ThreeEditor 调用）
  function setToggleCameraModeFunction(fn: (() => void) | null) {
    toggleCameraModeFn.value = fn
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
    setViewPresetFunction,
    setToggleCameraModeFunction,
    showCoordinateDialog,
    showFurnitureLibrary,
  }
})

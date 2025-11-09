import { computed, watch, type Ref } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import type { Command } from '../stores/commandStore'
import { useInputState } from './useInputState'

export interface UseKeyboardShortcutsOptions {
  commands: Command[]
  executeCommand: (commandId: string) => void
  stageRef: Ref<any>
  stageConfig: Ref<any>
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const { commands, executeCommand, stageRef, stageConfig } = options

  // 使用统一的输入状态管理
  const { isSpacePressed } = useInputState()

  // 构建快捷键映射表（响应式）
  const shortcutMap = computed(() => {
    const map = new Map<string, string>()
    commands.forEach((cmd) => {
      if (cmd.shortcut) {
        map.set(normalizeShortcut(cmd.shortcut), cmd.id)
      }
    })
    return map
  })

  // 标准化快捷键字符串（统一格式）
  function normalizeShortcut(shortcut: string): string {
    return shortcut.toLowerCase().replace(/\s/g, '').replace('ctrl', 'control')
  }

  // 将键盘事件转换为快捷键字符串
  function eventToShortcut(event: KeyboardEvent): string {
    const parts: string[] = []

    if (event.ctrlKey || event.metaKey) parts.push('control')
    if (event.shiftKey) parts.push('shift')
    if (event.altKey) parts.push('alt')

    // 处理特殊键
    let key = event.key.toLowerCase()

    // 标准化一些特殊键名
    if (key === '+') key = '='
    if (key === '_') key = '-'

    // 不重复添加修饰键
    if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
      parts.push(key)
    }

    return parts.join('+')
  }

  // 更新画布拖动模式
  function updateDragMode(isDragMode: boolean) {
    stageConfig.value.draggable = isDragMode

    const stage = stageRef.value?.getStage()
    if (stage) {
      const container = stage.container()
      container.style.cursor = isDragMode ? 'grab' : 'default'
    }
  }

  // 监听空格键状态变化，自动更新拖拽模式
  watch(
    () => isSpacePressed?.value || false,
    (pressed) => {
      updateDragMode(pressed)
    }
  )

  // 使用 VueUse 的 onKeyStroke 处理键盘事件
  onKeyStroke(
    (event) => {
      // 如果在输入框中，不处理快捷键
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }

      // 空格键已通过 watch isSpacePressed 处理，这里跳过
      if (event.code === 'Space') {
        event.preventDefault()
        return
      }

      // 匹配快捷键命令
      const shortcut = eventToShortcut(event)
      const commandId = shortcutMap.value.get(shortcut)

      if (commandId) {
        event.preventDefault()
        console.log(`[Shortcut] Triggered: ${shortcut} -> ${commandId}`)
        executeCommand(commandId)
      }
    },
    { target: window, dedupe: false }
  )

  // 初始化日志
  console.log(`[Shortcuts] Registered ${shortcutMap.value.size} keyboard shortcuts`)

  return {
    isSpacePressed,
    shortcutMap,
  }
}

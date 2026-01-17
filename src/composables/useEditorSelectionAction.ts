import { computed } from 'vue'
import { useMagicKeys } from '@vueuse/core'
import { useEditorStore } from '@/stores/editorStore'

/**
 * 统一管理编辑器选择行为的 Composable
 * 结合 Store 设置和键盘修饰键计算当前的有效选择模式
 */
export function useEditorSelectionAction() {
  const editorStore = useEditorStore()
  const { shift, alt, ctrl } = useMagicKeys()

  const activeAction = computed(() => {
    // 快捷键优先级高于 UI 设置

    // Shift + Alt -> 交叉选区
    if (shift?.value && alt?.value) return 'intersect'

    // Alt -> 减选
    if (alt?.value) return 'subtract'

    // Shift -> 加选
    if (shift?.value) return 'add'

    // 默认使用 Store 中的设置
    return editorStore.selectionAction
  })

  // Ctrl 键控制强制单选模式（不扩展到组）
  // 与 activeAction 正交，可组合使用（如 Ctrl+Shift 表示强制单选+加选）
  const forceIndividualSelection = computed(() => ctrl?.value ?? false)

  return {
    activeAction,
    forceIndividualSelection,
  }
}

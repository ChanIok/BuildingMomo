import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'

/** 普通选择共用的可选范围：当前编辑工作集与家具类别的交集。 */
export function useSelectionFilter() {
  const editorStore = useEditorStore()
  const gameDataStore = useGameDataStore()

  function isItemSelectable(itemId: string): boolean {
    if (!editorStore.isItemEditable(itemId)) return false
    const categories = editorStore.selectionCategoryIds
    if (categories === null) return true
    const item = editorStore.itemsMap.get(itemId)!
    return categories.has(gameDataStore.getFurnitureSelectionCategoryId(item.gameId))
  }

  return { isItemSelectable }
}

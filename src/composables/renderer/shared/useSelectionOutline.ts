import { onUnmounted } from 'vue'
import { createSelectionOutline } from '@nuan5-pro/render'

export function useSelectionOutline() {
  const outline = createSelectionOutline()
  onUnmounted(outline.dispose)
  return outline
}

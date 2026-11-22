import { createIconAtlas } from '@nuan5-pro/render'
import { getIconLoader } from './useIconLoader'

let manager: ReturnType<typeof createIconAtlas> | null = null

export function getThreeIconManager() {
  return (manager ??= createIconAtlas((id) => getIconLoader().loadIcon(id)))
}

export function disposeThreeIconManager() {
  manager?.dispose()
  manager = null
}

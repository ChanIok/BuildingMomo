import { shallowRef } from 'vue'
import type { FurnitureLayer } from '@nuan5-pro/render'

// Reading the active layer must not load the code that creates its GPU context.
export const furnitureRender = shallowRef<FurnitureLayer | null>(null)

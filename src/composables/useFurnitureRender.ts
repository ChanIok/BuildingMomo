import { shallowRef, markRaw } from 'vue'
import {
  createRenderContext,
  createFurnitureLayer,
  type RenderContextOptions,
  type FurnitureLayer,
  type FurnitureLayerOptions,
} from '@nuan5-pro/render'

export const furnitureRender = shallowRef<FurnitureLayer | null>(null)
let initialize: (() => Promise<FurnitureLayer>) | null = null
const waiters = new Set<() => void>()

export function installFurnitureRender(
  options: RenderContextOptions,
  display?: Pick<FurnitureLayerOptions, 'shadingQuality'>
) {
  const context = createRenderContext(options)
  const layerOptions: FurnitureLayerOptions = {
    decoderPath: import.meta.env.BASE_URL + 'draco/',
    shadingQuality: display?.shadingQuality,
  }
  const layer = markRaw(createFurnitureLayer(context, layerOptions))
  let pending: Promise<FurnitureLayer> | null = null
  let disposed = false

  function setup(): Promise<FurnitureLayer> {
    if (disposed) return Promise.reject(new Error('Furniture render context disposed'))
    return (pending ??= layer
      .setup(import.meta.env.BASE_URL + 'assets/furniture-v2/')
      .then(() => {
        if (disposed) throw new Error('Furniture render context disposed')
        furnitureRender.value = layer
        return layer
      })
      .catch((error) => {
        // Retry only when a subsequent rebuild asks for readiness.
        pending = null
        throw error
      }))
  }

  initialize = setup
  // The renderer rebuild reports setup failures through the normal loading UI.
  void setup().catch(() => {})
  for (const wake of waiters) wake()
  waiters.clear()
  return {
    beforeRender: context.beforeRender,
    prepareScene: context.prepareScene,
    dispose() {
      disposed = true
      layer.dispose()
      context.dispose()
      if (furnitureRender.value === layer) furnitureRender.value = null
      if (initialize === setup) initialize = null
    },
  }
}

export async function readyFurnitureRender(): Promise<FurnitureLayer> {
  if (!initialize)
    await new Promise<void>((resolve) => {
      waiters.add(resolve)
    })
  if (!initialize) throw new Error('Furniture render context unavailable')
  return initialize()
}

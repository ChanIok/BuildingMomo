import type { AnalysisBounds, AnalysisVector3 } from './types'
import { SceneAnalysisError } from './types'

/** Angles are degrees in world Z-up: azimuth 0 looks from +X, 90 from +Y. */
export interface AnalysisCamera {
  azimuth?: number
  elevation?: number
  fov?: number
  distance?: number
  target?: AnalysisVector3
}
export interface ImageLayout {
  columns?: number
  cellWidth?: number
  cellHeight?: number
}
export interface AnalysisRenderItem {
  readonly itemId: string
  readonly gameId: number
  readonly worldMatrix: readonly number[] | null
  readonly points: readonly AnalysisVector3[] | null
  readonly bounds: AnalysisBounds | null
}
export interface AnalysisRenderSnapshot {
  readonly snapshotId: string
  readonly items: readonly AnalysisRenderItem[]
}
export interface AnalysisViewRequest {
  readonly camera?: AnalysisCamera
  readonly focusItemIds?: readonly string[]
  readonly width?: number
  readonly height?: number
  readonly color?: string
  readonly labels?: Readonly<Record<string, string>>
  readonly itemIds: readonly string[]
}
export interface AnalysisImageTask {
  signal: AbortSignal
  assertCurrent: () => void
}
export interface AnalysisImageOutput {
  blob: Blob
  width: number
  height: number
  details: Record<string, unknown>
}
export interface AnalysisCaptureProvider {
  /** Environment/context generation, not camera or hover state. */
  revision?: () => number
  render(
    snapshot: AnalysisRenderSnapshot,
    request: AnalysisViewRequest,
    task: AnalysisImageTask
  ): Promise<AnalysisImageOutput>
}

export function assertImageTask(task: AnalysisImageTask) {
  task.assertCurrent()
  if (task.signal.aborted) throw new SceneAnalysisError('cancelled', 'Image request was cancelled')
}

export function createAnalysisCanvas(width: number, height: number) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1)
    throw new SceneAnalysisError('invalid_input', 'Canvas dimensions must be positive integers')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (canvas.width !== width || canvas.height !== height)
    throw new SceneAnalysisError(
      'unavailable',
      `Browser cannot create the requested ${width}×${height} canvas`
    )
  const context = canvas.getContext('2d')
  if (!context) throw new SceneAnalysisError('unavailable', 'Canvas2D is unavailable')
  return { canvas, context }
}

export function canvasImage(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/webp' = 'image/png'
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new SceneAnalysisError('unavailable', 'Image encoding failed')),
      type,
      type === 'image/webp' ? 0.9 : undefined
    )
  )
}

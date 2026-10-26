import type { AnalysisSnapshot } from './types'
import { queryAnalysisCatalog } from './catalog'
import { invalidInput, readObject } from './validation'
import {
  assertImageTask,
  canvasPng,
  createAnalysisCanvas,
  type AnalysisImageTask,
  type AnalysisImageOutput,
  type ImageLayout,
} from './images'
export function layoutAnalysisAtlas(snapshot: AnalysisSnapshot, parameters: unknown) {
  const input = readObject(parameters, [
    'gameIds',
    'offset',
    'limit',
    'columns',
    'cellWidth',
    'cellHeight',
  ])
  const { columns = 4, cellWidth = 240, cellHeight = 232, ...query } = input
  if (
    ![columns, cellWidth, cellHeight].every(
      (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
    )
  )
    invalidInput('Atlas layout dimensions must be positive integers')
  const layout = { columns, cellWidth, cellHeight } as Required<ImageLayout>
  const page = queryAnalysisCatalog(snapshot, {
    ...query,
    limit: query.limit ?? Math.max(snapshot.furniture.length, 1),
  } as Parameters<typeof queryAnalysisCatalog>[1])
  if (!page.items.length) invalidInput('Atlas page is empty')
  const labels = page.items.map((item) => ({
    label: `F${snapshot.furniture.findIndex((f) => f.gameId === item.gameId) + 1}`,
    gameId: item.gameId,
    instanceCount: item.instanceCount,
    nameZh: item.nameZh,
    nameEn: item.nameEn,
  }))
  return {
    page,
    labels,
    ...layout,
    width: layout.columns * layout.cellWidth,
    height: Math.ceil(page.items.length / layout.columns) * layout.cellHeight,
  }
}

export async function renderAnalysisAtlas(
  snapshot: AnalysisSnapshot,
  parameters: unknown,
  task: AnalysisImageTask
): Promise<AnalysisImageOutput> {
  assertImageTask(task)
  const layout = layoutAnalysisAtlas(snapshot, parameters)
  const { columns, cellWidth, cellHeight } = layout
  const { canvas, context: ctx } = createAnalysisCanvas(layout.width, layout.height)
  ctx.fillStyle = '#edf0f4'
  ctx.fillRect(0, 0, layout.width, layout.height)
  const missingGameIds: number[] = []
  // Sequential decoding bounds memory even when all source icons are large.
  for (const [index, item] of layout.page.items.entries()) {
    assertImageTask(task)
    const x = (index % columns) * cellWidth
    const y = Math.floor(index / columns) * cellHeight
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(cellWidth / 240, cellHeight / 232)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(6, 6, 228, 220)
    let bitmap: ImageBitmap | null = null
    try {
      if (item.iconUrl) {
        const response = await fetch(item.iconUrl, { signal: task.signal })
        if (response.ok)
          bitmap = await createImageBitmap(await response.blob(), {
            resizeWidth: cellWidth,
            resizeQuality: 'high',
          })
      }
    } catch (error) {
      assertImageTask(task)
      // Missing/undecodable individual icons leave a labelled placeholder.
      if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error
    }
    try {
      assertImageTask(task)
      if (bitmap) {
        const scale = Math.min(164 / bitmap.width, 144 / bitmap.height)
        const w = bitmap.width * scale,
          h = bitmap.height * scale
        ctx.drawImage(bitmap, (240 - w) / 2, 18 + (144 - h) / 2, w, h)
      } else {
        missingGameIds.push(item.gameId)
        ctx.fillStyle = '#788494'
        ctx.font = '14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Image unavailable', 120, 94)
      }
    } finally {
      bitmap?.close()
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = '#172333'
    ctx.font = 'bold 15px sans-serif'
    ctx.fillText(
      `${layout.labels[index]!.label} · ${item.gameId} · ×${item.instanceCount}`,
      16,
      177
    )
    ctx.font = '14px sans-serif'
    const name = item.nameZh ?? item.nameEn ?? 'Unknown furniture'
    let clipped = name
    while (clipped.length && ctx.measureText(clipped + (clipped === name ? '' : '…')).width > 208)
      clipped = clipped.slice(0, -1)
    ctx.fillText(clipped + (clipped === name ? '' : '…'), 16, 203)
    ctx.restore()
  }
  assertImageTask(task)
  const blob = await canvasPng(canvas)
  assertImageTask(task)
  return {
    blob,
    width: layout.width,
    height: layout.height,
    details: {
      total: layout.page.total,
      offset: layout.page.offset,
      nextOffset: layout.page.nextOffset,
      labels: layout.labels,
      missingGameIds,
    },
  }
}

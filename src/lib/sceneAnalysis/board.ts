import {
  assertImageTask,
  canvasPng,
  createAnalysisCanvas,
  type AnalysisImageOutput,
  type AnalysisImageTask,
  type ImageLayout,
} from './images'

/** Layout is a model choice, not a readability policy. Never split or downsample implicitly. */
export async function composeBoard(
  panels: { label: string; output: AnalysisImageOutput }[],
  task: AnalysisImageTask,
  layout: ImageLayout = {}
): Promise<AnalysisImageOutput> {
  if (!panels.length) throw new Error('A board needs at least one panel')
  const columns = layout.columns ?? Math.ceil(Math.sqrt(panels.length))
  const cellWidth = layout.cellWidth ?? Math.max(...panels.map((p) => p.output.width))
  const cellHeight = layout.cellHeight ?? Math.max(...panels.map((p) => p.output.height)) + 32
  if (
    ![columns, cellWidth, cellHeight].every((v) => Number.isSafeInteger(v) && v > 0) ||
    cellHeight <= 32
  )
    throw new Error('Invalid board layout; cellHeight must leave room for the 32px heading')
  const { canvas, context } = createAnalysisCanvas(
    columns * cellWidth,
    Math.ceil(panels.length / columns) * cellHeight
  )
  context.fillStyle = '#edf0f4'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (const [i, panel] of panels.entries()) {
    assertImageTask(task)
    const bitmap = await createImageBitmap(panel.output.blob)
    try {
      assertImageTask(task)
      const x = (i % columns) * cellWidth,
        y = Math.floor(i / columns) * cellHeight
      context.fillStyle = '#172333'
      context.font = '18px sans-serif'
      context.fillText(`${i + 1} · ${panel.label}`, x + 12, y + 24, cellWidth - 24)
      const scale = Math.min(cellWidth / bitmap.width, (cellHeight - 32) / bitmap.height)
      const w = bitmap.width * scale,
        h = bitmap.height * scale
      context.drawImage(bitmap, x + (cellWidth - w) / 2, y + 32 + (cellHeight - 32 - h) / 2, w, h)
    } finally {
      bitmap.close()
    }
  }
  const blob = await canvasPng(canvas)
  assertImageTask(task)
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    details: {
      layout: { columns, cellWidth, cellHeight },
      panels: panels.map((p, i) => ({ panel: i + 1, label: p.label, ...p.output.details })),
    },
  }
}

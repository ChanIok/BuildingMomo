import {
  assertImageTask,
  canvasImage,
  createAnalysisCanvas,
  type AnalysisImageOutput,
  type AnalysisImageTask,
  type ImageLayout,
} from './images'

const heading = 32
type Panel = { label: string; output: AnalysisImageOutput }
type Frame = { x: number; y: number; width: number; height: number }

/** Equal-height columns, each filled by proportional images and fixed-height titles.
 * Try ordered partitions and choose the board closest to square. The area budget
 * follows the source pixels, so compact packing does not mean a fixed thumbnail size.
 */
function adaptiveBoard(panels: Panel[]) {
  const area = panels.reduce((sum, p) => sum + p.output.width * (p.output.height + heading), 0)
  let best:
    { width: number; height: number; columns: number; frames: Frame[]; score: number } | undefined
  for (let columns = 1; columns <= panels.length; columns++) {
    const groups = Array.from({ length: columns }, (_, i) =>
      panels.slice(
        Math.floor((i * panels.length) / columns),
        Math.floor(((i + 1) * panels.length) / columns)
      )
    )
    const ratios = groups.map((group) =>
      group.reduce((sum, p) => sum + p.output.height / p.output.width, 0)
    )
    const coefficient = ratios.reduce((sum, ratio) => sum + 1 / ratio, 0)
    const titles = groups.reduce((sum, group, i) => sum + (heading * group.length) / ratios[i]!, 0)
    const height = Math.ceil(
      (titles + Math.sqrt(titles * titles + 4 * coefficient * area)) / (2 * coefficient)
    )
    if (groups.some((group) => height <= group.length * heading)) continue
    const frames: Frame[] = []
    let x = 0
    for (const [i, group] of groups.entries()) {
      const width = (height - group.length * heading) / ratios[i]!
      let y = 0
      for (const panel of group) {
        const h = (width * panel.output.height) / panel.output.width + heading
        frames.push({ x, y, width, height: h })
        y += h
      }
      x += width
    }
    const width = Math.ceil(x)
    const score = Math.abs(Math.log(width / height))
    if (!best || score < best.score) best = { width, height, columns, frames, score }
  }
  return best!
}

/** Automatic packing preserves proportions; explicit layouts retain their grid semantics. */
export async function composeBoard(
  panels: Panel[],
  task: AnalysisImageTask,
  layout: ImageLayout = {}
): Promise<AnalysisImageOutput> {
  assertImageTask(task)
  if (!panels.length) throw new Error('A board needs at least one panel')
  // Single panels keep their dimensions and metadata; PNG inputs receive one final WebP encode.
  if (panels.length === 1 && !Object.keys(layout).length) {
    const { label, output } = panels[0]!
    let blob = output.blob
    if (blob.type !== 'image/webp') {
      const bitmap = await createImageBitmap(blob)
      try {
        assertImageTask(task)
        const { canvas, context } = createAnalysisCanvas(output.width, output.height)
        context.drawImage(bitmap, 0, 0)
        blob = await canvasImage(canvas, 'image/webp')
        assertImageTask(task)
      } finally {
        bitmap.close()
      }
    }
    return { ...output, blob, details: { panels: [{ ...output.details, panel: 1, label }] } }
  }
  let frames: Frame[], width: number, height: number, details: Record<string, unknown>
  if (Object.keys(layout).length) {
    const columns = layout.columns ?? Math.ceil(Math.sqrt(panels.length))
    const cellWidth = layout.cellWidth ?? Math.max(...panels.map((p) => p.output.width))
    const cellHeight =
      layout.cellHeight ?? Math.max(...panels.map((p) => p.output.height)) + heading
    if (
      ![columns, cellWidth, cellHeight].every((v) => Number.isSafeInteger(v) && v > 0) ||
      cellHeight <= heading
    )
      throw new Error('Invalid board layout; cellHeight must leave room for the 32px heading')
    width = columns * cellWidth
    height = Math.ceil(panels.length / columns) * cellHeight
    frames = panels.map((_, i) => ({
      x: (i % columns) * cellWidth,
      y: Math.floor(i / columns) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    }))
    details = { columns, cellWidth, cellHeight }
  } else {
    const packed = adaptiveBoard(panels)
    frames = packed.frames
    width = packed.width
    height = packed.height
    details = { mode: 'adaptive', columns: packed.columns }
  }
  const { canvas, context } = createAnalysisCanvas(width, height)
  context.fillStyle = '#edf0f4'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (const [i, panel] of panels.entries()) {
    assertImageTask(task)
    const bitmap = await createImageBitmap(panel.output.blob)
    try {
      assertImageTask(task)
      const { x, y, width: cellWidth, height: cellHeight } = frames[i]!
      context.fillStyle = '#172333'
      context.font = '18px sans-serif'
      context.fillText(`${i + 1} · ${panel.label}`, x + 12, y + 24, Math.max(1, cellWidth - 24))
      const scale = Math.min(cellWidth / bitmap.width, (cellHeight - heading) / bitmap.height)
      const w = bitmap.width * scale,
        h = bitmap.height * scale
      context.drawImage(
        bitmap,
        x + (cellWidth - w) / 2,
        y + heading + (cellHeight - heading - h) / 2,
        w,
        h
      )
    } finally {
      bitmap.close()
    }
  }
  const blob = await canvasImage(canvas, 'image/webp')
  assertImageTask(task)
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    details: {
      layout: details,
      panels: panels.map((p, i) => ({
        ...p.output.details,
        panel: i + 1,
        label: p.label,
        frame: frames[i],
      })),
    },
  }
}

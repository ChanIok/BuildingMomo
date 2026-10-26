import { afterEach, expect, it, vi } from 'vitest'
import { type AnalysisImageOutput } from '@/lib/sceneAnalysis/images'
import { layoutAnalysisAtlas, renderAnalysisAtlas } from '@/lib/sceneAnalysis/catalogAtlas'
import { composeBoard } from '@/lib/sceneAnalysis/board'
import { analysisSnapshot } from '../../fixtures/sceneAnalysis'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const output = (): AnalysisImageOutput => ({
  blob: new Blob(['png'], { type: 'image/png' }),
  width: 10,
  height: 20,
  details: { labels: [] },
})

it('allows all 36 types in a single 6x6 atlas, retaining stable labels across explicit pages', () => {
  const base = analysisSnapshot()
  const snapshot = {
    ...base,
    furniture: Array.from({ length: 36 }, (_, i) => ({ ...base.furniture[0]!, gameId: i + 1 })),
  }
  const page = layoutAnalysisAtlas(snapshot, { offset: 24 })
  expect(page).toMatchObject({ width: 960, height: 696, page: { total: 36, nextOffset: null } })
  expect(page.labels[0]).toMatchObject({ label: 'F25', gameId: 25 })
  expect(layoutAnalysisAtlas(snapshot, { gameIds: [25] }).labels[0]?.label).toBe('F25')
  expect(layoutAnalysisAtlas(snapshot, { columns: 6 })).toMatchObject({
    width: 1440,
    height: 1392,
    page: { total: 36, items: expect.any(Array) },
  })
  for (const parameters of [
    { columns: 0 },
    { limit: 0 },
    { offset: 36 },
    { gameIds: [99] },
    { offset: -1 },
    { limit: '2' },
  ]) {
    expect(() => layoutAnalysisAtlas(snapshot, parameters)).toThrow()
  }
})

function canvasMock() {
  const context = {
    fillStyle: '',
    font: '',
    textAlign: '',
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    measureText: (s: string) => ({ width: s.length * 8 }),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: (blob: Blob) => void) => callback(output().blob),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  return { context, canvas }
}

it('renders available icons and labelled missing placeholders, closing decoded bitmaps', async () => {
  const { context, canvas } = canvasMock()
  const close = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob() }))
  )
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 200, height: 100, close }))
  )
  const controller = new AbortController()
  const result = await renderAnalysisAtlas(
    analysisSnapshot(),
    {},
    { signal: controller.signal, assertCurrent() {} }
  )
  expect(result.details).toMatchObject({
    missingGameIds: [999],
    labels: [{ label: 'F1' }, { label: 'F2' }],
  })
  expect(canvas).toMatchObject({ width: 960, height: 232 })
  expect(context.drawImage).toHaveBeenCalledTimes(1)
  expect(context.drawImage.mock.calls[0]?.slice(-2)).toEqual([164, 82])
  expect(context.fillText).toHaveBeenCalledWith(
    'Image unavailable',
    expect.any(Number),
    expect.any(Number)
  )
  expect(close).toHaveBeenCalledOnce()
})

it('does not classify an aborted icon fetch as a missing image', async () => {
  const { canvas } = canvasMock()
  const encode = vi.spyOn(canvas, 'toBlob')
  const controller = new AbortController()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
  )
  await expect(
    renderAnalysisAtlas(analysisSnapshot(), {}, { signal: controller.signal, assertCurrent() {} })
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(encode).not.toHaveBeenCalled()
})

it('honors explicit board layout and closes every bitmap', async () => {
  const { context } = canvasMock(),
    close = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1024, height: 768, close }))
  )
  const result = await composeBoard(
    ['Top', 'Side', 'Isolated'].map((label) => ({ label, output: output() })),
    { signal: new AbortController().signal, assertCurrent() {} },
    { columns: 2, cellWidth: 1024, cellHeight: 800 }
  )
  expect(result).toMatchObject({ width: 2048, height: 1600 })
  expect(context.drawImage).toHaveBeenCalledTimes(3)
  expect(context.drawImage.mock.calls[0]?.slice(1)).toEqual([0, 32, 1024, 768])
  expect(context.fillText).toHaveBeenCalledWith(
    '2 · Side',
    expect.any(Number),
    expect.any(Number),
    1000
  )
  expect(close).toHaveBeenCalledTimes(3)
})
it('closes a decoded board bitmap when its operation becomes stale', async () => {
  canvasMock()
  const close = vi.fn(),
    controller = new AbortController()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      controller.abort()
      return { width: 1, height: 1, close }
    })
  )
  await expect(
    composeBoard([{ label: 'x', output: output() }], {
      signal: controller.signal,
      assertCurrent() {},
    })
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(close).toHaveBeenCalledOnce()
})

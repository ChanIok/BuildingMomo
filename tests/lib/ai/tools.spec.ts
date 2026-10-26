import { expect, it, vi } from 'vitest'
import { workbenchFixture, applyCommand } from '../../fixtures/ai'
import { createArtifacts } from '@/lib/ai/artifacts'
import { createWorkbenchTools, workbenchTools } from '@/lib/ai/tools'
import { evaluateComputation } from '@/lib/ai/computation'
import { asSchema } from 'ai'
import { formatInputError } from '@/lib/ai/toolSchema'
import { scenarioGuides } from '@/lib/ai/guides'
import type { ArtifactRecord, ToolOutput } from '@/lib/ai/types'

async function setup() {
  const s = await workbenchFixture(),
    store = createArtifacts(s.records, s.repository)
  const selected = s.scene.selection()
  await store.add(
    {
      kind: 'set',
      label: 'Previously inspected set',
      schemeId: selected.schemeId,
      revision: selected.revision,
      count: selected.members.length,
    },
    selected.members
  )
  await persist(store.staged)
  const compute = vi.fn(async (code, input) => evaluateComputation(code, structuredClone(input)))
  const tools = createWorkbenchTools(s.records, s.repository, s.scene, 'en', compute)
  async function persist(values: NonNullable<ToolOutput['artifacts']>) {
    await s.repository.save(s.records.conversation, values)
    s.records.artifacts.push(...values.filter((a): a is ArtifactRecord => 'ref' in a))
  }
  async function execute(name: string, p: unknown) {
    const validation = await asSchema(
      tools.definitions[name as keyof typeof tools.definitions].inputSchema
    ).validate!(p)
    if (!validation.success)
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: formatInputError(
            tools.definitions[name as keyof typeof tools.definitions].inputSchema,
            validation.error,
            name
          ),
        },
      }
    const output = await tools.execute(
      name,
      validation.value,
      s.scene.current().version,
      new AbortController().signal,
      `test-${Math.random()}`
    )
    if (output.ok) await persist(output.artifacts ?? [])
    return output
  }
  return { ...s, tools, execute, compute }
}
it('exposes only four tools and defaults to cheap overview, never an automatic item table', async () => {
  const s = await setup()
  expect(Object.keys(workbenchTools)).toEqual(['inspect', 'compute', 'render', 'apply'])
  const result = await s.execute('inspect', { ref: 'R1' })
  expect(result).toMatchObject({ ok: true, data: { count: 2 } })
  expect(JSON.stringify(result)).not.toContain('instanceId')
  expect(await s.execute('inspect', { ref: 'R1' })).toEqual({ ...result, artifacts: [] })
  expect(s.scene.snapshot).toHaveBeenCalledOnce()
})
it('reads the full guide from each advertised entry point without scene reads or edits', async () => {
  const s = await setup(),
    before = [...s.records.artifacts]
  const selection = vi.spyOn(s.scene, 'selection')
  for (const guide of scenarioGuides) {
    const output = await s.execute('inspect', { ref: `guide:${guide.id}` })
    expect(output).toMatchObject({
      ok: true,
      data: { guideId: guide.id, title: guide.name, documentation: guide.content },
      artifacts: [],
    })
    expect(output.attachments).toBeUndefined()
  }
  expect(s.records.artifacts).toEqual(before)
  expect(selection).not.toHaveBeenCalled()
  expect(s.scene.snapshot).not.toHaveBeenCalled()
  expect(s.scene.render).not.toHaveBeenCalled()
  expect(s.scene.apply).not.toHaveBeenCalled()
  expect(s.compute).not.toHaveBeenCalled()
})
it('computes on local full precision inputs, publishes only compact reports/references, saves exact membership', async () => {
  const s = await setup()
  const output = await s.execute('compute', {
    inputs: { items: 'R1' },
    code: "const floors=input.items.filter(i=>i.position.x<100); publish.set('Near',floors); publish.table('Local table',input.items); publish.report('Count',{count:floors.length});",
  })
  expect(output).toMatchObject({
    ok: true,
    data: {
      publications: [
        { kind: 'set', count: 1 },
        { kind: 'table', count: 2 },
        { kind: 'report', report: { count: 1 } },
      ],
    },
  })
  expect(JSON.stringify(output.data)).not.toContain('position')
  expect(s.compute.mock.calls[0]?.[1].items[0]).toMatchObject({
    instanceId: 1000,
    position: { y: -20 },
  })
  expect(s.compute.mock.calls[0]?.[1].items[0]).not.toHaveProperty('id')
  const store = createArtifacts(s.records, s.repository)
  expect(await store.members('R2')).toEqual(['a'])
  expect(await s.execute('inspect', { ref: 'R3', mode: 'content' })).toMatchObject({
    data: { content: expect.stringContaining('position') },
  })
})
it.each([
  "publish.set('Bad',[1003])",
  "publish.set('Bad',[1000,1000])",
  "publish.set('Good',[1000]);publish.set('Bad',[9999])",
])('rejects invalid published members atomically: %s', async (code) => {
  const s = await setup(),
    before = s.records.artifacts.length
  expect(await s.execute('compute', { inputs: { items: 'R1' }, code })).toMatchObject({
    ok: false,
    error: { code: 'compute' },
  })
  expect(s.records.artifacts).toHaveLength(before)
})
it('reads current exact members and keeps historical computations from laundering stale evidence into current plans', async () => {
  const s = await setup()
  await s.execute('compute', {
    inputs: { items: 'R1' },
    code: "publish.table('Derived',input.items)",
  })
  s.invalidate()
  expect(await s.execute('apply', applyCommand)).toMatchObject({
    ok: false,
    error: { code: 'stale_reference' },
  })
  expect(
    await s.execute('compute', {
      inputs: { table: 'R2' },
      code:
        "publish.report('Historical count',input.table.length);publish.plan('Historical plan'," +
        JSON.stringify(applyCommand) +
        ')',
    })
  ).toMatchObject({
    ok: true,
    data: {
      publications: [
        { ref: 'R3', revision: null, report: 2 },
        { ref: 'R4', revision: null },
      ],
    },
  })
  expect(await s.execute('apply', { plan: 'R4' })).toMatchObject({
    ok: false,
    error: { code: 'stale_reference' },
  })
  expect(await s.execute('inspect', { ref: 'R1' })).toMatchObject({
    data: { ref: 'R5', count: 2, evidence: 'renewed_membership_check_analysis' },
  })
  expect(await createArtifacts(s.records, s.repository).members('R5')).toEqual(['a', 'b'])
  expect(
    await s.execute('apply', {
      collections: [],
      groups: [{ id: 'roof', name: 'Roof', collectionId: null, ref: 'R5' }],
    })
  ).toMatchObject({ ok: true })
  expect(s.scene.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      groups: [{ id: 'roof', name: 'Roof', collectionId: null, itemIds: ['a', 'b'] }],
    }),
    'external'
  )
})
it('renders arbitrary perspective panels with independent focus, sizes and layouts; rejects foreign focus and labels', async () => {
  const s = await setup()
  await s.execute('compute', { inputs: { items: 'R1' }, code: "publish.set('One',[1000])" })
  const panels = Array.from({ length: 6 }, (_, i) => ({
    ref: 'R1',
    label: `Angle ${i}`,
    camera: { azimuth: i * 60, elevation: 25, fov: 60 },
    focus: 'R2',
    labels: true,
    width: 1600,
    height: 900,
  }))
  const output = await s.execute('render', {
    panels,
    layout: { columns: 3, cellWidth: 1600, cellHeight: 932 },
  })
  expect(output.attachments).toHaveLength(1)
  expect(s.scene.render).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        members: ['a', 'b'],
        kind: 'scene',
        focus: ['a'],
        camera: { azimuth: 120, elevation: 25, fov: 60 },
        width: 1600,
        height: 900,
        labels: true,
      }),
    ]),
    expect.any(AbortSignal),
    { columns: 3, cellWidth: 1600, cellHeight: 932 }
  )
  expect(
    await s.execute('render', { panels: [{ ref: 'R2', label: 'Wrong focus', focus: 'R1' }] })
  ).toMatchObject({ ok: false })
  expect(
    await s.execute('render', { panels: [{ ref: 'R2', label: 'Wrong labels', labels: 'R1' }] })
  ).toMatchObject({ ok: false })
  expect(s.scene.render).toHaveBeenCalledOnce()
})
it('retrieves original source via its producer and pages large JSON without an inaccessible oversized row', async () => {
  const s = await setup(),
    code = "publish.table('Large',['x'.repeat(6000)])"
  const result = await s.tools.execute(
    'compute',
    { inputs: { items: 'R1' }, code },
    'v1',
    new AbortController().signal,
    'producer'
  )
  await s.repository.save(s.records.conversation, result.artifacts)
  s.records.artifacts.push(...result.artifacts!.filter((a): a is ArtifactRecord => 'ref' in a))
  s.records.tools.push({
    id: 'producer',
    conversationId: s.records.conversation.id,
    messageId: 'm',
    providerCallId: 'p',
    name: 'compute',
    input: { inputs: { items: 'R1' }, code },
    effect: 'read',
    state: 'succeeded',
    assets: [],
  })
  expect(await s.execute('inspect', { ref: 'R2', mode: 'source' })).toMatchObject({
    data: { code },
  })
  expect(await s.execute('inspect', { ref: 'R2' })).toMatchObject({
    data: { rows: ['x'.repeat(6000)], nextOffset: null },
  })
  expect(
    await s.execute('inspect', { ref: 'R2', mode: 'content', offset: 1000, limit: 1000 })
  ).toMatchObject({ data: { content: expect.any(String), nextOffset: 2000 } })
})

it('keeps an empty selection empty without snapshotting or expanding to the scheme', async () => {
  const s = await setup()
  vi.spyOn(s.scene, 'selection').mockReturnValue({
    schemeId: 'scheme-1',
    revision: 'v1',
    members: [],
  })
  const result = await s.execute('inspect', { ref: 'selection' })
  expect(result).toMatchObject({ ok: true, data: { count: 0, typeCount: 0, ref: 'R2' } })
  expect(s.scene.snapshot).not.toHaveBeenCalled()
  expect(await createArtifacts(s.records, s.repository).members('R2')).toEqual([])
})

it('reattaches a saved image explicitly even when it was inspected earlier in the same run', async () => {
  const s = await setup(),
    output = await s.execute('render', { panels: [{ ref: 'R1', label: 'Top', kind: 'scene' }] })
  const image = output.attachments![0]!
  await s.repository.save(s.records.conversation, [
    {
      id: image.imageId,
      conversationId: s.records.conversation.id,
      blob: image.blob,
      bytes: image.blob.size,
      width: image.width,
      height: image.height,
    },
  ])
  expect((await s.execute('inspect', { ref: 'R2' })).attachments).toHaveLength(1)
  expect((await s.execute('inspect', { ref: 'R2' })).attachments).toHaveLength(1)
})

it('supports standalone calculations and a saved typed plan, with current-reference checks at apply', async () => {
  const s = await setup()
  expect(
    await s.execute('compute', {
      inputs: {},
      code:
        "publish.report('Area',2.5*3);publish.plan('Ready'," + JSON.stringify(applyCommand) + ')',
    })
  ).toMatchObject({ data: { publications: [{ report: 7.5 }, { kind: 'plan', ref: 'R3' }] } })
  expect(await s.execute('apply', { plan: 'R3' })).toMatchObject({ ok: true })
  expect(await s.execute('apply', { plan: 'R3' })).toMatchObject({
    ok: false,
    error: { code: 'stale_reference' },
  })
})

it('keeps private edit postconditions and internal member IDs out of model-facing history pages', async () => {
  const s = await setup()
  s.records.tools.push({
    id: 'private-edit',
    conversationId: s.records.conversation.id,
    messageId: 'm',
    providerCallId: 'p',
    name: 'apply',
    input: {},
    effect: 'edit',
    state: 'succeeded',
    result: { ok: true },
    assets: [],
    edit: { transactionId: 'tx', postcondition: 'private-members-do-not-send' },
  })
  const output = await s.execute('inspect', { ref: 'private-edit' })
  expect(JSON.stringify(output.data)).not.toContain('private-members-do-not-send')
  expect(JSON.stringify(output.data)).toContain('transactionId')
})

it('lets the model label only a chosen subset while retaining the surrounding scene', async () => {
  const s = await setup()
  await s.execute('compute', { inputs: { items: 'R1' }, code: "publish.set('Label',[1000])" })
  expect(
    await s.execute('render', { panels: [{ ref: 'R1', label: 'Context', labels: 'R2' }] })
  ).toMatchObject({ ok: true })
  expect(s.scene.render).toHaveBeenCalledWith(
    [expect.objectContaining({ members: ['a', 'b'], labels: ['a'] })],
    expect.any(AbortSignal),
    undefined
  )
})

it('validates published and loaded plans with the same group contract as direct apply', async () => {
  const s = await setup()
  expect(
    await s.execute('compute', {
      inputs: {},
      code: "publish.plan('Bad',{collections:[],groups:[{id:'g',name:'G',ref:'R1'}]})",
    })
  ).toMatchObject({ ok: false, error: { message: expect.stringContaining('collectionId') } })
  const store = createArtifacts(s.records, s.repository)
  await store.add(
    { kind: 'plan', label: 'Old malformed plan', schemeId: 'scheme-1', revision: 'v1' },
    { collections: [], groups: [{ id: 'g', name: 'G', ref: 'R1' }] }
  )
  await s.repository.save(s.records.conversation, store.staged)
  s.records.artifacts.push(...store.staged.filter((a): a is ArtifactRecord => 'ref' in a))
  expect(
    await s.execute('apply', {
      plan: store.staged.find((a): a is ArtifactRecord => 'ref' in a)!.ref,
    })
  ).toMatchObject({ ok: false, error: { message: expect.stringContaining('collectionId') } })
  expect(s.scene.apply).not.toHaveBeenCalled()
})

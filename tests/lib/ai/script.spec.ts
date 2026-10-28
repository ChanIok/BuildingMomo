import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { evaluateScript, serializeData } from '@/lib/ai/scriptRuntime'
import { createWorkbenchTools } from '@/lib/ai/tools'
import { workbenchFixture } from '../../fixtures/ai'
import type { ToolRecord } from '@/lib/ai/types'

const localScript = async (code: string, values: any, call: any) =>
  evaluateScript(code, values, call)
async function setup() {
  const fixture = await workbenchFixture()
  let index = 0
  async function run(code: string) {
    const tool: ToolRecord = {
      id: `tool:${fixture.records.conversation.id}:${index++}`,
      conversationId: fixture.records.conversation.id,
      messageId: 'm',
      providerCallId: 'call',
      name: 'execute_js',
      input: { code },
      state: 'requested',
      assets: [],
      edits: [],
    }
    fixture.records.tools.push(tool)
    const output = await createWorkbenchTools(
      fixture.records,
      fixture.repository,
      fixture.scene,
      'zh',
      localScript
    ).execute(tool, new AbortController().signal)
    const { variables, attachments, ...result } = output
    tool.result = result
    tool.state = output.ok ? 'succeeded' : 'failed'
    await fixture.repository.save(fixture.records.conversation, [
      tool,
      ...(variables ? [variables] : []),
    ])
    if (variables) fixture.records.variables = variables
    return { output, tool }
  }
  return { ...fixture, run }
}
it('keeps full furniture in vars, returns only explicit output, restores selection and renders with a short variable expression', async () => {
  const f = await setup()
  const { output } = await f.run(
    'vars.selected = await api.selection(); console.log(vars.selected.length)'
  )
  expect(output.ok).toBe(true)
  expect(output.data).toMatchObject({
    logs: [[2]],
    variables: { selected: { type: 'array', length: 2 } },
  })
  expect(JSON.stringify(output.data)).not.toContain('instanceId')
  const restored = (await f.repository.load(f.records.conversation.id))!
  expect((restored.variables.values.selected as any[])[0]).toHaveProperty('ref', 1)
  expect((restored.variables.values.selected as any[])[0]).not.toHaveProperty('id')
  const tool = {
    ...f.records.tools[0]!,
    id: `tool:${restored.conversation.id}:render`,
    input: { code: 'await api.render([{items:vars.selected,label:"选区"}])' },
    edits: [],
  }
  const result = await createWorkbenchTools(
    restored,
    f.repository,
    f.scene,
    'zh',
    localScript
  ).execute(tool, new AbortController().signal)
  expect(result.attachments).toHaveLength(1)
  expect(f.scene.render).toHaveBeenCalledWith(
    'scheme-1',
    expect.arrayContaining([expect.objectContaining({ members: ['a', 'b'] })]),
    expect.any(AbortSignal),
    undefined
  )
})
it('rolls back nested vars on script failure and rejects values that cannot survive reload', async () => {
  const f = await setup()
  await f.run('vars.saved = { values: [1, 2] }')
  const { output } = await f.run('vars.saved.values.push(3); throw new Error("failed")')
  expect(output.ok).toBe(false)
  expect(f.records.variables.values.saved).toEqual({ values: [1, 2] })
  for (const code of [
    'vars.fn=()=>1',
    'vars.nan=NaN',
    'vars.cycle={};vars.cycle.self=vars.cycle',
    'vars.map=new Map()',
    'vars.no=undefined',
  ])
    expect((await f.run(code)).output.ok).toBe(false)
  expect((await f.repository.load(f.records.conversation.id))?.variables.values).toEqual({
    saved: { values: [1, 2] },
  })
})
it('refreshes exact saved members, never captures a new selection or expands an empty selection', async () => {
  const f = await setup()
  await f.run('vars.selected=await api.selection()')
  f.invalidate()
  vi.mocked(f.scene.selection).mockReturnValue?.([])
  const stale = await f.run('await api.organize([{name:"Old",items:vars.selected}])')
  expect(stale.output).toMatchObject({ ok: false, error: { code: 'stale' } })
  expect(f.scene.apply).not.toHaveBeenCalled()
  const empty = await f.run('return await api.selection()')
  expect(empty.output.data).toMatchObject({ result: [] })
  const fresh = await f.run(
    'vars.selected=await api.refresh(vars.selected);await api.organize([{name:"New",items:vars.selected}])'
  )
  expect(fresh.output.ok).toBe(true)
  expect(f.scene.apply).toHaveBeenCalledWith(
    'scheme-1',
    expect.objectContaining({ groups: [expect.objectContaining({ itemIds: ['a', 'b'] })] }),
    'external'
  )
})
it('journals completed edits even if later script code fails; vars remains at its previous snapshot', async () => {
  const f = await setup()
  await f.run('vars.keep=1')
  const { output, tool } = await f.run(
    'const selected=await api.selection();await api.organize([{name:"Roof",items:selected}]);vars.keep=2;throw new Error("later")'
  )
  expect(output.ok).toBe(false)
  expect(tool.edits).toMatchObject([
    { state: 'succeeded', outcome: { schemeId: 'scheme-1', transactionId: 'tx' } },
  ])
  expect(f.records.variables.values.keep).toBe(1)
  expect((await f.repository.load(f.records.conversation.id))?.tools.at(-1)?.edits[0]?.state).toBe(
    'succeeded'
  )
})
it('does not commit when the pre-write journal cannot be saved', async () => {
  const f = await setup()
  const save = f.repository.save.bind(f.repository)
  vi.spyOn(f.repository, 'save').mockImplementation(async (conversation, records = []) => {
    if (records.some((r) => 'edits' in r && r.edits.some((e) => e.state === 'prepared')))
      throw new Error('disk failed')
    return save(conversation, records)
  })
  await expect(
    f.run('await api.organize([{name:"X",items:await api.selection()}])')
  ).rejects.toThrow('disk failed')
  expect(f.scene.apply).not.toHaveBeenCalled()
})
it('supports native filtering and local helpers without automatically printing or persisting locals', async () => {
  const result = await evaluateScript(
    'const x=api.math.groupBy([1,2,3],n=>n%2);vars.odd=x[1];return x[0].length',
    {},
    vi.fn()
  )
  expect(result).toMatchObject({ ok: true, values: { odd: [1, 3] }, result: 1, logs: [] })
  expect(() => serializeData({ bad: Infinity })).toThrow('finite JSON')
})

it('passes two furniture batches and three views as one six-panel request and one final attachment', async () => {
  const f = await setup()
  const { output } = await f.run(`
    const items=await api.selection();
    vars.chairs=items.slice(0,1);vars.tables=items.slice(1);
    const batches=[{name:"椅子",items:vars.chairs},{name:"桌子",items:vars.tables}];
    const views=[{name:"正面",azimuth:0},{name:"侧面",azimuth:90},{name:"背面",azimuth:180}];
    await api.render(batches.flatMap(batch=>views.map(view=>({items:batch.items,label:batch.name+" · "+view.name,camera:{azimuth:view.azimuth,elevation:25}}))),{columns:3});
  `)
  expect(output.ok).toBe(true)
  expect(output.attachments).toHaveLength(1)
  expect(f.scene.render).toHaveBeenCalledOnce()
  expect(f.scene.render).toHaveBeenCalledWith(
    'scheme-1',
    [
      ...[0, 90, 180].map((azimuth, i) =>
        expect.objectContaining({
          members: ['a'],
          label: `椅子 · ${['正面', '侧面', '背面'][i]}`,
          camera: { azimuth, elevation: 25 },
        })
      ),
      ...[0, 90, 180].map((azimuth, i) =>
        expect.objectContaining({
          members: ['b'],
          label: `桌子 · ${['正面', '侧面', '背面'][i]}`,
          camera: { azimuth, elevation: 25 },
        })
      ),
    ],
    expect.any(AbortSignal),
    { columns: 3 }
  )
})

it('keeps atlas layout separate from board layout and allows mixed scene and atlas panels', async () => {
  const f = await setup()
  const { output } = await f.run(`
    const items=await api.selection();
    await api.render([
      {items,label:"Scene",focus:items.slice(0,1),width:640,height:480,labels:true},
      {items,label:"Atlas",kind:"atlas",layout:{columns:2,cellWidth:160,cellHeight:180}}
    ],{columns:1,cellWidth:640,cellHeight:512});
  `)
  expect(output.ok).toBe(true)
  expect(f.scene.render).toHaveBeenCalledWith(
    'scheme-1',
    [
      expect.objectContaining({
        label: 'Scene',
        kind: 'scene',
        members: ['a', 'b'],
        focus: ['a'],
        width: 640,
        height: 480,
        labels: true,
      }),
      expect.objectContaining({
        label: 'Atlas',
        kind: 'atlas',
        members: ['a', 'b'],
        layout: { columns: 2, cellWidth: 160, cellHeight: 180 },
      }),
    ],
    expect.any(AbortSignal),
    { columns: 1, cellWidth: 640, cellHeight: 512 }
  )
  expect(output.attachments).toHaveLength(1)
})

it('defaults scene panels to 768px and bounds their long edge without limiting panel count', async () => {
  const f = await setup()
  const { output } = await f.run(`
    const items=await api.selection();
    await api.render([
      {items,label:"Default"},
      {items,label:"Landscape",width:2400,height:1200},
      {items,label:"Portrait",width:600,height:1800},
      {items,label:"Small",width:320,height:240},
      ...Array.from({length:16},(_,i)=>({items,label:"View "+i,camera:{azimuth:i*20}}))
    ]);
  `)
  expect(output.ok).toBe(true)
  const panels = vi.mocked(f.scene.render).mock.calls[0]![1]
  expect(panels).toHaveLength(20)
  expect(panels.slice(0, 4)).toMatchObject([
    { width: 768, height: 768 },
    { width: 1024, height: 512 },
    { width: 341, height: 1024 },
    { width: 320, height: 240 },
  ])
  expect(panels.slice(4).every((p) => p.width === 768 && p.height === 768)).toBe(true)
  expect(output.attachments).toHaveLength(1)
})

it.each([
  'await api.render(items)',
  'await api.render([])',
  'await api.render([{items:[],label:"Empty"}])',
  'await api.render([{items,label:"Valid"},{items,label:"Bad",camera:{fov:180}}])',
  'await api.render([{items,label:"Bad",kind:"atlas",camera:{azimuth:0}}])',
  'await api.render([{items,label:"Bad",layout:{columns:2}}])',
  'await api.render([{items,label:"Bad",kind:"atlas",layout:{columns:0}}])',
  'await api.render([{items,label:"Bad",kind:"atlas",layout:{unknown:1}}])',
  'await api.render([{items,label:"Bad"}],{cellHeight:32})',
  'await api.render([{items,label:"Bad"}],{columns:1.5})',
  'await api.render([{items,label:"Bad",focus:await api.items()}])',
  'await api.render([{items,label:"Bad",focus:[]}])',
])('rejects invalid render requests before any capture: %s', async (code) => {
  const f = await setup()
  const { output } = await f.run(`const items=await api.selection();${code}`)
  expect(output).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(output.attachments).toEqual([])
  expect(f.scene.render).not.toHaveBeenCalled()
})

it('requires a guide topic without returning another copy of the basic API', async () => {
  const f = await setup()
  expect((await f.run('console.log(await api.help("guide:organization"))')).output.ok).toBe(true)
  expect((await f.run('await api.help()')).output).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
})

it('stops queued edits after cancellation, including while the pre-write journal is saving', async () => {
  const f = await setup(),
    controller = new AbortController()
  const save = f.repository.save.bind(f.repository)
  let release!: () => void
  vi.spyOn(f.repository, 'save').mockImplementation(async (conversation, records = []) => {
    if (records.some((r) => 'edits' in r && r.edits.some((e) => e.state === 'prepared'))) {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    return save(conversation, records)
  })
  const tool: ToolRecord = {
    id: `tool:${f.records.conversation.id}:stop`,
    conversationId: f.records.conversation.id,
    messageId: 'm',
    providerCallId: 'stop',
    name: 'execute_js',
    state: 'requested',
    assets: [],
    edits: [],
    input: {
      code: 'const items=await api.selection();await Promise.all([api.organize([{name:"One",items}]),api.organize([{name:"Two",items}])]);vars.bad=1',
    },
  }
  f.records.tools.push(tool)
  const run = createWorkbenchTools(f.records, f.repository, f.scene, 'zh', localScript).execute(
    tool,
    controller.signal
  )
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  controller.abort()
  release()
  expect(await run).toMatchObject({ ok: false })
  expect(f.scene.apply).not.toHaveBeenCalled()
  expect(tool.edits).toHaveLength(1)
  expect(tool.edits[0]?.state).toBe('failed')
  expect(f.records.variables.values).toEqual({})
})

it('retains an uncertain outcome when saving the completed edit fails, and blocks later writes', async () => {
  const f = await setup(),
    save = f.repository.save.bind(f.repository)
  const spy = vi
    .spyOn(f.repository, 'save')
    .mockImplementation(async (conversation, records = []) => {
      if (records.some((r) => 'edits' in r && r.edits.some((e) => e.state === 'succeeded')))
        throw new Error('result save failed')
      return save(conversation, records)
    })
  await expect(
    f.run('await api.organize([{name:"X",items:await api.selection()}])')
  ).rejects.toThrow('result save failed')
  expect(f.scene.apply).toHaveBeenCalledOnce()
  expect(f.records.tools[0]?.edits[0]?.state).toBe('uncertain')
  spy.mockRestore()
  const next = await f.run(
    'await api.organize([{name:"Do not replay",items:await api.selection()}])'
  )
  expect(next.output).toMatchObject({ ok: false, error: { code: 'uncertain_edit' } })
  expect(f.scene.apply).toHaveBeenCalledOnce()
})

it('executes the selection statistics example using full data locally and compact output', async () => {
  const f = await setup()
  const { output } = await f.run(`
    vars.selected=await api.selection();
    const byType=api.math.groupBy(vars.selected,x=>x.gameId);
    console.log(Object.entries(byType).map(([gameId,items])=>({gameId,name:items[0].name,count:items.length})));
  `)
  expect(output.ok).toBe(true)
  expect(output.data).toMatchObject({
    logs: [[[{ gameId: '1170000010', name: '田园地板', count: 2 }]]],
  })
  expect(JSON.stringify(output.data)).not.toContain('position')
  expect(f.records.variables.values.selected).toHaveLength(2)
})

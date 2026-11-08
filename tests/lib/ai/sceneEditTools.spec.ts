import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { evaluateScript } from '@/lib/ai/scriptRuntime'
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

it('gives JS the full furniture catalog with localized names', async () => {
  const f = await setup()
  const { output } = await f.run(
    'const all=await api.catalog({query:"椅子"}); console.log(all.length, all[0].name, all[0].gameId)'
  )
  expect(output.ok).toBe(true)
  expect(output.data).toMatchObject({ logs: [[1, '椅子', 1]] })
})

it('captures the current viewport without reading or returning furniture candidates', async () => {
  const f = await setup()
  const { output } = await f.run(
    'const view=await api.viewport(); console.log(view.width,view.height)'
  )
  expect(output.ok).toBe(true)
  expect(output.data).toMatchObject({ logs: [[100, 100]] })
  expect(f.scene.viewport).toHaveBeenCalledWith('scheme-1', expect.any(AbortSignal))
  expect(output.attachments).toHaveLength(1)
  expect(output.attachments?.[0]?.details).toMatchObject({ schemeId: 'scheme-1' })
})

it('projects edited furniture into an explicit-member command and records one edit', async () => {
  const f = await setup()
  const { output, tool } = await f.run(
    'vars.sel=await api.selection(); vars.sel[0].position.z+=100; await api.edit([vars.sel[0]])'
  )
  expect(output.ok).toBe(true)
  expect(f.scene.apply).toHaveBeenCalledWith(
    'scheme-1',
    {
      kind: 'edit',
      items: [
        {
          itemId: 'a',
          position: { x: 0, y: -20, z: 202 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          gameId: 1170000010,
          groupId: 7,
        },
      ],
    },
    'v1'
  )
  expect(tool.edits).toHaveLength(1)
  expect(tool.edits[0]?.state).toBe('succeeded')
})

it('places new furniture on the default scheme with only the required fields', async () => {
  const f = await setup()
  const { output } = await f.run(
    'const placed=await api.place([{gameId:1,position:{x:0,y:0,z:0}}]); console.log(placed[0].ref, placed[0].instanceId)'
  )
  expect(output.ok).toBe(true)
  expect(output.data).toMatchObject({ logs: [[1, 1000]] })
  expect(f.scene.apply).toHaveBeenCalledWith(
    'scheme-1',
    { kind: 'place', items: [{ gameId: 1, position: { x: 0, y: 0, z: 0 } }] },
    'v1'
  )
})

it('routes relative transforms through explicit members and a world pivot', async () => {
  const f = await setup()
  const { output } = await f.run(
    'vars.sel=await api.selection(); await api.rotate(vars.sel,{delta:{x:0,y:0,z:90},pivot:{x:0,y:0,z:0}})'
  )
  expect(output.ok).toBe(true)
  expect(f.scene.apply).toHaveBeenCalledWith(
    'scheme-1',
    {
      kind: 'rotate',
      itemIds: ['a', 'b'],
      delta: { x: 0, y: 0, z: 90 },
      pivot: { x: 0, y: 0, z: 0 },
    },
    'v1'
  )
})

it('filters catalog queries in the host and returns duplicate batches as new refs', async () => {
  const f = await setup()
  const catalog = await f.run(
    'const roofs=await api.catalog({query:"椅子"}); console.log(roofs.length)'
  )
  expect(catalog.output.ok).toBe(true)
  expect(catalog.output.data).toMatchObject({ logs: [[1]] })
  const duplicate = await f.run(
    'vars.sel=await api.selection(); const copies=await api.duplicate(vars.sel,{offsets:[{x:100,y:0,z:0}]}); console.log(copies.length,copies[0].length,copies[0][0].ref)'
  )
  expect(duplicate.output.ok).toBe(true)
  expect(duplicate.output.data).toMatchObject({ logs: [[1, 1, 3]] })
  expect(f.scene.apply).toHaveBeenCalledWith(
    'scheme-1',
    {
      kind: 'duplicate',
      itemIds: ['a', 'b'],
      offsets: [{ x: 100, y: 0, z: 0 }],
    },
    expect.any(String)
  )
})

it('removes furniture by explicit refs', async () => {
  const f = await setup()
  const { output } = await f.run(
    'vars.sel=await api.selection(); await api.remove(vars.sel.slice(0,1))'
  )
  expect(output.ok).toBe(true)
  expect(f.scene.apply).toHaveBeenCalledWith('scheme-1', { kind: 'remove', itemIds: ['a'] }, 'v1')
})

it('rejects edits based on a stale furniture snapshot before any write', async () => {
  const f = await setup()
  await f.run('vars.sel=await api.selection()')
  f.invalidate()
  const { output } = await f.run('await api.edit(vars.sel)')
  expect(output.ok).toBe(false)
  expect(output.error?.code).toBe('stale')
  expect(f.scene.apply).not.toHaveBeenCalled()
})

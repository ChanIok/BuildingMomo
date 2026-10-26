import { expect, it, vi } from 'vitest'
import { asSchema } from 'ai'
import { readInput } from '@/lib/ai/toolSchema'
import { workbenchTools } from '@/lib/ai/tools'

it.each([
  ['inspect', { ref: 'R1', fields: ['position', 'position'] }, 'fields'],
  ['compute', { inputs: { constructor: 'R1' }, code: 'return 1' }, 'inputs'],
  ['compute', { inputs: { 'bad-key': 'R1' }, code: 'return 1' }, 'inputs'],
  ['render', { panels: [{ ref: 'R1', label: 'View', camera: { fov: 180 } }] }, 'fov'],
  ['render', { panels: [{ ref: 'R1', label: 'View', camera: { view: 'top' } }] }, 'view'],
  ['apply', { collections: [], groups: [{ id: 'g', name: 'G', ref: 'R1' }] }, 'collectionId'],
])('rejects invalid %s input with the affected field', (name, value, field) => {
  const schema = workbenchTools[name as keyof typeof workbenchTools].inputSchema
  expect(() => readInput(schema, value, name)).toThrow(
    expect.objectContaining({
      code: 'invalid_input',
      message: expect.stringContaining(field),
    })
  )
})

it('accepts either apply form but rejects incomplete or mixed forms through SDK validation', async () => {
  const schema = asSchema(workbenchTools.apply.inputSchema)
  const group = { id: 'g', name: 'Group', collectionId: null, ref: 'R1' }
  for (const value of [{ plan: 'R3' }, { collections: [], groups: [group] }]) {
    expect(await schema.validate!(value)).toMatchObject({ success: true, value })
  }
  for (const value of [
    {},
    { plan: 'R3', collections: [] },
    { plan: 'R3', groups: [group] },
    { collections: [] },
    { groups: [group] },
  ]) {
    expect(await schema.validate!(value)).toMatchObject({ success: false })
  }
  const wire = await schema.jsonSchema
  expect(wire).toMatchObject({ type: 'object', additionalProperties: false })
  expect(wire).not.toHaveProperty('anyOf')
  expect(wire).not.toHaveProperty('not')
})

it('validates without dynamic code generation, coercion, mutation or implicit defaults', async () => {
  const schema = asSchema(workbenchTools.inspect.inputSchema)
  const constructor = vi.spyOn(globalThis, 'Function').mockImplementation(() => {
    throw Error('Dynamic code generation is disabled')
  })
  try {
    const value = { ref: 'R1' }
    expect(await schema.validate!(value)).toEqual({ success: true, value: { ref: 'R1' } })
    expect(value).toEqual({ ref: 'R1' })
    expect(await schema.validate!({ ref: 'R1', limit: '2' })).toMatchObject({ success: false })
    expect(constructor).not.toHaveBeenCalled()
  } finally {
    constructor.mockRestore()
  }
})

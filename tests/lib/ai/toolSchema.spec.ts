import { expect, it } from 'vitest'
import { asSchema } from 'ai'
import { formatInputError } from '@/lib/ai/toolSchema'
import { workbenchTools } from '@/lib/ai/tools'
it('accepts only code in the single model tool and gives field-level errors', async () => {
  const schema = workbenchTools.execute_js.inputSchema
  expect(schema.parse({ code: 'return 1' })).toEqual({ code: 'return 1' })
  for (const value of [{}, { code: 3 }, { code: '' }, { code: 'return 1', inputs: {} }]) {
    const result = schema.safeParse(value)
    expect(result.success).toBe(false)
    if (!result.success)
      expect(formatInputError(schema, result.error, 'execute_js')).toContain('execute_js 参数错误')
  }
  expect(await asSchema(schema).jsonSchema).toMatchObject({
    type: 'object',
    additionalProperties: false,
  })
})

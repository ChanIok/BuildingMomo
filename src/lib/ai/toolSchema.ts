import { z } from 'zod'
import type { JSONSchema7 } from 'ai'
import { AiError } from './types'

function fieldPath(path: PropertyKey[]) {
  return path.reduce<string>(
    (result, key) =>
      typeof key === 'number' ? `${result}[${key}]` : `${result}[${JSON.stringify(String(key))}]`,
    '$'
  )
}

function fieldSchema(schema: JSONSchema7, path: PropertyKey[]) {
  let node: JSONSchema7 | boolean | undefined = schema
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined
    node =
      typeof key === 'number'
        ? Array.isArray(node.items)
          ? node.items[key]
          : node.items
        : (node.properties?.[String(key)] ?? node.additionalProperties)
  }
  return node && typeof node === 'object' ? node : undefined
}

/** Presentation only: the SDK validates Zod inputs, without a second validator. */
export function formatInputError(schema: z.ZodType, error: unknown, name: string) {
  if (!(error instanceof z.ZodError))
    return error instanceof Error ? error.message : 'Invalid tool input'
  const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JSONSchema7
  const details = error.issues.flatMap((issue) => {
    const node = fieldSchema(json, issue.path)
    if (issue.code === 'unrecognized_keys') {
      const allowed =
        Object.keys(node?.properties ?? {})
          .map((key) => JSON.stringify(key))
          .join('、') || '无'
      return issue.keys.map(
        (key) =>
          `- ${fieldPath([...issue.path, key])}: 此层级不允许字段 ${JSON.stringify(key)}；允许的字段：${allowed}。`
      )
    }
    return [
      `- ${fieldPath(issue.path)}: ${issue.message}${node?.description ? ` ${node.description}` : ''}`,
    ]
  })
  const unique = [...new Set(details)]
  return [
    `${name} 参数错误：`,
    ...unique.slice(0, 5),
    ...(unique.length > 5 ? [`另有 ${unique.length - 5} 项错误。`] : []),
    ...(schema.description ? [schema.description] : []),
  ].join('\n')
}

/** Publications and saved plans reuse the same schema as direct tool input. */
export function readInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
  name: string
): z.output<T> {
  const result = schema.safeParse(value, { jitless: true })
  if (!result.success)
    throw new AiError('invalid_input', formatInputError(schema, result.error, name))
  return result.data
}

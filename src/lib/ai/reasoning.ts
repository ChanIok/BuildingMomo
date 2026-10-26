import type { AiConnection, AiProvider, ModelSettings } from './connection'

const controls = [
  ['reasoningEffort'],
  ['effort'],
  ['thinking'],
  ['reasoning'],
  ['thinkingConfig', 'thinkingBudget'],
  ['thinkingConfig', 'thinkingLevel'],
]
const bodyControls = [
  'reasoning_effort',
  'thinking',
  'reasoning',
  'enable_thinking',
  'thinking_budget',
]
const namespaces = (provider: AiProvider) =>
  provider === 'compatible'
    ? ['momo', 'openaiCompatible', 'openai-compatible']
    : [provider === 'openai-chat' ? 'openai' : provider]
function at(object: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
    object
  )
}
function overridePaths(provider: AiProvider, settings: ModelSettings) {
  return [
    ...namespaces(provider).flatMap((namespace) =>
      controls.map((path) => ['providerOptions', namespace, ...path])
    ),
    ...(provider === 'compatible' ? bodyControls.map((key) => ['requestBody', key]) : []),
  ].filter((path) => at(settings, path) !== undefined)
}
export function hasReasoningOverride(provider: AiProvider, settings: ModelSettings) {
  return overridePaths(provider, settings).length > 0
}
/** Delete only controls that the user explicitly handed back to the standard selector. */
export function clearReasoningOverride(
  provider: AiProvider,
  settings: ModelSettings
): ModelSettings {
  const result = JSON.parse(JSON.stringify(settings)) as ModelSettings
  for (const path of overridePaths(provider, result)) {
    const parent = at(result, path.slice(0, -1)) as Record<string, unknown>
    delete parent[path.at(-1)!]
  }
  // Remove empty control containers, leaving unrelated display/cache/provider settings intact.
  for (const namespace of namespaces(provider)) {
    const options = result.providerOptions?.[namespace]
    if (options?.thinkingConfig && Object.keys(options.thinkingConfig as object).length === 0)
      delete options.thinkingConfig
    if (options && Object.keys(options).length === 0) delete result.providerOptions![namespace]
  }
  return result
}
export function effectiveReasoning(connection: AiConnection) {
  return hasReasoningOverride(connection.provider, connection) ? undefined : connection.reasoning
}

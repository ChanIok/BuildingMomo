import { expect, it } from 'vitest'
import {
  clearReasoningOverride,
  effectiveReasoning,
  hasReasoningOverride,
} from '@/lib/ai/reasoning'
import type { ModelSettings, AiConnection } from '@/lib/ai/connection'
const connection: AiConnection = {
  provider: 'openai',
  apiUrl: 'https://test/v1',
  apiKey: 'key',
  model: 'alias',
  reasoning: 'low',
}
it('passes the portable setting only when no active provider control takes precedence', () => {
  expect(effectiveReasoning(connection)).toBe('low')
  expect(
    effectiveReasoning({ ...connection, providerOptions: { openai: { reasoningEffort: 'high' } } })
  ).toBeUndefined()
  expect(
    effectiveReasoning({
      ...connection,
      providerOptions: { anthropic: { thinking: { type: 'enabled' } } },
    })
  ).toBe('low')
  expect(
    hasReasoningOverride('google', {
      providerOptions: { google: { thinkingConfig: { includeThoughts: true } } },
    })
  ).toBe(false)
  expect(
    hasReasoningOverride('google', {
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 4096 } } },
    })
  ).toBe(true)
  expect(
    hasReasoningOverride('compatible', { requestBody: { thinking: { type: 'disabled' } } })
  ).toBe(true)
  expect(
    hasReasoningOverride('compatible', {
      providerOptions: { openaiCompatible: { reasoningEffort: 'high' } },
    })
  ).toBe(true)
})
it('restores standard control without changing unrelated advanced settings or the input object', () => {
  const original: ModelSettings = {
    providerOptions: {
      google: {
        thinkingConfig: { thinkingBudget: 4000, thinkingLevel: 'high', includeThoughts: true },
        cachedContent: 'cache',
      },
    },
    requestBody: { vendor_setting: true },
  }
  const before = JSON.stringify(original)
  const result = clearReasoningOverride('google', original)
  expect(result).toEqual({
    providerOptions: {
      google: { thinkingConfig: { includeThoughts: true }, cachedContent: 'cache' },
    },
    requestBody: { vendor_setting: true },
  })
  expect(JSON.stringify(original)).toBe(before)
  expect(hasReasoningOverride('google', result)).toBe(false)
  expect(
    clearReasoningOverride('compatible', {
      requestBody: { reasoning_effort: 'high', thinking: { type: 'enabled' }, custom: 'kept' },
    })
  ).toEqual({ requestBody: { custom: 'kept' } })
})

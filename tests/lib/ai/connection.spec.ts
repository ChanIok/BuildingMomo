import { expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  endpointIdentity,
  modelSettingsKey,
  parseObject,
  validateConnection,
  type AiConnection,
} from '@/lib/ai/connection'

const connection: AiConnection = {
  provider: 'compatible',
  apiUrl: 'https://gateway.test/v1',
  apiKey: '',
  model: 'private-alias',
}
it.each(Object.keys(AI_PROVIDERS))(
  'accepts arbitrary model IDs for %s, without a model whitelist',
  (provider) => {
    expect(() =>
      validateConnection({
        ...connection,
        provider: provider as AiConnection['provider'],
        apiKey: 'key',
        model: 'future-model/custom-alias',
      })
    ).not.toThrow()
  }
)
it('allows keyless local compatible servers and extra authentication headers', () => {
  expect(() =>
    validateConnection({
      ...connection,
      apiUrl: 'http://localhost:1234/v1',
      headers: { 'X-Auth': 'custom' },
    })
  ).not.toThrow()
  expect(() => validateConnection({ ...connection, provider: 'anthropic' })).toThrowError(
    /settings/
  )
})
it('distinguishes native protocols and keeps endpoint credentials out of persisted identities', () => {
  expect(endpointIdentity({ ...connection, apiUrl: 'https://gateway.test/v1?key=secret' })).toBe(
    'https://gateway.test/v1/chat/completions'
  )
  expect(endpointIdentity({ ...connection, provider: 'anthropic' })).toBe('https://gateway.test/v1')
  expect(modelSettingsKey(connection)).not.toBe(
    modelSettingsKey({ ...connection, provider: 'openai-chat' })
  )
  expect(modelSettingsKey({ ...connection, provider: 'openai' })).not.toBe(
    modelSettingsKey({ ...connection, provider: 'openai-chat' })
  )
})
it.each(['https://user:key@test/v1', 'https://test/v1#fragment', 'file:///tmp', 'not-url'])(
  'rejects unsafe or invalid URL %s',
  (apiUrl) => {
    expect(() => validateConnection({ ...connection, apiUrl })).toThrowError(/settings/)
  }
)
it.each([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
  'max_tokens',
  'max_completion_tokens',
  'n',
])('does not allow compatible extensions to replace controlled field %s', (field) => {
  expect(() =>
    validateConnection({ ...connection, requestBody: { [field]: 'override' } })
  ).toThrowError(/settings/)
})
it('validates JSON objects, SDK namespaces and string-only headers', () => {
  expect(parseObject('')).toEqual({})
  expect(parseObject('{"vendor":{"thinking":true}}')).toEqual({ vendor: { thinking: true } })
  for (const text of ['[]', 'null', '"text"', '{']) expect(() => parseObject(text)).toThrow()
  expect(() =>
    validateConnection({ ...connection, providerOptions: { vendor: 'invalid' } as any })
  ).toThrowError(/settings/)
  expect(() => validateConnection({ ...connection, headers: { 'X-Auth': 1 } as any })).toThrowError(
    /settings/
  )
  expect(() =>
    validateConnection({ ...connection, headers: { 'X-Auth': 'bad\nvalue' } })
  ).toThrowError(/settings/)
})

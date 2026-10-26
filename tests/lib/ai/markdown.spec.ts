import { expect, it } from 'vitest'
import { isAiMarkdownLink } from '@/lib/ai/markdown'

it.each(['https://example.test/path?q=1#ref', 'http://localhost:8080/doc', 'HTTPS://example.test'])(
  'allows explicit web links: %s',
  (url) => {
    expect(isAiMarkdownLink(url)).toBe(true)
  }
)

it.each([
  'javascript:alert(1)',
  'data:text/html,<script>',
  'file:///C:/secret',
  'blob:https://example.test/id',
  '//tracker.test',
  '/api/action',
  '#ref',
  'mailto:someone@example.test',
  'https://',
  'https://exa\nmple.test',
  ' https://example.test',
])('rejects non-web or ambiguous URLs: %s', (url) => {
  expect(isAiMarkdownLink(url)).toBe(false)
})

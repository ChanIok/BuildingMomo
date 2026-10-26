import { expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AiMarkdown from '@/components/ai/AiMarkdown.vue'

function render(content: string, final = true) {
  return renderToString(createSSRApp({ render: () => h(AiMarkdown, { content, final }) }))
}

it.each([false, true])(
  'escapes active HTML, rejects unsafe links and blocks all Markdown image loads (final=%s)',
  async (final) => {
    const html = await render(
      '<img src="https://tracker.test/raw" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n[file](file:///secret)\n\n[relative](/api/delete)\n\n![外部图片](https://tracker.test/pixel.png)\n\n![data](data:image/png;base64,eA==)',
      final
    )
    expect(html).not.toMatch(/<(?:img|script|iframe|object|embed)\b/i)
    expect(html).not.toMatch(/\shref="(?:javascript:|file:|\/api\/)/i)
    expect(html).toContain('&lt;img')
    expect(html).toContain('外部图片未加载')
    expect(html).toContain('外部图片')
  }
)

it('preserves safe HTTP(S) links and their opener/referrer protection', async () => {
  const html = await render(
    '[资料](https://example.test/doc) 和 [本地服务](http://localhost:8080/info)'
  )
  expect(html).toContain('href="https://example.test/doc"')
  expect(html).toContain('href="http://localhost:8080/info"')
  expect(html).toContain('noopener')
  expect(html).toContain('noreferrer')
})

it.each(['js', 'html', 'mermaid', 'd2', 'infographic'])(
  'renders %s fences as escaped copyable code, without runtimes or previews',
  async (language) => {
    const html = await render('```' + language + '\n<img src="https://tracker.test/code">\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('复制代码')
    expect(html).toContain('&lt;img')
    expect(html).not.toMatch(/<(?:img|iframe|svg)\b[^>]*src=/i)
    expect(html).not.toContain('srcdoc=')
  }
)

it('renders partial Markdown and an unfinished code fence while streaming, then the completed message', async () => {
  const start = '# 检查\n\n**屋顶\n\n```js\nconst ids = [1,'
  const partial = await render(start, false)
  expect(partial).toContain('检查')
  expect(partial).toContain('const ids = [1,')
  expect(partial).toContain('<pre')
  const finished = await render('# 检查\n\n**屋顶**\n\n```js\nconst ids = [1, 2]\n```', true)
  expect(finished).toContain('<strong')
  expect(finished).toContain('const ids = [1, 2]')
})
